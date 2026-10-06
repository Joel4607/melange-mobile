/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api, internal } from '../convex/_generated/api';
import schema from '../convex/schema';

const modules = import.meta.glob('../convex/**/*.{ts,js}');
const details = { phone: '0241234567', area: 'Osu', transport: 'walking' as const, services: ['delivery' as const] };
async function setup() {
  const t = convexTest(schema, modules);
  const [runnerId, buyerId, otherId] = await t.run(async ctx => [
    await ctx.db.insert('users', { name: 'Ama', role: 'runner' }),
    await ctx.db.insert('users', { name: 'Buyer', role: 'buyer' }),
    await ctx.db.insert('users', { name: 'Other', role: 'runner' }),
  ]);
  const runner = t.withIdentity({ subject: `${runnerId}|session` });
  const buyer = t.withIdentity({ subject: `${buyerId}|session` });
  const other = t.withIdentity({ subject: `${otherId}|session` });
  for (const user of [runner, other]) await user.mutation(api.runners.register, details);
  return { t, runner, buyer, other, runnerId };
}
function photo(requestId = 'profile-photo-test-001', expectedPhotoId = '', invalid = false) {
  const form = new FormData(); form.append('requestId', requestId); form.append('expectedPhotoId', expectedPhotoId);
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII='), c => c.charCodeAt(0));
  form.append('image', new Blob([invalid ? 'This is text, not an image.' : png], { type: 'image/png' }), 'profile.png');
  return form;
}

test('runner introduction validates, persists and survives an older client update', async () => {
  const { runner, buyer } = await setup();
  await runner.mutation(api.runners.register, { ...details, bio: '  I help with careful deliveries.  ' });
  await runner.mutation(api.runners.register, { ...details, area: 'Labone' });
  expect(await runner.query(api.runners.profile, {})).toMatchObject({ bio: 'I help with careful deliveries.', area: 'Labone', photoId: null, photoUrl: null });
  await expect(runner.mutation(api.runners.register, { ...details, bio: 'x'.repeat(301) })).rejects.toThrow('300');
  await expect(buyer.mutation(api.runners.register, { ...details, bio: 'Buyer' })).rejects.toThrow();
  await runner.mutation(api.runners.register, { ...details, bio: '' });
  expect((await runner.query(api.runners.profile, {}))?.bio).toBe('');
});

test('profile upload requires enrollment and actual image bytes', async () => {
  const { t, runner, buyer, runnerId } = await setup();
  expect((await t.fetch('/runner/photo', { method: 'POST', body: photo() })).status).toBe(401);
  expect((await buyer.fetch('/runner/photo', { method: 'POST', body: photo() })).status).toBe(400);
  expect((await runner.fetch('/runner/photo', { method: 'POST', body: photo('invalid-photo-001', '', true) })).status).toBe(400);
  await t.mutation(internal.runners.setRunnerAccess, { userId: runnerId, enabled: false });
  expect((await runner.fetch('/runner/photo', { method: 'POST', body: photo() })).status).toBe(400);
  expect(await t.run(ctx => ctx.db.system.query('_storage').collect())).toHaveLength(0);
});

test('upload retries deduplicate, replacement cleans up, stale removal cannot delete a new photo', async () => {
  const { t, runner, other } = await setup();
  const first = await runner.fetch('/runner/photo', { method: 'POST', body: photo() });
  expect(first.status).toBe(200);
  expect(await first.json()).toEqual(await (await runner.fetch('/runner/photo', { method: 'POST', body: photo() })).json());
  expect(await t.run(ctx => ctx.db.system.query('_storage').collect())).toHaveLength(1);
  const initial = (await runner.query(api.runners.profile, {}))!;
  expect(initial.photoUrl).toBeTruthy();
  expect((await other.query(api.runners.profile, {}))?.photoId).toBeNull();
  await other.mutation(api.runnerPhotos.remove, { expectedPhotoId: initial.photoId! });
  expect((await runner.query(api.runners.profile, {}))?.photoId).toBe(initial.photoId);
  expect((await runner.fetch('/runner/photo', { method: 'POST', body: photo('profile-photo-test-002', initial.photoId!) })).status).toBe(200);
  const replaced = (await runner.query(api.runners.profile, {}))!;
  expect(replaced.photoId).not.toBe(initial.photoId);
  expect(await t.run(ctx => ctx.db.system.get('_storage', initial.photoId!))).toBeNull();
  await expect(runner.mutation(api.runnerPhotos.remove, { expectedPhotoId: initial.photoId! })).rejects.toThrow('changed');
  expect((await runner.fetch('/runner/photo', { method: 'POST', body: photo('profile-photo-stale-003', initial.photoId!) })).status).toBe(400);
  expect(await t.run(ctx => ctx.db.system.query('_storage').collect())).toHaveLength(1);
  await runner.mutation(api.runnerPhotos.remove, { expectedPhotoId: replaced.photoId! });
  await runner.mutation(api.runnerPhotos.remove, { expectedPhotoId: replaced.photoId! });
  expect((await runner.query(api.runners.profile, {}))?.photoUrl).toBeNull();
  expect(await t.run(ctx => ctx.db.system.query('_storage').collect())).toHaveLength(0);
});

test('buyers see the runner photo and introduction only through their own errand quotes', async () => {
  const { runner, buyer, other } = await setup();
  await runner.mutation(api.runners.register, { ...details, bio: 'Your neighbourhood runner.' });
  await runner.fetch('/runner/photo', { method: 'POST', body: photo() });
  await runner.mutation(api.pricing.saveRates, { rates: [{ category: 'delivery', startingFeePesewas: 2000 }] });
  const id = await buyer.mutation(api.errands.create, { title: 'Collect parcel', description: '', category: 'delivery', pickup: 'Osu shop', dropoff: 'Labone office', budgetPesewas: 0, budgetPurpose: 'items', urgency: 'normal', requestId: 'profile-quote-0001' });
  await runner.mutation(api.pricing.submitQuote, { id, expectedRevision: 0, expectedVersion: 0, serviceFeePesewas: 2000, note: '' });
  const args = { id, paginationOpts: { numItems: 10, cursor: null } };
  const quote = (await buyer.query(api.pricing.forBuyer, args)).page[0];
  expect(quote).toMatchObject({ runnerName: 'Ama', runnerBio: 'Your neighbourhood runner.', canApprove: true });
  expect(quote.runnerPhotoUrl).toBeTruthy();
  expect(quote).not.toHaveProperty('phone');
  await expect(other.query(api.pricing.forBuyer, args)).rejects.toThrow();
});
