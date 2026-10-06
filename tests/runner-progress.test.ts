import { approveJob } from './helpers/approve-job';
/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import schema from '../convex/schema';

const modules = import.meta.glob('../convex/**/*.{ts,js}');
const sessionId = 'runner-progress-gps-001';
const point = () => ({ latitude: 5.56, longitude: -0.19, accuracy: 12, capturedAt: Date.now() });
function proofForm(id: string, requestId = 'handover-test-0001') {
  const form = new FormData(); form.append('id', id); form.append('requestId', requestId);
  const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII='), c => c.charCodeAt(0));
  form.append('image', new Blob([bytes], { type: 'image/png' }), 'handover.png'); return form;
}
let finish: (() => Promise<void>) | undefined;
beforeEach(() => { vi.useFakeTimers(); finish = undefined; });
afterEach(async () => { if (finish) await finish(); vi.useRealTimers(); });

async function setup() {
  const t = convexTest(schema, modules);
  finish = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  const [buyerId, runnerId, otherId] = await t.run(async ctx => [
    await ctx.db.insert('users', { name: 'Buyer', role: 'buyer' }),
    await ctx.db.insert('users', { name: 'Runner', role: 'runner' }),
    await ctx.db.insert('users', { name: 'Other', role: 'runner' }),
  ]);
  const buyer = t.withIdentity({ subject: `${buyerId}|session` });
  const runner = t.withIdentity({ subject: `${runnerId}|session` });
  const other = t.withIdentity({ subject: `${otherId}|session` });
  for (const user of [runner, other]) await user.mutation(api.runners.register, { phone: '0241234567', area: 'Osu', transport: 'walking', services: ['delivery'] });
  for (const account of [runner, other]) await account.mutation(api.pricing.saveRates, { rates: [{ category: 'groceries', startingFeePesewas: 2000 }, { category: 'delivery', startingFeePesewas: 2000 }] });
  const id = await buyer.mutation(api.errands.create, { title: 'Collect parcel', description: '', category: 'delivery', pickup: 'Osu shop', dropoff: 'Labone office', budgetPesewas: 5000, urgency: 'normal', requestId: 'runner-progress-job-001' });
  await approveJob(t, runner, { id, expectedRevision: 0 });
  return { t, buyer, runner, other, runnerId, id };
}

test('real runner pickup and delivery lead to buyer confirmation and review', async () => {
  const { t, buyer, runner, runnerId, id } = await setup();
  await runner.mutation(api.locations.startRunner, { id, sessionId });
  await runner.mutation(api.locations.publishRunner, { id, sessionId, point: point() });
  await runner.mutation(api.runnerJobs.advance, { id, expectedRevision: 1, nextStatus: 'picked_up' });
  expect(await buyer.query(api.errands.get, { id })).toMatchObject({ status: 'picked_up', revision: 2, pickedUpAt: Date.now() });
  await expect(runner.mutation(api.runnerJobs.advance, { id, expectedRevision: 2, nextStatus: 'delivered' })).rejects.toThrow('handover photo');
  expect((await runner.fetch('/delivery/photo', { method: 'POST', body: proofForm(id) })).status).toBe(200);
  await runner.mutation(api.runnerJobs.advance, { id, expectedRevision: 2, nextStatus: 'delivered' });
  const delivered = await buyer.query(api.errands.get, { id });
  expect(delivered).toMatchObject({ status: 'delivered', deliveredAt: Date.now(), revision: 3 });
  expect(delivered?.completion).toBeUndefined();
  expect(await runner.query(api.runnerJobs.capacity, {})).toBeNull();
  expect(await buyer.query(api.locations.current, { id })).toBeNull();
  expect(await t.run(ctx => ctx.db.query('runnerLocations').unique())).toMatchObject({ sharing: false });
  await expect(runner.mutation(api.locations.publishRunner, { id, sessionId, point: point() })).rejects.toThrow('active errand');
  await buyer.mutation(api.errands.confirmCompletion, { id, expectedRevision: 3 });
  await buyer.mutation(api.reviews.submit, { id, rating: 5, comment: 'Delivered with care.' });
  expect((await buyer.query(api.errands.get, { id }))?.completion).toMatchObject({ runnerId, isDemo: false });
  expect((await runner.query(api.runners.dashboard, {}))?.recentReviews).toMatchObject([{ rating: 5 }]);
});

