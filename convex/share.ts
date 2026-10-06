import { createTrackingObligation, requireFreshAssignment, assignmentTrackingReady } from './lib/trackingLifecycle';
import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError, v } from 'convex/values';
import { internalMutation, mutation, query, type QueryCtx } from './_generated/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { activeJob, requireRunner } from './runnerJobs';
import { sharePoint } from './lib/shareFields';
import { rankSharePartners, shareWindowEndsAt, todayDeadlineAt, type ShareTask } from './lib/shareAlgorithm';
import { dissolveShare, runnerGroup } from './lib/shareLifecycle';
import { runnerTrust } from './lib/runnerTrust';
import { queuePush } from './lib/queuePush';
import { trustSummary } from './lib/trustFields';
import { compareRunnerTrust } from './lib/trustScore';
import schema from './schema';
const groupStatus = v.union(v.literal('open'), v.literal('reserved'), v.literal('active'), v.literal('delivered'), v.literal('dissolved'));
const buyerView = v.object({
  state: v.string(), windowEndsAt: v.union(v.number(), v.null()),
  group: v.union(v.null(), v.object({ status: groupStatus, expiresAt: v.number(), savedKm: v.number(), approved: v.boolean(), approvals: v.number(), stopsDone: v.number() })),
  offers: v.array(v.object({ id: v.id('shareOffers'), version: v.number(), fee: v.number(), note: v.string(), name: v.string(), trust: trustSummary, canApprove: v.boolean() })),
});
const runnerView = v.object({ group: schema.doc('shareGroups'), offer: v.union(v.null(), schema.doc('shareOffers')), canQuote: v.boolean(),
  errands: v.array(v.object({ id: v.id('errands'), title: v.string(), pickup: v.string(), dropoff: v.string(), description: v.string(), category: v.string(), budgetPesewas: v.number(), status: v.string() })),
});

