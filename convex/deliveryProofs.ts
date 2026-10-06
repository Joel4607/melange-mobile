import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError, v } from 'convex/values';
import { httpAction, internalMutation, internalQuery, query, type QueryCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { boundedBody, imageMime, MAX_IMAGE_BYTES } from './lib/chatImage';

async function uploadContext(ctx: QueryCtx, id: Id<'errands'>, requestId: string) {
  const userId = await getAuthUserId(ctx);
  const errand = await ctx.db.get('errands', id);
  const access = userId ? await ctx.db.query('runnerAccess').withIndex('by_userId', q => q.eq('userId', userId)).unique() : null;
  if (!userId || !access?.enabled || !errand || errand.runnerId !== userId || errand.customerId === userId || errand.trackingMode === 'demo') throw new ConvexError('Only the assigned runner can upload delivery proof.');
  if (!/^[a-zA-Z0-9-]{10,100}$/.test(requestId)) throw new ConvexError('Invalid photo request.');
  const old = await ctx.db.query('deliveryProofs').withIndex('by_errandId', q => q.eq('errandId', id)).unique();
  if (old?.runnerId === userId && old.requestId === requestId) return { userId, existing: old._id };
  if (old) throw new ConvexError('A handover photo is already saved. Reopen the errand to view it.');
  if (errand.status !== 'picked_up' || errand.completion) throw new ConvexError('Add the handover photo after pickup and before reporting delivery.');
  return { userId, existing: null };
}
export const context = internalQuery({
  args: { id: v.id('errands'), requestId: v.string() }, returns: v.union(v.null(), v.id('deliveryProofs')),
  handler: async (ctx, args) => (await uploadContext(ctx, args.id, args.requestId)).existing,
});
export const commit = internalMutation({
  args: { id: v.id('errands'), requestId: v.string(), storageId: v.id('_storage'), mimeType: v.string(), size: v.number() },
  returns: v.object({ id: v.id('deliveryProofs'), usedUpload: v.boolean() }),
  handler: async (ctx, args) => {
    const { userId, existing } = await uploadContext(ctx, args.id, args.requestId);
    if (existing) return { id: existing, usedUpload: false };
    const id = await ctx.db.insert('deliveryProofs', { errandId: args.id, runnerId: userId, requestId: args.requestId, storageId: args.storageId, mimeType: args.mimeType, size: args.size });
    return { id, usedUpload: true };
  },
});
export const get = query({
  args: { id: v.id('errands') }, returns: v.union(v.null(), v.object({ url: v.union(v.string(), v.null()), createdAt: v.number() })),
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    const errand = await ctx.db.get('errands', id);
    if (!userId || !errand || (errand.customerId !== userId && errand.runnerId !== userId)) return null;
    const proof = await ctx.db.query('deliveryProofs').withIndex('by_errandId', q => q.eq('errandId', id)).unique();
    if (!proof || proof.runnerId !== errand.runnerId) return null;
    return { url: await ctx.storage.getUrl(proof.storageId), createdAt: proof._creationTime };
  },
});
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
export const preflight = httpAction(async () => new Response(null, { status: 204, headers }));
export const upload = httpAction(async (ctx, request) => {
  if (!(await getAuthUserId(ctx))) return json({ error: 'Sign in to upload a handover photo.' }, 401);
  let storageId: Id<'_storage'> | undefined;
  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.startsWith('multipart/form-data;')) return json({ error: 'Invalid photo upload.' }, 400);
    const bytes = await boundedBody(request, MAX_IMAGE_BYTES + 32_768);
    const form = await new Response(bytes, { headers: { 'Content-Type': contentType } }).formData() as unknown as { get(name: string): string | Blob | null };
    const id = form.get('id'); const requestId = form.get('requestId'); const image = form.get('image');
    if (typeof id !== 'string' || typeof requestId !== 'string' || !image || typeof image === 'string') throw new Error('Invalid photo upload.');
    if (image.size < 12 || image.size > MAX_IMAGE_BYTES) throw new ConvexError('Choose a photo of 5 MB or smaller.');
    const mimeType = imageMime(new Uint8Array(await image.slice(0, 16).arrayBuffer()));
    if (!mimeType) throw new ConvexError('Choose a JPEG, PNG or WebP photo.');
    const args = { id: id as Id<'errands'>, requestId };
    const existing = await ctx.runQuery(internal.deliveryProofs.context, args);
    if (existing) return json({ id: existing });
    storageId = await ctx.storage.store(image.slice(0, image.size, mimeType));
    const result = await ctx.runMutation(internal.deliveryProofs.commit, { ...args, storageId, mimeType, size: image.size });
    if (!result.usedUpload) await ctx.storage.delete(storageId);
    return json({ id: result.id });
  } catch (err) {
    if (storageId) await ctx.storage.delete(storageId);
    return json({ error: err instanceof ConvexError && typeof err.data === 'string' ? err.data : 'Could not upload the handover photo. Try again.' }, 400);
  }
});