test('only the assigned runner can advance; pickup cannot be skipped', async () => {
  const { t, buyer, runner, other, id } = await setup();
  for (const user of [t, buyer, other]) await expect(user.mutation(api.runnerJobs.advance, { id, expectedRevision: 1, nextStatus: 'picked_up' })).rejects.toThrow();
  await expect(runner.mutation(api.runnerJobs.advance, { id, expectedRevision: 1, nextStatus: 'delivered' })).rejects.toThrow('pickup');
  await expect(runner.mutation(api.runnerJobs.advance, { id, expectedRevision: 0, nextStatus: 'picked_up' })).rejects.toThrow('changed');
  expect((await buyer.query(api.errands.get, { id }))?.status).toBe('accepted');
});

test('progress retries do not duplicate events or rewind delivered errands', async () => {
  const { t, buyer, runner, id } = await setup();
  for (let i = 0; i < 2; i++) await runner.mutation(api.runnerJobs.advance, { id, expectedRevision: 1, nextStatus: 'picked_up' });
  expect((await runner.fetch('/delivery/photo', { method: 'POST', body: proofForm(id) })).status).toBe(200);
  for (let i = 0; i < 2; i++) await runner.mutation(api.runnerJobs.advance, { id, expectedRevision: 2, nextStatus: 'delivered' });
  await runner.mutation(api.runnerJobs.advance, { id, expectedRevision: 1, nextStatus: 'picked_up' });
  const events = await buyer.query(api.errands.history, { id, paginationOpts: { numItems: 10, cursor: null } });
  expect(events.page.map(event => event.kind).sort()).toEqual(['accepted', 'delivered', 'picked_up']);
  expect(await buyer.query(api.errands.get, { id })).toMatchObject({ status: 'delivered', revision: 3 });
});

test('handover photos enforce ownership, stage, privacy and upload retry deduplication', async () => {
  const { t, runner, buyer, other, id } = await setup();
  expect((await runner.fetch('/delivery/photo', { method: 'POST', body: proofForm(id) })).status).toBe(400);
  await runner.mutation(api.runnerJobs.advance, { id, expectedRevision: 1, nextStatus: 'picked_up' });
  for (const user of [buyer, other]) expect((await user.fetch('/delivery/photo', { method: 'POST', body: proofForm(id) })).status).toBe(400);
  const first = await runner.fetch('/delivery/photo', { method: 'POST', body: proofForm(id) });
  const retry = await runner.fetch('/delivery/photo', { method: 'POST', body: proofForm(id) });
  expect(first.status).toBe(200); expect(await first.json()).toEqual(await retry.json());
  expect(await t.run(ctx => ctx.db.system.query('_storage').collect())).toHaveLength(1);
  expect((await buyer.query(api.deliveryProofs.get, { id }))?.url).toBeTruthy();
  expect(await other.query(api.deliveryProofs.get, { id })).toBeNull();
  expect(await t.query(api.deliveryProofs.get, { id })).toBeNull();
  expect((await runner.fetch('/delivery/photo', { method: 'POST', body: proofForm(id, 'different-photo-001') })).status).toBe(400);
  expect(await t.run(ctx => ctx.db.system.query('_storage').collect())).toHaveLength(1);
  await runner.mutation(api.runnerJobs.advance, { id, expectedRevision: 2, nextStatus: 'delivered' });
  expect((await runner.fetch('/delivery/photo', { method: 'POST', body: proofForm(id) })).status).toBe(200);
});

test('invalid handover photo bytes never create proof or storage records', async () => {
  const { t, runner, id } = await setup();
  await runner.mutation(api.runnerJobs.advance, { id, expectedRevision: 1, nextStatus: 'picked_up' });
  const form = new FormData(); form.append('id', id); form.append('requestId', 'bad-handover-0001');
  form.append('image', new Blob(['not a valid image at all'], { type: 'image/jpeg' }), 'photo.jpg');
  expect((await runner.fetch('/delivery/photo', { method: 'POST', body: form })).status).toBe(400);
  expect(await t.run(ctx => ctx.db.query('deliveryProofs').collect())).toHaveLength(0);
  expect(await t.run(ctx => ctx.db.system.query('_storage').collect())).toHaveLength(0);
});

