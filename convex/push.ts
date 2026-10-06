import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError, v } from 'convex/values';
import { internalMutation, internalQuery, mutation, query, type QueryCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import schema from './schema';
import { trackingPushIsRelevant, trackingPushTarget } from './lib/trackingNotifications';

async function user(ctx: QueryCtx) {
  const id = await getAuthUserId(ctx); const account = id ? await ctx.db.get('users', id) : null;
  if (!account?.role) throw new ConvexError('Sign in to enable notifications.');
  return account;
}
export const register = mutation({
  args: { installationId: v.string(), token: v.string(), platform: v.union(v.literal('android'), v.literal('ios')), messages: v.boolean(), updates: v.boolean() }, returns: v.null(),
  handler: async (ctx, args) => {
    const account = await user(ctx);
    if (!/^[a-zA-Z0-9-]{16,100}$/.test(args.installationId) || !/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/.test(args.token)) throw new ConvexError('Invalid notification registration.');
    const byInstallation = await ctx.db.query('pushDevices').withIndex('by_installationId', q => q.eq('installationId', args.installationId)).unique();
    const byToken = await ctx.db.query('pushDevices').withIndex('by_token', q => q.eq('token', args.token)).unique();
    // Delete replaced bindings so queued alerts cannot follow a token to another account.
    for (const old of [byInstallation, byToken]) {
      if (old && old._id !== byInstallation?._id) await ctx.db.delete('pushDevices', old._id);
    }
    if (byInstallation?.userId === account._id && byInstallation.token === args.token) {
      await ctx.db.patch('pushDevices', byInstallation._id, { ...args, updatedAt: Date.now() }); return null;
    }
    if (byInstallation) await ctx.db.delete('pushDevices', byInstallation._id);
    const devices = await ctx.db.query('pushDevices').withIndex('by_userId', q => q.eq('userId', account._id)).take(5);
    if (devices.length >= 5) await ctx.db.delete('pushDevices', devices[0]._id);
    await ctx.db.insert('pushDevices', { ...args, userId: account._id, updatedAt: Date.now() });
    return null;
  },
});
export const unregister = mutation({
  args: { installationId: v.string() }, returns: v.null(),
  handler: async (ctx, { installationId }) => {
    const account = await user(ctx);
    const device = await ctx.db.query('pushDevices').withIndex('by_installationId', q => q.eq('installationId', installationId)).unique();
    if (device?.userId === account._id) await ctx.db.delete('pushDevices', device._id);
    return null;
  },
});
export const device = query({
  args: { installationId: v.string() }, returns: v.union(v.null(), v.object({ messages: v.boolean(), updates: v.boolean() })),
  handler: async (ctx, { installationId }) => {
    const account = await user(ctx);
    const row = await ctx.db.query('pushDevices').withIndex('by_installationId', q => q.eq('installationId', installationId)).unique();
    return row?.userId === account._id ? { messages: row.messages, updates: row.updates } : null;
  },
});
export const target = query({
  args: { notificationId: v.string() }, returns: v.union(v.null(), v.object({ role: v.union(v.literal('buyer'), v.literal('runner')), screen: v.union(v.literal('chat'), v.literal('errand'), v.literal('quotes'), v.literal('share')), shareGroupId: v.optional(v.id('shareGroups')), errandId: v.id('errands') })),
  handler: async (ctx, args) => {
    const account = await user(ctx); const id = ctx.db.normalizeId('pushJobs', args.notificationId);
    const job = id ? await ctx.db.get('pushJobs', id) : null;
    if (!job || job.userId !== account._id) return null;
    const errand = await trackingPushTarget(ctx, job);
    if (!errand || errand.trackingMode) return null;
    if (account.role === 'buyer' && errand.customerId === account._id) return { role: 'buyer' as const, screen: job.kind === 'message' && errand.runnerId ? 'chat' as const : 'errand' as const, errandId: errand._id };
    if (account.role === 'runner') {
      const access = await ctx.db.query('runnerAccess').withIndex('by_userId', q => q.eq('userId', account._id)).unique();
      if (!access?.enabled) return null;
      const group = errand.shareGroupId ? await ctx.db.get('shareGroups', errand.shareGroupId) : null;
      if (job.kind === 'share' && group?.runnerId === account._id) return { role: 'runner' as const, screen: 'share' as const, shareGroupId: group._id, errandId: errand._id };
      return { role: 'runner' as const, screen: errand.runnerId === account._id ? job.kind === 'message' ? 'chat' as const : 'errand' as const : 'quotes' as const, errandId: errand._id };
    }
    return null;
  },
});
async function eligibleDevice(ctx: QueryCtx, job: Doc<'pushJobs'>) {
  if (!await trackingPushIsRelevant(ctx, job)) return null;
  const device = await ctx.db.get('pushDevices', job.deviceId);
  if (!device || device.userId !== job.userId || !(job.kind === 'message' ? device.messages : device.updates)) return null;
  const account = await ctx.db.get('users', job.userId);
  if (!account?.role) return null;
  if (account.role === 'runner') {
    const access = await ctx.db.query('runnerAccess').withIndex('by_userId', q => q.eq('userId', job.userId)).unique();
    if (!access?.enabled) return null;
  }
  return device;
}
export const claim = internalMutation({
  args: { id: v.id('pushJobs') }, returns: v.union(v.null(), v.object({ job: schema.doc('pushJobs'), token: v.string(), attempt: v.number() })),
  handler: async (ctx, { id }) => {
    const job = await ctx.db.get('pushJobs', id);
    if (!job || !['pending', 'sending'].includes(job.state) || (job.state === 'sending' && (job.leaseUntil ?? 0) > Date.now())) return null;
    const device = await eligibleDevice(ctx, job);
    if (!device) { await ctx.db.patch('pushJobs', id, { state: 'skipped' }); return null; }
    if (job.attempts >= 4) { await ctx.db.patch('pushJobs', id, { state: 'failed', errorCode: 'RetryLimit' }); return null; }
    const attempt = job.attempts + 1;
    await ctx.db.patch('pushJobs', id, { state: 'sending', attempts: attempt, leaseUntil: Date.now() + 120_000 });
    // Recover from an interrupted action; callbacks are scoped to this attempt.
    await ctx.scheduler.runAfter(120_000, internal.pushDelivery.send, { id });
    return { job, token: device.token, attempt };
  },
});
export const finishSend = internalMutation({
  args: { id: v.id('pushJobs'), attempt: v.number(), ticketId: v.optional(v.string()), errorCode: v.optional(v.string()), retry: v.optional(v.boolean()) }, returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get('pushJobs', args.id);
    if (!job || job.state !== 'sending' || job.attempts !== args.attempt) return null;
    if (args.errorCode === 'DeviceNotRegistered') {
      const device = await eligibleDevice(ctx, job); if (device) await ctx.db.delete('pushDevices', device._id);
    }
    if (args.ticketId) {
      await ctx.db.patch('pushJobs', job._id, { state: 'ticket', ticketId: args.ticketId, receiptChecks: 0, leaseUntil: undefined });
      await ctx.scheduler.runAfter(15 * 60_000, internal.pushDelivery.receipt, { id: job._id });
    } else if (args.retry && job.attempts < 4) {
      await ctx.db.patch('pushJobs', job._id, { state: 'pending', leaseUntil: undefined, errorCode: args.errorCode });
      await ctx.scheduler.runAfter(15_000 * 2 ** (job.attempts - 1), internal.pushDelivery.send, { id: job._id });
    } else await ctx.db.patch('pushJobs', job._id, { state: 'failed', errorCode: args.errorCode ?? 'UnknownError', leaseUntil: undefined });
    return null;
  },
});
export const receiptJob = internalQuery({
  args: { id: v.id('pushJobs') }, returns: v.union(v.null(), schema.doc('pushJobs')),
  handler: async (ctx, { id }) => { const job = await ctx.db.get('pushJobs', id); return job?.state === 'ticket' ? job : null; },
});
export const finishReceipt = internalMutation({
  args: { id: v.id('pushJobs'), status: v.union(v.literal('ok'), v.literal('error'), v.literal('pending')), errorCode: v.optional(v.string()) }, returns: v.null(),
  handler: async (ctx, { id, status, errorCode }) => {
    const job = await ctx.db.get('pushJobs', id); if (!job || job.state !== 'ticket') return null;
    if (errorCode === 'DeviceNotRegistered') { const device = await eligibleDevice(ctx, job); if (device) await ctx.db.delete('pushDevices', device._id); }
    const checks = (job.receiptChecks ?? 0) + 1;
    if (status === 'pending' && checks < 4) {
      await ctx.db.patch('pushJobs', id, { receiptChecks: checks });
      await ctx.scheduler.runAfter(15 * 60_000, internal.pushDelivery.receipt, { id });
    } else await ctx.db.patch('pushJobs', id, { state: status === 'ok' ? 'delivered' : 'failed', receiptChecks: checks, errorCode: status === 'ok' ? undefined : errorCode ?? 'ReceiptUnavailable' });
    return null;
  },
});
