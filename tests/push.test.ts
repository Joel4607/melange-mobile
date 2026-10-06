/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import schema from '../convex/schema';
import { queuePush } from '../convex/lib/queuePush';
const modules = import.meta.glob('../convex/**/*.{ts,js}');
const token = (name: string) => `ExpoPushToken[notification-test-${name}]`;
const registration = (name: string) => ({ installationId: `installation-test-${name}`, token: token(name), platform: 'android' as const, messages: true, updates: true });
const network = vi.fn(); let finish: (() => Promise<void>) | undefined;
beforeEach(() => {
  vi.useFakeTimers(); finish = undefined;
  network.mockReset().mockImplementation(async (url: string) => Response.json(url.endsWith('getReceipts') ? { data: { 'test-ticket': { status: 'ok' } } } : { data: { status: 'ok', id: 'test-ticket' } }));
  vi.stubGlobal('fetch', network);
});
afterEach(async () => { if (finish) await finish(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function setup() {
  const t = convexTest(schema, modules); finish = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  const [buyerId, runnerId, otherId] = await t.run(async ctx => [await ctx.db.insert('users', { role: 'buyer', name: 'Buyer' }), await ctx.db.insert('users', { role: 'runner', name: 'Runner' }), await ctx.db.insert('users', { role: 'buyer', name: 'Other' })]);
  const [buyer, runner, other] = [buyerId, runnerId, otherId].map(id => t.withIdentity({ subject: `${id}|session` }));
  await runner.mutation(api.runners.register, { phone: '0241234567', area: 'Osu', transport: 'walking', services: ['delivery'] });
  await runner.mutation(api.pricing.saveRates, { rates: [{ category: 'delivery', startingFeePesewas: 1000 }] });
  const id = await buyer.mutation(api.errands.create, { title: 'Sensitive errand title', description: '', category: 'delivery', pickup: 'Private address', dropoff: 'Another address', budgetPesewas: 0, budgetPurpose: 'items', urgency: 'normal', requestId: 'push-errand-test-001' });
  return { t, buyer, runner, other, buyerId, runnerId, otherId, id };
}
test('device registration requires auth, caps devices, and shared-device reassignment cancels old queued alerts', async () => {
  const { t, buyer, other, buyerId, otherId, id } = await setup();
  await expect(t.mutation(api.push.register, registration('shared'))).rejects.toThrow();
  await expect(buyer.mutation(api.push.register, { ...registration('shared'), token: 'invalid' })).rejects.toThrow();
  await buyer.mutation(api.push.register, registration('shared'));
  await t.run(ctx => queuePush(ctx, buyerId, id, 'quote', 'quote-1'));
  const [job] = await t.run(ctx => ctx.db.query('pushJobs').collect());
  await other.mutation(api.push.register, registration('shared'));
  await buyer.mutation(api.push.unregister, { installationId: registration('shared').installationId });
  expect(await other.query(api.push.device, { installationId: registration('shared').installationId })).toEqual({ messages: true, updates: true });
  expect(await t.mutation(internal.push.claim, { id: job._id })).toBeNull();
  expect(await other.query(api.push.target, { notificationId: job._id })).toBeNull();
  expect(await buyer.query(api.push.target, { notificationId: job._id })).toMatchObject({ role: 'buyer', screen: 'errand' });
  for (let i = 0; i < 7; i++) await other.mutation(api.push.register, registration(`device-${i}`));
  expect((await t.run(ctx => ctx.db.query('pushDevices').withIndex('by_userId', q => q.eq('userId', otherId)).collect())).length).toBe(5);
});
test('quotes, assignment, text/images and direct payments notify the other participant once', async () => {
  const { t, buyer, runner, buyerId, runnerId, id } = await setup();
  await buyer.mutation(api.push.register, registration('buyer')); await runner.mutation(api.push.register, registration('runner'));
  const args = { id, expectedRevision: 0, expectedVersion: 0, serviceFeePesewas: 1000, note: '' };
  const quoteId = await runner.mutation(api.pricing.submitQuote, args); await runner.mutation(api.pricing.submitQuote, args);
  await buyer.mutation(api.pricing.approveQuote, { quoteId, expectedVersion: 1, expectedRevision: 0 });
  await buyer.mutation(api.pricing.approveQuote, { quoteId, expectedVersion: 1, expectedRevision: 0 });
  const text = { errandId: id, channel: String(runnerId), clientId: 'push-message-001', text: 'Private MoMo account details' };
  await buyer.mutation(api.messages.sendText, text); await buyer.mutation(api.messages.sendText, text);
  const storageId = await t.run(ctx => ctx.storage.store(new Blob(['image'], { type: 'image/jpeg' })));
  await runner.mutation(internal.messages.commitImage, { ...text, clientId: 'push-message-image-001', text: '', image: { storageId, mimeType: 'image/jpeg', size: 5 } });
  await buyer.mutation(api.pricing.markSent, { id, method: 'MoMo' }); await buyer.mutation(api.pricing.markSent, { id, method: 'MoMo' });
  await runner.mutation(api.pricing.confirmReceived, { id });
  const jobs = await t.run(ctx => ctx.db.query('pushJobs').collect());
  expect(jobs.filter(j => j.userId === buyerId).map(j => j.kind)).toEqual(['quote', 'message', 'payment_received']);
  expect(jobs.filter(j => j.userId === runnerId).map(j => j.kind)).toEqual(['assigned', 'message', 'payment_sent']);
  const messageJob = jobs.find(j => j.kind === 'message' && j.userId === runnerId)!;
  expect(await runner.query(api.push.target, { notificationId: messageJob._id })).toMatchObject({ role: 'runner', screen: 'chat' });
});
test('pickup, delivery, completion and review alerts follow the lifecycle without duplicate confirmations', async () => {
  const { t, buyer, runner, runnerId, id } = await setup();
  await buyer.mutation(api.push.register, registration('buyer')); await runner.mutation(api.push.register, registration('runner'));
  await t.run(ctx => ctx.db.patch('errands', id, { runnerId, status: 'accepted', revision: 1 }));
  await runner.mutation(api.runnerJobs.advance, { id, expectedRevision: 1, nextStatus: 'picked_up' });
  await t.run(async ctx => {
    const storageId = await ctx.storage.store(new Blob(['image'], { type: 'image/jpeg' }));
    await ctx.db.insert('deliveryProofs', { errandId: id, runnerId, storageId, mimeType: 'image/jpeg', size: 5, requestId: 'push-proof-test-001' });
  });
  await runner.mutation(api.runnerJobs.advance, { id, expectedRevision: 2, nextStatus: 'delivered' });
  await buyer.mutation(api.errands.confirmCompletion, { id, expectedRevision: 3 });
  await buyer.mutation(api.errands.confirmCompletion, { id, expectedRevision: 3 });
  await buyer.mutation(api.reviews.submit, { id, rating: 5, comment: '' });
  expect((await t.run(ctx => ctx.db.query('pushJobs').collect())).map(j => j.kind)).toEqual(['picked_up', 'delivered', 'completed', 'review']);
});
test('category preferences and demo exclusion are checked before enqueueing', async () => {
  const { t, buyer, buyerId, id } = await setup();
  await buyer.mutation(api.push.register, { ...registration('buyer'), messages: false });
  await t.run(ctx => queuePush(ctx, buyerId, id, 'message', 'message-1'));
  await t.run(ctx => queuePush(ctx, buyerId, id, 'quote', 'quote-1'));
  await t.run(ctx => queuePush(ctx, buyerId, id, 'quote', 'quote-1'));
  const jobs = await t.run(ctx => ctx.db.query('pushJobs').collect()); expect(jobs).toHaveLength(1);
  await buyer.mutation(api.push.unregister, { installationId: registration('buyer').installationId });
  expect(await t.mutation(internal.push.claim, { id: jobs[0]._id })).toBeNull();
  await buyer.mutation(api.push.register, registration('buyer'));
  await t.run(ctx => ctx.db.patch('errands', id, { trackingMode: 'demo' }));
  await t.run(ctx => queuePush(ctx, buyerId, id, 'quote', 'quote-2'));
  expect(await t.run(ctx => ctx.db.query('pushJobs').collect())).toHaveLength(1);
});
test('push payloads exclude private content and a ticket is not considered delivery until its receipt', async () => {
  const { t, buyer, buyerId, id } = await setup();
  await buyer.mutation(api.push.register, registration('buyer')); await t.run(ctx => queuePush(ctx, buyerId, id, 'message', 'message-1'));
  const [job] = await t.run(ctx => ctx.db.query('pushJobs').collect());
  await t.action(internal.pushDelivery.send, { id: job._id });
  const payload = JSON.parse(network.mock.calls[0][1].body);
  expect(payload).toMatchObject({ to: token('buyer'), data: { notificationId: job._id, recipientId: buyerId } });
  expect(JSON.stringify(payload)).not.toContain('Sensitive'); expect(JSON.stringify(payload)).not.toContain('Private address');
  expect((await t.run(ctx => ctx.db.get('pushJobs', job._id)))?.state).toBe('ticket');
  await t.action(internal.pushDelivery.receipt, { id: job._id });
  expect((await t.run(ctx => ctx.db.get('pushJobs', job._id)))?.state).toBe('delivered');
});
test('network retries are bounded and stale callbacks cannot finish a newer attempt', async () => {
  const { t, buyer, buyerId, id } = await setup();
  await buyer.mutation(api.push.register, registration('buyer')); await t.run(ctx => queuePush(ctx, buyerId, id, 'quote', 'quote-1'));
  const [job] = await t.run(ctx => ctx.db.query('pushJobs').collect());
  network.mockRejectedValue(new Error('offline'));
  await t.action(internal.pushDelivery.send, { id: job._id });
  const claimed = await t.mutation(internal.push.claim, { id: job._id });
  expect(claimed?.attempt).toBe(2);
  await t.mutation(internal.push.finishSend, { id: job._id, attempt: 1, ticketId: 'obsolete-ticket' });
  expect((await t.run(ctx => ctx.db.get('pushJobs', job._id)))?.state).toBe('sending');
  await t.mutation(internal.push.finishSend, { id: job._id, attempt: 2, errorCode: 'NetworkError', retry: true });
  await t.action(internal.pushDelivery.send, { id: job._id }); await t.action(internal.pushDelivery.send, { id: job._id });
  expect(await t.run(ctx => ctx.db.get('pushJobs', job._id))).toMatchObject({ state: 'failed', attempts: 4 });
});
test('invalid tokens are removed when Expo reports DeviceNotRegistered', async () => {
  const { t, buyer, buyerId, id } = await setup();
  await buyer.mutation(api.push.register, registration('buyer')); await t.run(ctx => queuePush(ctx, buyerId, id, 'quote', 'quote-1'));
  const [job] = await t.run(ctx => ctx.db.query('pushJobs').collect());
  network.mockResolvedValue(Response.json({ data: { status: 'error', details: { error: 'DeviceNotRegistered' } } }));
  await t.action(internal.pushDelivery.send, { id: job._id });
  expect(await buyer.query(api.push.device, { installationId: registration('buyer').installationId })).toBeNull();
  expect(await t.run(ctx => ctx.db.get('pushJobs', job._id))).toMatchObject({ state: 'failed', errorCode: 'DeviceNotRegistered' });
});

async function trackedSetup() {
  const s = await setup(); vi.stubEnv('ENABLE_LOCATION_ACCOUNTABILITY', 'true');
  await s.buyer.mutation(api.push.register, registration('buyer')); await s.runner.mutation(api.push.register, registration('runner'));
  await s.runner.mutation(api.runners.startAvailability, { sessionId: 'push-availability-session' });
  await s.runner.mutation(api.runners.updateLocation, { lat: 5.56, lng: -0.2, capturedAt: Date.now(), status: 'online', sessionId: 'push-availability-session' });
  const quoteId = await s.runner.mutation(api.pricing.submitQuote, { id: s.id, expectedRevision: 0, expectedVersion: 0, serviceFeePesewas: 1000, note: '' });
  await s.buyer.mutation(api.pricing.approveQuote, { quoteId, expectedRevision: 0, expectedVersion: 1 });
  await s.runner.mutation(api.locations.startRunner, { id: s.id, sessionId: 'push-private-session' });
  vi.setSystemTime(Date.now() + 1000);
  const publish = () => s.runner.mutation(api.locations.publishRunner, { id: s.id, sessionId: 'push-private-session', point: { latitude: 5.56, longitude: -0.2, capturedAt: Date.now() } });
  await publish();
  const obligation = () => s.t.run(ctx => ctx.db.query('trackingObligations').unique());
  const refresh = async () => { const o = (await obligation())!; await s.t.mutation(internal.tracking.checkDeadline, { obligationId: o._id, generation: o.generation }); };
  const jobs = () => s.t.run(ctx => ctx.db.query('pushJobs').collect());
  return { ...s, publish, obligation, refresh, jobs };
}

test('pickup alerts use generic copy and opaque routing without pins or private details', async () => {
  const s = await trackedSetup(); await s.runner.mutation(api.pickup.request, { id: s.id }); await s.runner.mutation(api.pickup.request, { id: s.id });
  const jobs = (await s.jobs()).filter(j => j.kind === 'pickup_request'); expect(jobs).toHaveLength(1);
  await s.t.action(internal.pushDelivery.send, { id: jobs[0]._id });
  const payload = JSON.parse(network.mock.calls[0][1].body);
  expect(payload.title).toBe('Collection approval requested');
  expect(payload.data).toEqual({ notificationId: jobs[0]._id, recipientId: s.buyerId });
  for (const privateValue of ['Sensitive', 'Private address', s.id, 'latitude', 'longitude', (await s.obligation())!._id]) expect(JSON.stringify(payload)).not.toContain(privateValue);
});

test('queued tracking notices and targets end at delivery before customer confirmation', async () => {
  const s = await trackedSetup(); await s.runner.mutation(api.pickup.request, { id: s.id });
  const request = (await s.buyer.query(api.pickup.current, { id: s.id }))!;
  await s.buyer.mutation(api.pickup.approve, { id: s.id, expectedRevision: 1, expectedRequestVersion: request.requestVersion });
  await s.runner.mutation(api.runnerJobs.advance, { id: s.id, expectedRevision: 1, nextStatus: 'picked_up' });
  vi.setSystemTime(Date.now() + 31_001); await s.refresh();
  const notice = (await s.jobs()).find(j => j.kind === 'tracking_interrupted' && j.userId === s.buyerId)!;
  expect(await s.buyer.query(api.push.target, { notificationId: notice._id })).toMatchObject({ role: 'buyer', screen: 'errand' });
  await s.t.run(async ctx => {
    const storageId = await ctx.storage.store(new Blob(['proof'], { type: 'image/jpeg' }));
    await ctx.db.insert('deliveryProofs', { errandId: s.id, runnerId: s.runnerId, storageId, mimeType: 'image/jpeg', size: 5, requestId: 'tracking-push-proof' });
  });
  await s.runner.mutation(api.runnerJobs.advance, { id: s.id, expectedRevision: 2, nextStatus: 'delivered' });
  await s.t.action(internal.pushDelivery.send, { id: notice._id });
  expect(network).not.toHaveBeenCalled();
  expect(await s.buyer.query(api.push.target, { notificationId: notice._id })).toBeNull();
  expect(await s.t.run(ctx => ctx.db.get('pushJobs', notice._id))).toMatchObject({ state: 'skipped' });
});

test('a late scheduler cannot dispatch a recovered notice after GPS is stale again', async () => {
  const s = await trackedSetup(); vi.setSystemTime(Date.now() + 31_001); await s.refresh();
  await s.publish(); vi.setSystemTime(Date.now() + 10_000); await s.publish();
  const notice = (await s.jobs()).find(j => j.kind === 'tracking_recovered' && j.userId === s.buyerId)!;
  expect(notice).toBeTruthy();
  vi.setSystemTime(Date.now() + 31_001);
  await s.t.action(internal.pushDelivery.send, { id: notice._id });
  expect(network).not.toHaveBeenCalled(); expect(await s.buyer.query(api.push.target, { notificationId: notice._id })).toBeNull();
});