test('runner updates cannot alter cancelled or demo errands', async () => {
  const { t, runner, id } = await setup();
  await t.run(ctx => ctx.db.patch('errands', id, { status: 'cancelled' }));
  await expect(runner.mutation(api.runnerJobs.advance, { id, expectedRevision: 1, nextStatus: 'picked_up' })).rejects.toThrow();
  await t.run(ctx => ctx.db.patch('errands', id, { status: 'accepted', trackingMode: 'demo' }));
  await expect(runner.mutation(api.runnerJobs.advance, { id, expectedRevision: 1, nextStatus: 'picked_up' })).rejects.toThrow();
});

test('stopping GPS rejects queued updates without losing the last known position', async () => {
  const { t, buyer, runner, id } = await setup();
  await runner.mutation(api.locations.startRunner, { id, sessionId });
  expect(await runner.mutation(api.locations.publishRunner, { id, sessionId, point: point() })).toBe(true);
  await runner.mutation(api.locations.stopRunner, { id, sessionId });
  vi.advanceTimersByTime(5000);
  expect(await runner.mutation(api.locations.publishRunner, { id, sessionId, point: point() })).toBe(false);
  expect(await buyer.query(api.locations.current, { id })).toMatchObject({ sharing: false, point: { latitude: 5.56 } });
});

test('old GPS sessions cannot publish or stop a replacement session', async () => {
  const { t, buyer, runner, other, id } = await setup();
  await runner.mutation(api.locations.startRunner, { id, sessionId });
  const replacement = 'runner-progress-gps-002';
  await runner.mutation(api.locations.startRunner, { id, sessionId: replacement });
  expect(await runner.mutation(api.locations.publishRunner, { id, sessionId, point: point() })).toBe(false);
  await runner.mutation(api.locations.publishRunner, { id, sessionId: replacement, point: point() });
  await runner.mutation(api.locations.stopRunner, { id, sessionId });
  await other.mutation(api.locations.stopRunner, { id, sessionId: replacement });
  expect(await buyer.query(api.locations.current, { id })).toMatchObject({ sharing: true, sessionId: replacement });
  await expect(other.mutation(api.locations.startRunner, { id, sessionId })).rejects.toThrow('assigned runner');
});

test('GPS lease expires reactively and a fresh reading can resume sharing', async () => {
  const { t, buyer, runner, id } = await setup();
  await runner.mutation(api.locations.startRunner, { id, sessionId });
  await runner.mutation(api.locations.publishRunner, { id, sessionId, point: point() });
  vi.advanceTimersByTime(30_000);
  await t.finishInProgressScheduledFunctions();
  expect(await buyer.query(api.locations.current, { id })).toMatchObject({ sharing: false });
  expect(await runner.mutation(api.locations.publishRunner, { id, sessionId, point: point() })).toBe(true);
  expect(await buyer.query(api.locations.current, { id })).toMatchObject({ sharing: true });
});

test('renewed GPS survives the original lease and revoked access rejects updates', async () => {
  const { t, buyer, runner, runnerId, id } = await setup();
  await runner.mutation(api.locations.startRunner, { id, sessionId });
  await runner.mutation(api.locations.publishRunner, { id, sessionId, point: point() });
  vi.advanceTimersByTime(20_000);
  await runner.mutation(api.locations.publishRunner, { id, sessionId, point: point() });
  vi.advanceTimersByTime(10_000);
  await t.finishInProgressScheduledFunctions();
  expect(await buyer.query(api.locations.current, { id })).toMatchObject({ sharing: true });
  await t.mutation(internal.runners.setRunnerAccess, { userId: runnerId, enabled: false });
  await expect(runner.mutation(api.locations.publishRunner, { id, sessionId, point: point() })).rejects.toThrow('unavailable');
  await runner.mutation(api.locations.stopRunner, { id, sessionId });
  expect(await buyer.query(api.locations.current, { id })).toBeNull();
});

test('GPS freshness expires based on capture time rather than late arrival time', async () => {
  const { t, buyer, runner, id } = await setup();
  await runner.mutation(api.locations.startRunner, { id, sessionId });
  await runner.mutation(api.locations.publishRunner, { id, sessionId, point: { ...point(), capturedAt: Date.now() - 20_000 } });
  vi.advanceTimersByTime(10_000);
  await t.finishInProgressScheduledFunctions();
  expect(await buyer.query(api.locations.current, { id })).toMatchObject({ sharing: false });
});
