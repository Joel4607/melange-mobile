/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { expect, test } from 'vitest';
import { api } from '../convex/_generated/api';
import schema from '../convex/schema';

const modules = import.meta.glob('../convex/**/*.{ts,js}');
async function setup() {
  const t = convexTest(schema, modules);
  const [aliceId, bobId] = await t.run(async (ctx) => [await ctx.db.insert('users', { name: 'Alice', email: 'alice@example.test' }), await ctx.db.insert('users', { name: 'Bob', email: 'bob@example.test' })]);
  return { t, alice: t.withIdentity({ subject: `${aliceId}|alice-session` }), bob: t.withIdentity({ subject: `${bobId}|bob-session` }) };
}

test('settings require sign-in and guests do not receive preferences', async () => {
  const { t } = await setup();
  expect(await t.query(api.customers.preferences)).toBeNull();
  await expect(t.mutation(api.customers.updateName, { name: 'Changed' })).rejects.toThrow('Sign in');
  await expect(t.mutation(api.customers.updateDeliveryAddress, { deliveryAddress: 'Osu market' })).rejects.toThrow('Sign in');
});

test('profile edits update only the caller and preserve sign-in email', async () => {
  const { alice, bob } = await setup();
  await alice.mutation(api.customers.updateName, { name: ' Alice Updated ' });
  expect(await alice.query(api.customers.me)).toEqual({ name: 'Alice Updated', email: 'alice@example.test' });
  expect(await bob.query(api.customers.me)).toEqual({ name: 'Bob', email: 'bob@example.test' });
});

test('addresses are private, can be replaced and cleared, and use a single preferences record', async () => {
  const { t, alice, bob } = await setup();
  expect(await alice.query(api.customers.preferences)).toEqual({ deliveryAddress: '' });
  await alice.mutation(api.customers.updateDeliveryAddress, { deliveryAddress: '  12 Oxford Street, Osu  ' });
  expect(await alice.query(api.customers.preferences)).toEqual({ deliveryAddress: '12 Oxford Street, Osu' });
  expect(await bob.query(api.customers.preferences)).toEqual({ deliveryAddress: '' });
  await alice.mutation(api.customers.updateDeliveryAddress, { deliveryAddress: '25 High Street, Accra' });
  expect(await alice.query(api.customers.preferences)).toEqual({ deliveryAddress: '25 High Street, Accra' });
  await alice.mutation(api.customers.updateDeliveryAddress, { deliveryAddress: '' });
  expect(await alice.query(api.customers.preferences)).toEqual({ deliveryAddress: '' });
  expect(await t.run(async (ctx) => ctx.db.query('customerPreferences').collect())).toHaveLength(1);
});

test('invalid settings leave existing values unchanged', async () => {
  const { alice } = await setup();
  for (const name of [' ', 'A', 'A'.repeat(81)]) await expect(alice.mutation(api.customers.updateName, { name })).rejects.toThrow();
  for (const deliveryAddress of ['A', 'A'.repeat(301)]) await expect(alice.mutation(api.customers.updateDeliveryAddress, { deliveryAddress })).rejects.toThrow();
  expect(await alice.query(api.customers.me)).toMatchObject({ name: 'Alice' });
  expect(await alice.query(api.customers.preferences)).toEqual({ deliveryAddress: '' });
});
