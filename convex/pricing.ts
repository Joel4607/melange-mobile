import { createTrackingObligation, requireFreshAssignment, assignmentTrackingReady } from './lib/trackingLifecycle';
import { queuePush } from './lib/queuePush';
import { runnerTrust } from './lib/runnerTrust';
import { trustSummary } from './lib/trustFields';
import { getAuthUserId } from '@convex-dev/auth/server';
import { paginationOptsValidator, paginationResultValidator } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import { mutation, query, type QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import { activeJob, available, requireRunner } from './runnerJobs';
import { agreedPricingValidator, directPaymentValidator, rateValidator } from './lib/pricingFields';

function fee(amount: number) {
  if (!Number.isSafeInteger(amount) || amount < 100 || amount > 1_000_000) throw new ConvexError('Service fees must be GH₵1–10,000 with at most two decimal places.');
}
async function owner(ctx: QueryCtx, id: Id<'errands'>) {
  const userId = await getAuthUserId(ctx);
  const errand = await ctx.db.get('errands', id);
  if (!userId || !errand || errand.customerId !== userId) throw new ConvexError('Errand not found.');
  return errand;
}
async function eligible(ctx: QueryCtx, id: Id<'users'>) {
  const user = await ctx.db.get('users', id);
  const access = await ctx.db.query('runnerAccess').withIndex('by_userId', q => q.eq('userId', id)).unique();
  const profile = await ctx.db.query('runnerProfiles').withIndex('by_userId', q => q.eq('userId', id)).unique();
  return user && user.role !== 'buyer' && access?.enabled && profile ? user : null;
}
export const mine = query({
  args: {}, returns: v.array(rateValidator),
  handler: async ctx => {
    const user = await requireRunner(ctx);
    return (await ctx.db.query('runnerPricing').withIndex('by_runnerId', q => q.eq('runnerId', user._id)).unique())?.rates ?? [];
  },
});
export const saveRates = mutation({
  args: { rates: v.array(rateValidator) }, returns: v.null(),
  handler: async (ctx, { rates }) => {
    const user = await requireRunner(ctx);
    if (rates.length > 6 || new Set(rates.map(r => r.category)).size !== rates.length) throw new ConvexError('Set one price per service.');
    rates.forEach(r => fee(r.startingFeePesewas));
    const existing = await ctx.db.query('runnerPricing').withIndex('by_runnerId', q => q.eq('runnerId', user._id)).unique();
    const data = { rates, updatedAt: Date.now() };
    if (existing) await ctx.db.patch('runnerPricing', existing._id, data);
    else await ctx.db.insert('runnerPricing', { ...data, runnerId: user._id });
    return null;
  },
});
export const myQuote = query({
  args: { id: v.id('errands') }, returns: v.union(v.null(), schema.doc('runnerQuotes')),
  handler: async (ctx, { id }) => {
    const runner = await requireRunner(ctx);
    return await ctx.db.query('runnerQuotes').withIndex('by_errandId_and_runnerId', q => q.eq('errandId', id).eq('runnerId', runner._id)).unique();
  },
});
export const submitQuote = mutation({
  args: { id: v.id('errands'), expectedRevision: v.number(), expectedVersion: v.number(), serviceFeePesewas: v.number(), note: v.string() },
  returns: v.id('runnerQuotes'),
  handler: async (ctx, args) => {
    const runner = await requireRunner(ctx);
    const errand = await ctx.db.get('errands', args.id);
    if (!errand || !available(errand, runner._id)) throw new ConvexError('This errand is no longer available.');
    if (args.expectedRevision !== (errand.revision ?? 0)) throw new ConvexError('The buyer updated this errand. Review it before quoting again.');
    fee(args.serviceFeePesewas);
    const note = args.note.trim();
    if (note.length > 500) throw new ConvexError('Keep your price explanation under 500 characters.');
    const old = await ctx.db.query('runnerQuotes').withIndex('by_errandId_and_runnerId', q => q.eq('errandId', args.id).eq('runnerId', runner._id)).unique();
    if (old?.status === 'pending' && old.errandRevision === args.expectedRevision && old.serviceFeePesewas === args.serviceFeePesewas && old.note === note) return old._id;
    if (args.expectedVersion !== (old?.version ?? 0)) throw new ConvexError('Your quote changed. Reopen the form before updating it.');
    if (await activeJob(ctx, runner._id)) throw new ConvexError('Finish your active errand before submitting another quote.');
    const pricing = await ctx.db.query('runnerPricing').withIndex('by_runnerId', q => q.eq('runnerId', runner._id)).unique();
    const rate = pricing?.rates.find(r => r.category === errand.category);
    if (!rate) throw new ConvexError('Set a starting price for this service in My pricing first.');
    const data = { serviceFeePesewas: args.serviceFeePesewas, startingFeePesewas: rate.startingFeePesewas, note, errandRevision: args.expectedRevision, version: (old?.version ?? 0) + 1, status: 'pending' as const, updatedAt: Date.now() };
    let quoteId;
    if (old) { await ctx.db.patch('runnerQuotes', old._id, data); quoteId = old._id; }
    else quoteId = await ctx.db.insert('runnerQuotes', { ...data, errandId: args.id, runnerId: runner._id });
    await queuePush(ctx, errand.customerId, errand._id, 'quote', `quote:${quoteId}:${data.version}`);
    return quoteId;
  },
});
export const closeQuote = mutation({
  args: { quoteId: v.id('runnerQuotes'), expectedVersion: v.number() }, returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const quote = await ctx.db.get('runnerQuotes', args.quoteId);
    const errand = quote ? await ctx.db.get('errands', quote.errandId) : null;
    if (!quote || !errand || !userId || (quote.runnerId !== userId && errand.customerId !== userId)) throw new ConvexError('Quote not found.');
    const status = quote.runnerId === userId ? 'withdrawn' as const : 'declined' as const;
    if (quote.status === status && quote.version === args.expectedVersion + 1) return null;
    if (quote.status !== 'pending' || quote.version !== args.expectedVersion || errand.status !== 'posted') throw new ConvexError('This quote changed or the errand has already been assigned.');
    await ctx.db.patch('runnerQuotes', quote._id, { status, version: quote.version + 1, updatedAt: Date.now() });
    await queuePush(ctx, status === 'withdrawn' ? errand.customerId : quote.runnerId, errand._id, 'quote_decision', `quote-decision:${quote._id}:${quote.version + 1}`);
    return null;
  },
});
export const approveQuote = mutation({
  args: { quoteId: v.id('runnerQuotes'), expectedVersion: v.number(), expectedRevision: v.number() }, returns: v.id('errands'),
  handler: async (ctx, args) => {
    const quote = await ctx.db.get('runnerQuotes', args.quoteId);
    if (!quote) throw new ConvexError('Quote not found.');
    const errand = await owner(ctx, quote.errandId);
    if (errand.agreedPricing?.quoteId === quote._id && quote.status === 'accepted' && quote.version === args.expectedVersion) return errand._id;
    if (!available(errand, quote.runnerId) || quote.status !== 'pending') throw new ConvexError('This quote is no longer available.');
    if (quote.version !== args.expectedVersion || quote.errandRevision !== (errand.revision ?? 0) || args.expectedRevision !== (errand.revision ?? 0)) throw new ConvexError('The quote or errand changed. Review the latest price before approving.');
    const runner = await eligible(ctx, quote.runnerId);
    if (!runner) throw new ConvexError('This runner is no longer available.');
    if (await activeJob(ctx, runner._id)) throw new ConvexError('This runner now has an active errand. Choose another quote or try later.');
    await requireFreshAssignment(ctx, runner._id);
    await createTrackingObligation(ctx, [errand._id], runner._id);
    const now = Date.now();
    await ctx.db.patch('runnerQuotes', quote._id, { status: 'accepted', updatedAt: now });
    await ctx.db.patch('errands', errand._id, { runnerId: runner._id, status: 'accepted', acceptedAt: now, updatedAt: now, revision: (errand.revision ?? 0) + 1, trustResponse: { runnerId: runner._id }, agreedPricing: { quoteId: quote._id, serviceFeePesewas: quote.serviceFeePesewas, agreedAt: now } });
    await ctx.db.insert('errandActivity', { errandId: errand._id, kind: 'accepted', isDemo: false, summary: `You approved ${runner.name?.trim() || 'your runner'}’s service fee of GH₵${(quote.serviceFeePesewas / 100).toFixed(2)}. Runner assigned. Item costs are separate.` });
    const access = await ctx.db.query('runnerAccess').withIndex('by_userId', q => q.eq('userId', runner._id)).unique();
    if (access) await ctx.db.patch('runnerAccess', access._id, { locationSessionId: undefined });
    const position = await ctx.db.query('errandRunners').withIndex('by_runnerId', q => q.eq('runnerId', runner._id)).unique();
    if (position && position.status !== 'offline') await ctx.db.patch('errandRunners', position._id, { status: 'busy' });
    await queuePush(ctx, runner._id, errand._id, 'assigned', `assigned:${quote._id}`);
    return errand._id;
  },
});
const quoteView = schema.doc('runnerQuotes').extend({ runnerName: v.string(), canApprove: v.boolean(), reason: v.string(), runnerBio: v.string(), runnerPhotoUrl: v.union(v.string(), v.null()), trust: v.union(trustSummary, v.null()) });
export const forBuyer = query({
  args: { id: v.id('errands'), paginationOpts: paginationOptsValidator }, returns: paginationResultValidator(quoteView),
  handler: async (ctx, args) => {
    const errand = await owner(ctx, args.id);
    const page = await ctx.db.query('runnerQuotes').withIndex('by_errandId', q => q.eq('errandId', args.id)).order('desc').paginate(args.paginationOpts);
    return { ...page, page: await Promise.all(page.page.map(async quote => {
      const runner = await eligible(ctx, quote.runnerId);
      const profile = runner ? await ctx.db.query('runnerProfiles').withIndex('by_userId', q => q.eq('userId', runner._id)).unique() : null;
      const reason = quote.status !== 'pending' ? quote.status : !available(errand, quote.runnerId) ? 'Errand unavailable' : quote.errandRevision !== (errand.revision ?? 0) ? 'Awaiting a new quote after your edit' : !runner ? 'Runner unavailable' : await activeJob(ctx, quote.runnerId) ? 'Runner is busy' : !await assignmentTrackingReady(ctx, quote.runnerId) ? 'Waiting for a fresh runner location' : '';
      return { ...quote, runnerName: runner?.name || 'Runner', canApprove: !reason, reason, runnerBio: profile?.bio ?? '', runnerPhotoUrl: profile?.photo ? await ctx.storage.getUrl(profile.photo.storageId) : null, trust: runner ? await runnerTrust(ctx, runner._id) : null };
    })) };
  },
});
export const myQuotes = query({
  args: { paginationOpts: paginationOptsValidator }, returns: paginationResultValidator(schema.doc('runnerQuotes').extend({ title: v.string(), availability: v.string() })),
  handler: async (ctx, args) => {
    const runner = await requireRunner(ctx);
    const page = await ctx.db.query('runnerQuotes').withIndex('by_runnerId', q => q.eq('runnerId', runner._id)).order('desc').paginate(args.paginationOpts);
    return { ...page, page: await Promise.all(page.page.map(async quote => {
      const errand = await ctx.db.get('errands', quote.errandId);
      const availability = quote.status !== 'pending' ? quote.status : !errand || !available(errand, runner._id) ? 'No longer available' : quote.errandRevision !== (errand.revision ?? 0) ? 'Buyer edited request — submit a new quote' : 'Awaiting buyer approval';
      return { ...quote, title: errand?.title ?? 'Errand unavailable', availability };
    })) };
  },
});
export const payment = query({
  args: { id: v.id('errands') }, returns: v.union(v.null(), v.object({ agreed: v.union(v.null(), agreedPricingValidator), payment: v.union(v.null(), directPaymentValidator), canRecord: v.boolean() })),
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    const errand = await ctx.db.get('errands', id);
    if (!userId || !errand || (errand.customerId !== userId && errand.runnerId !== userId) || errand.trackingMode) return null;
    return { agreed: errand.agreedPricing ?? null, payment: errand.directPayment ?? null, canRecord: !!errand.agreedPricing && ['accepted', 'picked_up', 'delivered'].includes(errand.status) };
  },
});
export const markSent = mutation({
  args: { id: v.id('errands'), method: v.string() }, returns: v.null(),
  handler: async (ctx, { id, method }) => {
    const errand = await owner(ctx, id);
    if (!errand.agreedPricing || !errand.runnerId || errand.trackingMode || !['accepted', 'picked_up', 'delivered'].includes(errand.status)) throw new ConvexError('No agreed service fee is available for this errand.');
    if (errand.directPayment) return null;
    const name = method.trim();
    if (!name || name.length > 80) throw new ConvexError('Enter the payment method, up to 80 characters.');
    await ctx.db.patch('errands', id, { directPayment: { sentAt: Date.now(), method: name } });
    await queuePush(ctx, errand.runnerId, id, 'payment_sent', `payment-sent:${id}`);
    return null;
  },
});
export const confirmReceived = mutation({
  args: { id: v.id('errands') }, returns: v.null(),
  handler: async (ctx, { id }) => {
    const runner = await requireRunner(ctx);
    const errand = await ctx.db.get('errands', id);
    if (!errand || errand.runnerId !== runner._id || !errand.agreedPricing || !errand.directPayment || errand.trackingMode || !['accepted', 'picked_up', 'delivered'].includes(errand.status)) throw new ConvexError('Only the assigned runner can confirm a payment reported by the buyer.');
    if (errand.directPayment.receivedAt) return null;
    await ctx.db.patch('errands', id, { directPayment: { ...errand.directPayment, receivedAt: Date.now() } });
    await queuePush(ctx, errand.customerId, id, 'payment_received', `payment-received:${id}`);
    return null;
  },
});
export const earnings = query({
  args: { paginationOpts: paginationOptsValidator }, returns: paginationResultValidator(v.object({ id: v.id('errands'), title: v.string(), status: v.string(), completed: v.boolean(), agreed: agreedPricingValidator, payment: v.union(v.null(), directPaymentValidator) })),
  handler: async (ctx, args) => {
    const runner = await requireRunner(ctx);
    const page = await ctx.db.query('errands').withIndex('by_runnerId_updatedAt', q => q.eq('runnerId', runner._id)).order('desc').filter(q => q.and(q.neq(q.field('agreedPricing'), undefined), q.eq(q.field('trackingMode'), undefined))).paginate(args.paginationOpts);
    return { ...page, page: page.page.map(e => ({ id: e._id, title: e.title, status: e.status, completed: !!e.completion, agreed: e.agreedPricing!, payment: e.directPayment ?? null })) };
  },
});
