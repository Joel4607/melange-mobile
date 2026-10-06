/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import schema from '../convex/schema';

const modules = import.meta.glob('../convex/**/*.{ts,js}');
const sessionId = 'map-test-session-001';
const point = () => ({ latitude: 5.56, longitude: -0.19, capturedAt: Date.now() });
beforeEach(() => { vi.stubEnv('ENABLE_DEMO_TRACKING', 'true'); vi.useFakeTimers(); });
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });
async function setup() {
  const t = convexTest(schema, modules);
  const [ownerId, runnerId, otherId] = await t.run(async (ctx) => [await ctx.db.insert('users', { name: 'Owner' }), await ctx.db.insert('users', { name: 'Runner' }), await ctx.db.insert('users', { name: 'Other' })]);
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  const runner = t.withIdentity({ subject: `${runnerId}|session` });
  const other = t.withIdentity({ subject: `${otherId}|session` });
  const id = await owner.mutation(api.errands.create, { title: 'Collect parcel', description: '', category: 'delivery', pickup: 'Osu market', dropoff: 'Oxford Street', budgetPesewas: 5000, urgency: 'normal', requestId: 'map-request-0001' });
  await owner.mutation(api.errands.advanceDemoTracking, { id, nextStatus: 'accepted', expectedRevision: 0 });
  return { t, owner, runner, other, id, runnerId, otherId };
}

test('a demo location is shared privately and replaces its previous point', async () => {
  const { t, owner, other, id } = await setup();
  await owner.mutation(api.locations.startDemo, { id, sessionId });
  expect(await owner.mutation(api.locations.publishDemo, { id, sessionId, point: point() })).toBe(true);
  expect(await owner.query(api.locations.current, { id })).toMatchObject({ source: 'demo_route', sharing: true, point: point() });
  expect(await other.query(api.locations.current, { id })).toBeNull();
  await expect(t.query(api.locations.current, { id })).rejects.toThrow('Sign in');
  vi.setSystemTime(Date.now() + 3000);
  await owner.mutation(api.locations.publishDemo, { id, sessionId, point: { ...point(), latitude: 5.57 } });
  expect((await owner.query(api.locations.current, { id }))?.point?.latitude).toBe(5.57);
  expect(await t.run(async (ctx) => ctx.db.query('runnerLocations').collect())).toHaveLength(1);
});

test('stopping or replacing a demo rejects late updates from that session', async () => {
  const { owner, id } = await setup();
  await owner.mutation(api.locations.startDemo, { id, sessionId });
  await owner.mutation(api.locations.stopDemo, { id, sessionId });
  expect(await owner.mutation(api.locations.publishDemo, { id, sessionId, point: point() })).toBe(false);
  await owner.mutation(api.locations.startDemo, { id, sessionId: 'new-map-session-002' });
  expect(await owner.mutation(api.locations.publishDemo, { id, sessionId, point: point() })).toBe(false);
  await owner.mutation(api.locations.stopDemo, { id, sessionId });
  expect((await owner.query(api.locations.current, { id }))?.sharing).toBe(true);
});

test('unrelated customers cannot start, publish or stop location sharing', async () => {
  const { owner, other, id } = await setup();
  await owner.mutation(api.locations.startDemo, { id, sessionId });
  await expect(other.mutation(api.locations.startDemo, { id, sessionId })).rejects.toThrow();
  await expect(other.mutation(api.locations.publishDemo, { id, sessionId, point: point() })).rejects.toThrow();
  await expect(other.mutation(api.locations.stopDemo, { id, sessionId })).rejects.toThrow();
});

test('disabled demos cannot start or publish', async () => {
  const { owner, id } = await setup();
  await owner.mutation(api.locations.startDemo, { id, sessionId });
  vi.stubEnv('ENABLE_DEMO_TRACKING', 'false');
  await expect(owner.mutation(api.locations.startDemo, { id, sessionId })).rejects.toThrow('disabled');
  await expect(owner.mutation(api.locations.publishDemo, { id, sessionId, point: point() })).rejects.toThrow('disabled');
  await owner.mutation(api.locations.stopDemo, { id, sessionId });
});

test('validates coordinate bounds, accuracy and reading age', async () => {
  const { owner, id } = await setup();
  await owner.mutation(api.locations.startDemo, { id, sessionId });
  for (const invalid of [{ latitude: NaN }, { latitude: 91 }, { longitude: -181 }, { longitude: Infinity }, { accuracy: -1 }, { capturedAt: Date.now() - 61000 }, { capturedAt: Date.now() + 11000 }]) {
    await expect(owner.mutation(api.locations.publishDemo, { id, sessionId, point: { ...point(), ...invalid } })).rejects.toThrow();
  }
  expect((await owner.query(api.locations.current, { id }))?.point).toBeUndefined();
});

test('throttles rapid updates and ignores out-of-order readings', async () => {
  const { owner, id } = await setup();
  await owner.mutation(api.locations.startDemo, { id, sessionId });
  const first = point();
  await owner.mutation(api.locations.publishDemo, { id, sessionId, point: first });
  vi.setSystemTime(Date.now() + 500);
  expect(await owner.mutation(api.locations.publishDemo, { id, sessionId, point: point() })).toBe(false);
  vi.setSystemTime(Date.now() + 3000);
  expect(await owner.mutation(api.locations.publishDemo, { id, sessionId, point: first })).toBe(false);
  expect(await owner.mutation(api.locations.publishDemo, { id, sessionId, point: point() })).toBe(true);
});

test('real GPS requires the active assigned runner; customers cannot impersonate them', async () => {
  const { t, owner, runner, other, id, runnerId, otherId } = await setup();
  await t.run(async (ctx) => ctx.db.patch('errands', id, { trackingMode: undefined, runnerId }));
  await t.mutation(internal.runners.setRunnerAccess, { userId: runnerId, enabled: true });
  await runner.mutation(api.locations.startRunner, { id, sessionId });
  for (const client of [owner, other]) await expect(client.mutation(api.locations.publishRunner, { id, sessionId, point: point() })).rejects.toThrow('assigned runner');
  expect(await runner.mutation(api.locations.publishRunner, { id, sessionId, point: { ...point(), accuracy: 15 } })).toBe(true);
  expect(await owner.query(api.locations.current, { id })).toMatchObject({ source: 'runner_gps', publisherId: runnerId });
  await expect(owner.mutation(api.locations.startDemo, { id, sessionId })).rejects.toThrow();
  await t.run(async (ctx) => ctx.db.patch('errands', id, { runnerId: otherId }));
  expect(await owner.query(api.locations.current, { id })).toBeNull();
  await expect(runner.mutation(api.locations.publishRunner, { id, sessionId, point: point() })).rejects.toThrow();
  await t.finishAllScheduledFunctions(vi.runAllTimers);
});

test.each(['delivered', 'cancelled'] as const)('ends location access and writes after %s', async (status) => {
  const { t, owner, id } = await setup();
  await owner.mutation(api.locations.startDemo, { id, sessionId });
  await owner.mutation(api.locations.publishDemo, { id, sessionId, point: point() });
  await t.run(async (ctx) => ctx.db.patch('errands', id, { status }));
  expect(await owner.query(api.locations.current, { id })).toBeNull();
  await expect(owner.mutation(api.locations.publishDemo, { id, sessionId, point: point() })).rejects.toThrow();
  await owner.mutation(api.locations.stopDemo, { id, sessionId });
});
