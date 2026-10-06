/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { describe, expect, test } from 'vitest';
import { api } from '../convex/_generated/api';
import schema from '../convex/schema';

const modules = import.meta.glob('../convex/**/*.{ts,js}');
const page = { paginationOpts: { numItems: 10, cursor: null } };
const request = { title: ' Buy groceries ', description: ' Tomatoes and bread ', category: 'groceries' as const, pickup: ' Osu market ', dropoff: ' Oxford Street, Accra ', budgetPesewas: 5050, urgency: 'normal' as const, requestId: 'test-request-0001' };

async function setup() {
  const t = convexTest(schema, modules);
  const [aliceId, bobId] = await t.run(async (ctx) => [await ctx.db.insert('users', { name: 'Alice', email: 'alice@example.test' }), await ctx.db.insert('users', { name: 'Bob', email: 'bob@example.test' })]);
  return { t, aliceId, alice: t.withIdentity({ subject: `${aliceId}|session-a` }), bob: t.withIdentity({ subject: `${bobId}|session-b` }) };
}

describe('customer errands', () => {
  test('only the owner can edit, cancel or read activity', async () => {
    const { t, alice, bob } = await setup();
    const id = await alice.mutation(api.errands.create, request);
    const { requestId, ...fields } = request;
    for (const client of [t, bob]) {
      await expect(client.mutation(api.errands.update, { ...fields, id, expectedRevision: 0 })).rejects.toThrow();
      await expect(client.mutation(api.errands.cancel, { id, expectedRevision: 0, reason: '' })).rejects.toThrow();
      await expect(client.query(api.errands.history, { id, ...page })).rejects.toThrow();
    }
    expect((await alice.query(api.errands.get, { id }))?.status).toBe('posted');
  });
  test('edits save the revised fields and one activity event, and reject an outdated editor', async () => {
    const { alice } = await setup();
    const id = await alice.mutation(api.errands.create, request);
    const { requestId, ...fields } = request;
    await alice.mutation(api.errands.update, { ...fields, id, expectedRevision: 0, title: ' Collect lunch ', budgetPesewas: 7000 });
    expect(await alice.query(api.errands.get, { id })).toMatchObject({ title: 'Collect lunch', budgetPesewas: 7000, revision: 1 });
    const history = await alice.query(api.errands.history, { id, ...page });
    expect(history.page).toHaveLength(1);
    expect(history.page[0]).toMatchObject({ kind: 'edited', summary: 'Updated: Title, Budget.' });
    await expect(alice.mutation(api.errands.update, { ...fields, id, expectedRevision: 0 })).rejects.toThrow('changed since');
    await expect(alice.mutation(api.errands.cancel, { id, expectedRevision: 0, reason: '' })).rejects.toThrow('changed since');
  });
  test('cancellation is retained in the list, cannot be edited, and is safe to retry', async () => {
    const { alice } = await setup();
    const id = await alice.mutation(api.errands.create, request);
    await alice.mutation(api.errands.cancel, { id, expectedRevision: 0, reason: ' No longer needed ' });
    await alice.mutation(api.errands.cancel, { id, expectedRevision: 0, reason: 'retry' });
    expect((await alice.query(api.errands.mine, page)).page[0]).toMatchObject({ _id: id, status: 'cancelled', cancellationReason: 'No longer needed', revision: 1 });
    expect((await alice.query(api.errands.history, { id, ...page })).page).toHaveLength(1);
    const { requestId, ...fields } = request;
    await expect(alice.mutation(api.errands.update, { ...fields, id, expectedRevision: 1 })).rejects.toThrow('unassigned');
  });
  test('assigned requests cannot be edited or cancelled', async () => {
    const { t, alice, aliceId } = await setup();
    const id = await alice.mutation(api.errands.create, request);
    await t.run(async (ctx) => ctx.db.patch('errands', id, { runnerId: aliceId }));
    const { requestId, ...fields } = request;
    await expect(alice.mutation(api.errands.update, { ...fields, id, expectedRevision: 0 })).rejects.toThrow('unassigned');
    await expect(alice.mutation(api.errands.cancel, { id, expectedRevision: 0, reason: '' })).rejects.toThrow('unassigned');
  });
  test('supports older records without a revision and does not log unchanged saves', async () => {
    const { t, alice, aliceId } = await setup();
    const fields = { ...request, title: request.title.trim(), description: request.description.trim(), pickup: request.pickup.trim(), dropoff: request.dropoff.trim() };
    const id = await t.run(async (ctx) => ctx.db.insert('errands', { ...fields, customerId: aliceId, status: 'posted' }));
    const { requestId, ...editableFields } = fields;
    await alice.mutation(api.errands.update, { ...editableFields, id, expectedRevision: 0 });
    expect((await alice.query(api.errands.history, { id, ...page })).page).toHaveLength(0);
    await alice.mutation(api.errands.update, { ...editableFields, id, expectedRevision: 0, pickup: 'New pickup address' });
    expect((await alice.query(api.errands.get, { id }))?.revision).toBe(1);
  });
  test('invalid edits and cancellation reasons do not change the record or history', async () => {
    const { alice } = await setup();
    const id = await alice.mutation(api.errands.create, request);
    const { requestId, ...fields } = request;
    await expect(alice.mutation(api.errands.update, { ...fields, id, expectedRevision: 0, budgetPesewas: -1 })).rejects.toThrow();
    await expect(alice.mutation(api.errands.update, { ...fields, id, expectedRevision: 0, pickup: ' ' })).rejects.toThrow();
    await expect(alice.mutation(api.errands.cancel, { id, expectedRevision: 0, reason: 'x'.repeat(501) })).rejects.toThrow();
    expect((await alice.query(api.errands.get, { id }))?.revision).toBe(0);
    expect((await alice.query(api.errands.history, { id, ...page })).page).toHaveLength(0);
    expect(await alice.query(api.errands.get, { id: 'broken-link' })).toBeNull();
  });
  test('rejects unauthenticated writes and reads', async () => {
    const { t, alice } = await setup();
    const id = await alice.mutation(api.errands.create, request);
    await expect(t.mutation(api.errands.create, request)).rejects.toThrow('Sign in');
    await expect(t.query(api.errands.mine, page)).rejects.toThrow('Sign in');
    await expect(t.query(api.errands.get, { id })).rejects.toThrow('Sign in');
  });
  test('saves fields and scopes list/detail to the owner', async () => {
    const { alice, bob, aliceId } = await setup();
    const id = await alice.mutation(api.errands.create, request);
    expect(await alice.query(api.errands.get, { id })).toMatchObject({ title: 'Buy groceries', pickup: 'Osu market', budgetPesewas: 5050, customerId: aliceId, status: 'posted' });
    expect((await alice.query(api.errands.mine, page)).page.map((e) => e._id)).toEqual([id]);
    expect((await bob.query(api.errands.mine, page)).page).toEqual([]);
    expect(await bob.query(api.errands.get, { id })).toBeNull();
  });
  test('deduplicates retries but allows a separate customer to post', async () => {
    const { alice, bob } = await setup();
    const id = await alice.mutation(api.errands.create, request);
    expect(await alice.mutation(api.errands.create, request)).toBe(id);
    expect((await alice.query(api.errands.mine, page)).page).toHaveLength(1);
    expect(await bob.mutation(api.errands.create, request)).not.toBe(id);
  });
  test.each([0, -1, 99, 1000001, 100.5, NaN, Infinity])('rejects invalid monetary value %s', async (budgetPesewas) => {
    const { alice } = await setup();
    await expect(alice.mutation(api.errands.create, { ...request, budgetPesewas })).rejects.toThrow();
    expect((await alice.query(api.errands.mine, page)).page).toHaveLength(0);
  });
  test('rejects blank addresses and oversized fields', async () => {
    const { alice } = await setup();
    for (const invalid of [{ pickup: '  ' }, { dropoff: '  ' }, { title: '  ' }, { description: 'x'.repeat(2001) }, { title: 'x'.repeat(101) }]) {
      await expect(alice.mutation(api.errands.create, { ...request, ...invalid })).rejects.toThrow();
    }
  });
  test('paginates without exposing another customer’s entries', async () => {
    const { alice, bob } = await setup();
    for (let i = 0; i < 3; i++) await alice.mutation(api.errands.create, { ...request, requestId: `request-alice-${i}` });
    await bob.mutation(api.errands.create, request);
    const first = await alice.query(api.errands.mine, { paginationOpts: { numItems: 2, cursor: null } });
    const second = await alice.query(api.errands.mine, { paginationOpts: { numItems: 2, cursor: first.continueCursor } });
    expect(first.page).toHaveLength(2);
    expect(second.page).toHaveLength(1);
    expect(new Set([...first.page, ...second.page].map((e) => e._id)).size).toBe(3);
  });
});
