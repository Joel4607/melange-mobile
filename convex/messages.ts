import { queuePush } from './lib/queuePush';
import { recordTrustReply } from './lib/runnerTrust';
import { paginationOptsValidator, paginationResultValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { internalMutation, internalQuery, mutation, query, type MutationCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import schema from './schema';
import { chatAccess, validateMessage } from './lib/chatAccess';

const messageArgs = { errandId: v.id('errands'), channel: v.string(), clientId: v.string(), text: v.string() };
type SendArgs = { errandId: Id<'errands'>; channel: string; clientId: string; text: string };

export const context = query({
  args: { errandId: v.string() },
  returns: v.object({ errandId: v.id('errands'), title: v.string(), channel: v.union(v.string(), v.null()), demo: v.boolean(), canSend: v.boolean(), viewerId: v.id('users'), partnerName: v.string(), reason: v.string() }),
  handler: async (ctx, { errandId }) => {
    const access = await chatAccess(ctx, errandId);
    const partnerId = access.userId === access.errand.customerId ? access.errand.runnerId : access.errand.customerId;
    const partner = partnerId ? await ctx.db.get('users', partnerId) : null;
    return {
      errandId: access.errand._id, title: access.errand.title, channel: access.channel,
      demo: access.demo, canSend: access.canSend, viewerId: access.userId,
      partnerName: access.demo ? 'Demo runner' : partner?.name || 'Runner',
      reason: !access.channel ? 'Chat opens when a runner accepts your errand.' : access.canSend ? '' : access.demo && process.env.ENABLE_DEMO_TRACKING !== 'true' ? 'Demo messaging is currently disabled.' : 'This errand has ended. Your conversation is available to read.',
    };
  },
});

export const list = query({
  args: { errandId: v.id('errands'), channel: v.string(), paginationOpts: paginationOptsValidator },
  returns: paginationResultValidator(schema.doc('messages').extend({ imageUrl: v.union(v.string(), v.null()) })),
  handler: async (ctx, args) => {
    const access = await chatAccess(ctx, args.errandId);
    // Do not expose another assignment's conversation during a reactive switch.
    if (!access.channel || args.channel !== access.channel) return { page: [], isDone: true, continueCursor: '' };
    const result = await ctx.db.query('messages').withIndex('by_errand_and_channel', q => q.eq('errandId', args.errandId).eq('channel', args.channel)).order('desc').paginate(args.paginationOpts);
    return { ...result, page: await Promise.all(result.page.map(async message => ({
      ...message, imageUrl: message.image ? await ctx.storage.getUrl(message.image.storageId) : null,
    }))) };
  },
});

async function existingMessage(ctx: Parameters<typeof chatAccess>[0], args: SendArgs, userId: Id<'users'>, hasImage: boolean) {
  const old = await ctx.db.query('messages').withIndex('by_errand_channel_clientId', q => q.eq('errandId', args.errandId).eq('channel', args.channel).eq('clientId', args.clientId)).unique();
  if (old && (old.senderId !== userId || old.text !== args.text.trim() || !!old.image !== hasImage)) throw new ConvexError('This message reference has already been used.');
  return old;
}

async function commit(ctx: MutationCtx, args: SendArgs, image?: Doc<'messages'>['image']) {
  const text = validateMessage(args.text, args.clientId);
  const access = await chatAccess(ctx, args.errandId);
  if (access.channel !== args.channel) throw new ConvexError('The runner changed. Reopen this conversation.');
  const old = await existingMessage(ctx, args, access.userId, !!image);
  if (old) {
    if (image && image.storageId !== old.image?.storageId) await ctx.storage.delete(image.storageId);
    return old._id;
  }
  if (!access.canSend) throw new ConvexError('This conversation is read-only.');
  if (!text && !image) throw new ConvexError('Write a message or choose an image.');
  const id = await ctx.db.insert('messages', { ...args, text, image, senderId: access.userId, demoReply: false });
  if (!access.demo) await recordTrustReply(ctx, access.errand, access.userId);
  if (access.demo) {
    await ctx.db.insert('messages', {
      errandId: args.errandId, channel: args.channel, clientId: `demo-${args.clientId}`, demoReply: true,
      text: image ? 'Demo reply: Your image was received. A real runner could use it to confirm the item or delivery location.' : 'Demo reply: Your message was received. This is a simulated conversation for testing.',
    });
  }
  if (!access.demo) await queuePush(ctx, access.userId === access.errand.customerId ? access.errand.runnerId : access.errand.customerId, args.errandId, 'message', `message:${id}`);
  return id;
}

export const sendText = mutation({ args: messageArgs, returns: v.id('messages'), handler: (ctx, args) => commit(ctx, args) });

// Only the authenticated HTTP uploader can create an attachment message.
// No public mutation accepts a client-supplied storageId.
export const commitImage = internalMutation({
  args: { ...messageArgs, image: v.object({ storageId: v.id('_storage'), mimeType: v.string(), size: v.number() }) },
  returns: v.id('messages'),
  handler: (ctx, { image, ...args }) => commit(ctx, args, image),
});
export const imageUploadContext = internalQuery({
  args: messageArgs, returns: v.union(v.id('messages'), v.null()),
  handler: async (ctx, args) => {
    validateMessage(args.text, args.clientId);
    const access = await chatAccess(ctx, args.errandId);
    if (access.channel !== args.channel) throw new ConvexError('The runner changed. Reopen this conversation.');
    const old = await existingMessage(ctx, args, access.userId, true);
    if (old) return old._id;
    if (!access.canSend) throw new ConvexError('This conversation is read-only.');
    return null;
  },
});
