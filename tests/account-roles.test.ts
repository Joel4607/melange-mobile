/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from '../convex/_generated/api';
import schema from '../convex/schema';

const modules = import.meta.glob('../convex/**/*.{ts,js}');
const details = { phone: '0241234567', area: 'Osu', transport: 'walking' as const, services: ['delivery' as const] };

test('older accounts choose their role once and retain saved data', async () => {
  const t = convexTest(schema, modules);
  const id = await t.run(ctx => ctx.db.insert('users', { name: 'Existing account', email: 'old@example.test' }));
  const account = t.withIdentity({ subject: `${id}|session` });
  expect(await account.query(api.accounts.me, {})).toMatchObject({ role: null });
  await account.mutation(api.accounts.chooseRole, { role: 'runner' });
  await account.mutation(api.accounts.chooseRole, { role: 'runner' });
  expect(await account.query(api.accounts.me, {})).toMatchObject({ role: 'runner', email: 'old@example.test' });
  await expect(account.mutation(api.accounts.chooseRole, { role: 'buyer' })).rejects.toThrow('already has a role');
});

test('buyer accounts cannot become runners through the profile endpoint', async () => {
  const t = convexTest(schema, modules);
  const id = await t.run(ctx => ctx.db.insert('users', { name: 'Buyer', role: 'buyer' }));
  const buyer = t.withIdentity({ subject: `${id}|session` });
  await expect(buyer.mutation(api.runners.register, details)).rejects.toThrow('runner account');
  expect(await t.run(ctx => ctx.db.query('runnerProfiles').collect())).toEqual([]);
  expect(await buyer.query(api.accounts.me, {})).toMatchObject({ role: 'buyer' });
});

test('existing runner profiles resolve to the runner dashboard without re-enrollment', async () => {
  const t = convexTest(schema, modules);
  const id = await t.run(ctx => ctx.db.insert('users', { name: 'Previous runner' }));
  await t.run(ctx => ctx.db.insert('runnerProfiles', { userId: id, ...details, updatedAt: 100 }));
  const runner = t.withIdentity({ subject: `${id}|session` });
  expect(await runner.query(api.accounts.me, {})).toMatchObject({ role: 'runner' });
  await expect(runner.mutation(api.accounts.chooseRole, { role: 'buyer' })).rejects.toThrow();
});

test('role lookup and selection require an existing authenticated account', async () => {
  const t = convexTest(schema, modules);
  expect(await t.query(api.accounts.me, {})).toBeNull();
  await expect(t.mutation(api.accounts.chooseRole, { role: 'runner' })).rejects.toThrow('Sign in');
});