async function owned(ctx: QueryCtx, id: Id<'errands'>) {
  const userId = await getAuthUserId(ctx); const e = await ctx.db.get('errands', id);
  if (!e || !userId || e.customerId !== userId) throw new ConvexError('Errand not found.');
  return e;
}
function task(e: Doc<'errands'>): ShareTask {
  return { id: e._id, buyerId: e.customerId, urgency: e.urgency, pickup: e.sharePickup!, dropoff: e.shareDropoff!, createdAt: e._creationTime,
    windowEndsAt: e.shareWindowEndsAt!, deadlineAt: e.urgency === 'normal' ? todayDeadlineAt(e._creationTime) : null,
    status: 'posted', selectedRunnerId: e.runnerId ?? null, shareState: 'waiting', manualRunner: false, stopCount: 0 };
}
async function runnerEligible(ctx: QueryCtx, runnerId: Id<'users'>, errands: Doc<'errands'>[]) {
  const user = await ctx.db.get('users', runnerId);
  const access = await ctx.db.query('runnerAccess').withIndex('by_userId', q => q.eq('userId', runnerId)).unique();
  const profile = await ctx.db.query('runnerProfiles').withIndex('by_userId', q => q.eq('userId', runnerId)).unique();
  return !!user && user.role !== 'buyer' && !!access?.enabled && !!profile && errands.every(e => e.customerId !== runnerId && profile.services.includes(e.category));
}
async function members(ctx: QueryCtx, group: Doc<'shareGroups'>) {
  const docs = await Promise.all(group.errandIds.map(id => ctx.db.get('errands', id)));
  if (docs.length !== 2 || docs.some(e => !e || e.shareGroupId !== group._id)) throw new ConvexError('Shared run changed.');
  return docs as Doc<'errands'>[];
}
export const join = mutation({
  args: { id: v.id('errands'), expectedRevision: v.number(), pickup: sharePoint, dropoff: sharePoint }, returns: v.null(),
  handler: async (ctx, args) => {
    const e = await owned(ctx, args.id);
    if (e.shareState === 'waiting' || e.shareState === 'paired') return null;
    if (e.status !== 'posted' || e.runnerId || e.trackingMode || e.completion || e.urgency === 'express') throw new ConvexError('Only unassigned normal or flexible errands can share a route.');
    if ((e.revision ?? 0) !== args.expectedRevision) throw new ConvexError('Errand changed. Review it again.');
    if (e.urgency === 'normal' && todayDeadlineAt(e._creationTime) <= Date.now()) throw new ConvexError('The original Today deadline has passed. Post a new request or use ordinary matching.');
    for (const p of [args.pickup, args.dropoff]) if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng) || Math.abs(p.lat) > 90 || Math.abs(p.lng) > 180) throw new ConvexError('Choose valid map pins.');
    const now = Date.now(); const ends = shareWindowEndsAt(now, e.urgency)!;
    const changes = { sharePickup: args.pickup, shareDropoff: args.dropoff, shareState: 'waiting' as const, shareWindowEndsAt: ends, revision: (e.revision ?? 0) + 1 };
    await ctx.db.patch('errands', e._id, changes);
    const waiting = await ctx.db.query('errands').withIndex('by_shareState', q => q.eq('shareState', 'waiting')).order('asc').filter(q => q.and(q.gt(q.field('shareWindowEndsAt'), now), q.neq(q.field('_id'), e._id))).take(50);
    const candidates = waiting.filter(x => x.sharePickup && x.shareDropoff && x.status === 'posted' && !x.runnerId && !x.trackingMode);
    const decision = rankSharePartners(task({ ...e, ...changes }), candidates.map(task), now)[0];
    if (decision?.accepted) {
      const partnerId = decision.taskIds.find(id => id !== e._id)! as Id<'errands'>;
      const partner = candidates.find(x => x._id === partnerId)!;
      const expiresAt = Math.min(now + 30 * 60_000, decision.stricterDeadlineAt ?? Infinity);
      const groupId = await ctx.db.insert('shareGroups', { errandIds: [e._id, partnerId], route: decision.route.map(s => ({ errandId: s.taskId as Id<'errands'>, kind: s.kind, point: s.point })), savedKm: decision.metrics.savedDistanceKm, soloKm: decision.metrics.soloDistanceKm, sharedKm: decision.metrics.sharedDistanceKm, deadlineAt: decision.stricterDeadlineAt, expiresAt, status: 'open', approvedIds: [], nextStop: 0 });
      for (const member of [e, partner]) {
        await ctx.db.patch('errands', member._id, { shareState: 'paired', shareGroupId: groupId, revision: (member.revision ?? 0) + 1 });
        await ctx.db.insert('errandActivity', { errandId: member._id, kind: 'edited', summary: 'A compatible errand was found. Each buyer approves their own service fee before the shared run starts.' });
        await queuePush(ctx, member.customerId, member._id, 'share', `share-paired:${groupId}`);
      }
      await ctx.scheduler.runAt(expiresAt, internal.share.expire, { groupId });
    } else await ctx.scheduler.runAt(ends, internal.share.expire, { errandId: e._id, windowEndsAt: ends });
    return null;
  },
});
export const expire = internalMutation({
  args: { groupId: v.optional(v.id('shareGroups')), errandId: v.optional(v.id('errands')), windowEndsAt: v.optional(v.number()) }, returns: v.null(),
  handler: async (ctx, args) => {
    if (args.groupId) {
      const g = await ctx.db.get('shareGroups', args.groupId);
      if (g && ['open', 'reserved'].includes(g.status) && g.expiresAt <= Date.now()) {
        const e = await ctx.db.get('errands', g.errandIds[0]); if (e) await dissolveShare(ctx, e, 'The approval window ended.');
      }
    } else if (args.errandId) {
      const e = await ctx.db.get('errands', args.errandId);
      if (e?.shareState === 'waiting' && e.shareWindowEndsAt === args.windowEndsAt && e.shareWindowEndsAt! <= Date.now()) await dissolveShare(ctx, e, 'No compatible partner was found in time.');
    }
    return null;
  },
});
export const leave = mutation({ args: { id: v.id('errands') }, returns: v.null(), handler: async (ctx, { id }) => {
  const e = await owned(ctx, id); if (e.status !== 'posted') throw new ConvexError('This run is already assigned.');
  await dissolveShare(ctx, e, 'A buyer chose ordinary matching.'); return null;
} });
export const quote = mutation({
  args: { groupId: v.id('shareGroups'), fees: v.array(v.number()), note: v.string(), expectedVersion: v.number() }, returns: v.id('shareOffers'),
  handler: async (ctx, args) => {
    const user = await requireRunner(ctx); const g = await ctx.db.get('shareGroups', args.groupId);
    if (!g || g.status !== 'open' || g.expiresAt <= Date.now()) throw new ConvexError('This shared opportunity is no longer open.');
    const errands = await members(ctx, g);
    if (!await runnerEligible(ctx, user._id, errands) || await activeJob(ctx, user._id)) throw new ConvexError('Finish your run and add both services to your profile before quoting.');
    if (args.fees.length !== 2 || args.fees.some(x => !Number.isSafeInteger(x) || x < 100 || x > 1_000_000) || args.note.trim().length > 500) throw new ConvexError('Enter two service fees of GH₵1–10,000 and a note under 500 characters.');
    const rates = await ctx.db.query('runnerPricing').withIndex('by_runnerId', q => q.eq('runnerId', user._id)).unique();
    if (!errands.every(e => rates?.rates.some(r => r.category === e.category))) throw new ConvexError('Set starting prices for both services first.');
    const old = await ctx.db.query('shareOffers').withIndex('by_groupId_and_runnerId', q => q.eq('groupId', g._id).eq('runnerId', user._id)).unique();
    if (old && JSON.stringify(old.fees) === JSON.stringify(args.fees) && old.note === args.note.trim()) return old._id;
    if ((old?.version ?? 0) !== args.expectedVersion) throw new ConvexError('Your offer changed. Review the latest version.');
    const data = { fees: args.fees, note: args.note.trim(), version: (old?.version ?? 0) + 1 };
    const id = old?._id ?? await ctx.db.insert('shareOffers', { ...data, groupId: g._id, runnerId: user._id });
    if (old) await ctx.db.patch('shareOffers', id, data);
    for (const e of errands) await queuePush(ctx, e.customerId, e._id, 'quote', `share-quote:${id}:${data.version}`);
    return id;
  },
});
export const approve = mutation({
  args: { id: v.id('errands'), offerId: v.id('shareOffers'), expectedVersion: v.number() }, returns: v.null(),
  handler: async (ctx, args) => {
    const e = await owned(ctx, args.id); const offer = await ctx.db.get('shareOffers', args.offerId);
    const g = e.shareGroupId ? await ctx.db.get('shareGroups', e.shareGroupId) : null;
    if (!g || !offer || offer.groupId !== g._id || offer.version !== args.expectedVersion) throw new ConvexError('Offer changed. Review the latest fee.');
    if (g.offerId === offer._id && g.approvedIds.includes(e._id) && g.status !== 'dissolved') return null;
    if (!['open', 'reserved'].includes(g.status) || g.expiresAt <= Date.now() || (g.offerId && g.offerId !== offer._id)) throw new ConvexError('Another offer is reserved or this shared run has expired.');
    const errands = await members(ctx, g);
    if (errands.some(x => x.status !== 'posted' || x.runnerId || x.trackingMode) || !await runnerEligible(ctx, offer.runnerId, errands)) throw new ConvexError('The errands or runner are no longer available.');
    const busy = await activeJob(ctx, offer.runnerId);
    if (busy && busy.shareGroupId !== g._id) throw new ConvexError('This runner is busy. Choose another offer.');
    const now = Date.now();
    if (g.deadlineAt !== null && now + (g.sharedKm / 20 * 60 + 20) * 60_000 > g.deadlineAt) throw new ConvexError('There is no longer enough time for this shared route. Choose ordinary matching.');
    await requireFreshAssignment(ctx, offer.runnerId, g._id);
    const approvedIds = [...g.approvedIds, e._id];
    if (approvedIds.length === 1) {
      const position = await ctx.db.query('errandRunners').withIndex('by_runnerId', q => q.eq('runnerId', offer.runnerId)).unique();
      if (position) await ctx.db.patch('errandRunners', position._id, { status: 'busy' });
      const expiresAt = Math.min(g.expiresAt, now + 10 * 60_000);
      await ctx.db.patch('shareGroups', g._id, { status: 'reserved', runnerId: offer.runnerId, offerId: offer._id, approvedIds, expiresAt });
      await ctx.scheduler.runAt(expiresAt, internal.share.expire, { groupId: g._id });
      await queuePush(ctx, offer.runnerId, e._id, 'share', `share-reserved:${g._id}`);
      for (const other of errands) await queuePush(ctx, other.customerId, other._id, 'share', `share-reserved:${g._id}`);
      return null;
    }
    await createTrackingObligation(ctx, g.errandIds, offer.runnerId, g._id);
    await ctx.db.patch('shareGroups', g._id, { status: 'active', approvedIds });
    for (let i = 0; i < errands.length; i++) {
      const member = errands[i];
      const old = await ctx.db.query('runnerQuotes').withIndex('by_errandId_and_runnerId', q => q.eq('errandId', member._id).eq('runnerId', offer.runnerId)).unique();
      const data = { errandId: member._id, runnerId: offer.runnerId, serviceFeePesewas: offer.fees[i], note: offer.note, errandRevision: member.revision ?? 0, version: (old?.version ?? 0) + 1, updatedAt: now, status: 'accepted' as const };
      const quoteId = old?._id ?? await ctx.db.insert('runnerQuotes', data);
      if (old) await ctx.db.patch('runnerQuotes', quoteId, data);
      await ctx.db.patch('errands', member._id, { runnerId: offer.runnerId, status: 'accepted', acceptedAt: now, updatedAt: now, revision: (member.revision ?? 0) + 1, trustResponse: { runnerId: offer.runnerId }, agreedPricing: { quoteId, serviceFeePesewas: offer.fees[i], agreedAt: now } });
      await ctx.db.insert('errandActivity', { errandId: member._id, kind: 'accepted', summary: 'Both buyers approved their individual fees. Your shared runner is assigned.' });
      await queuePush(ctx, member.customerId, member._id, 'share', `share-assigned:${g._id}`);
    }
    const access = await ctx.db.query('runnerAccess').withIndex('by_userId', q => q.eq('userId', offer.runnerId)).unique();
    if (access) await ctx.db.patch('runnerAccess', access._id, { locationSessionId: undefined });
    const position = await ctx.db.query('errandRunners').withIndex('by_runnerId', q => q.eq('runnerId', offer.runnerId)).unique();
    if (position) await ctx.db.patch('errandRunners', position._id, { status: 'busy' });
    await queuePush(ctx, offer.runnerId, errands[0]._id, 'share', `share-assigned:${g._id}`);
    return null;
  },
});
export const withdraw = mutation({ args: { offerId: v.id('shareOffers'), expectedVersion: v.number() }, returns: v.null(), handler: async (ctx, args) => {
  const user = await requireRunner(ctx); const offer = await ctx.db.get('shareOffers', args.offerId);
  if (!offer || offer.runnerId !== user._id) throw new ConvexError('Offer not found.');
  const group = await ctx.db.get('shareGroups', offer.groupId);
  if (!group || !['open', 'reserved'].includes(group.status) || offer.version !== args.expectedVersion) throw new ConvexError('This offer changed or the route is already assigned.');
  if (group.offerId === offer._id) {
    const e = await ctx.db.get('errands', group.errandIds[0]); if (e) await dissolveShare(ctx, e, 'The runner withdrew the shared offer.');
  }
  await ctx.db.delete('shareOffers', offer._id); return null;
} });
// Buyer projection deliberately excludes the other buyer's identity, address and price.
export const buyer = query({ args: { id: v.id('errands') }, returns: buyerView, handler: async (ctx, { id }) => {
  const e = await owned(ctx, id); const g = e.shareGroupId ? await ctx.db.get('shareGroups', e.shareGroupId) : null;
  const offers = g && ['open', 'reserved'].includes(g.status) ? await ctx.db.query('shareOffers').withIndex('by_groupId', q => q.eq('groupId', g._id)).order('desc').take(20) : [];
  return { state: e.shareState ?? 'none', windowEndsAt: e.shareWindowEndsAt ?? null,
    group: g ? { status: g.status, expiresAt: g.expiresAt, savedKm: g.savedKm, approved: g.approvedIds.includes(id), approvals: g.approvedIds.length, stopsDone: g.nextStop } : null,
    offers: (await Promise.all(offers.filter(o => !g?.offerId || g.offerId === o._id).map(async o => {
      const runner = await ctx.db.get('users', o.runnerId);
      const busy = await activeJob(ctx, o.runnerId); const valid = await runnerEligible(ctx, o.runnerId, await members(ctx, g!));
      return { id: o._id, version: o.version, fee: o.fees[g!.errandIds.indexOf(id)], note: o.note, name: runner?.name ?? 'Runner', trust: await runnerTrust(ctx, o.runnerId), canApprove: valid && await assignmentTrackingReady(ctx, o.runnerId, g!._id) && (!busy || busy.shareGroupId === g!._id) && g!.expiresAt > Date.now() && !g!.approvedIds.includes(id) };
    }))).sort((a, b) => Number(b.canApprove) - Number(a.canApprove) || compareRunnerTrust(a.trust, b.trust) || a.id.localeCompare(b.id)) };
} });
export const available = query({ args: {}, returns: v.array(v.object({ id: v.id('shareGroups'), titles: v.array(v.string()), areas: v.array(v.string()), savedKm: v.number() })), handler: async ctx => {
  const user = await requireRunner(ctx);
  const groups = await ctx.db.query('shareGroups').withIndex('by_status', q => q.eq('status', 'open')).order('desc').take(30);
  const result = [];
  for (const g of groups) {
    const errands = await members(ctx, g);
    if (g.expiresAt > Date.now() && await runnerEligible(ctx, user._id, errands)) result.push({ id: g._id, titles: errands.map(e => e.title), areas: errands.map(e => `${e.pickup} → ${e.dropoff}`), savedKm: g.savedKm });
  }
  return result;
} });
export const current = query({ args: {}, returns: v.union(v.null(), v.object({ id: v.id('shareGroups'), status: groupStatus })), handler: async ctx => {
  const user = await requireRunner(ctx); const g = await runnerGroup(ctx, user._id);
  return g ? { id: g._id, status: g.status } : null;
} });
export const runner = query({ args: { id: v.id('shareGroups') }, returns: v.union(v.null(), runnerView), handler: async (ctx, { id }) => {
  const user = await requireRunner(ctx); const g = await ctx.db.get('shareGroups', id);
  if (!g) return null;
  const errands = await members(ctx, g).catch(() => null);
  if (!errands || (g.runnerId !== user._id && (g.status !== 'open' || !await runnerEligible(ctx, user._id, errands)))) return null;
  const offer = await ctx.db.query('shareOffers').withIndex('by_groupId_and_runnerId', q => q.eq('groupId', id).eq('runnerId', user._id)).unique();
  return { group: g, offer, canQuote: g.status === 'open' && !await activeJob(ctx, user._id), errands: errands.map(e => ({ id: e._id, title: e.title, pickup: e.pickup, dropoff: e.dropoff, description: e.description, category: e.category, budgetPesewas: e.budgetPesewas, status: e.status })) };
} });
