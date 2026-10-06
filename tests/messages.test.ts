/// <reference types="vite/client" />
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { api } from '../convex/_generated/api';
import schema from '../convex/schema';
import { boundedBody, MAX_IMAGE_BYTES } from '../convex/lib/chatImage';

const modules = import.meta.glob('../convex/**/*.{ts,js}');
const paginationOpts = { numItems: 30, cursor: null };
beforeEach(() => vi.stubEnv('ENABLE_DEMO_TRACKING', 'true'));
afterEach(() => vi.unstubAllEnvs());
async function setup(demo = false) {
  const t = convexTest(schema, modules);
  const [ownerId, runnerId, otherId] = await t.run(async ctx => [await ctx.db.insert('users', { name: 'Owner' }), await ctx.db.insert('users', { name: 'Kojo' }), await ctx.db.insert('users', { name: 'Other' })]);
  const owner = t.withIdentity({ subject: `${ownerId}|session` });
  const runner = t.withIdentity({ subject: `${runnerId}|session` });
  const other = t.withIdentity({ subject: `${otherId}|session` });
  const errandId = await owner.mutation(api.errands.create, { title: 'Collect parcel', description: '', category: 'delivery', pickup: 'Osu', dropoff: 'Labone', budgetPesewas: 5000, urgency: 'normal', requestId: 'chat-errand-0001' });
  await t.run(ctx => ctx.db.patch('errands', errandId, demo ? { status: 'accepted', trackingMode: 'demo' } : { status: 'accepted', runnerId }));
  const channel = demo ? 'demo' : String(runnerId);
  const args = { errandId, channel, clientId: 'chat-message-0001', text: 'Please use the side entrance.' };
  return { t, owner, runner, other, ownerId, runnerId, otherId, args, list: { errandId, channel, paginationOpts } };
}
function imageForm(args: { errandId: string; channel: string; clientId: string; text: string }, blob?: Blob) {
  const form = new FormData();
  for (const [key, value] of Object.entries(args)) form.append(key, value);
  const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII='), char => char.charCodeAt(0));
  form.append('image', blob ?? new Blob([bytes], { type: 'image/png' }), 'photo.png');
  return form;
}

test('real participants exchange text with server-derived sender identities', async () => {
  const { owner, runner, ownerId, runnerId, args, list } = await setup();
  await owner.mutation(api.messages.sendText, args);
  await runner.mutation(api.messages.sendText, { ...args, clientId: 'runner-message-0002', text: 'I will be there shortly.' });
  const page = await owner.query(api.messages.list, list);
  expect(page.page.map(message => message.senderId)).toEqual([runnerId, ownerId]);
  expect(page.page.every(message => !message.demoReply && !message.image)).toBe(true);
  expect((await runner.query(api.messages.list, list)).page).toEqual(page.page);
});

test('outsiders and anonymous clients cannot read or write conversations', async () => {
  const { t, owner, other, args, list } = await setup();
  await owner.mutation(api.messages.sendText, args);
  for (const client of [t, other]) {
    await expect(client.query(api.messages.context, { errandId: args.errandId })).rejects.toThrow();
    await expect(client.query(api.messages.list, list)).rejects.toThrow();
    await expect(client.mutation(api.messages.sendText, args)).rejects.toThrow();
    const response = await client.fetch('/chat/image', { method: 'POST', body: imageForm({ ...args, clientId: 'image-message-0001' }) });
    expect(response.ok).toBe(false);
  }
  expect(await t.run(ctx => ctx.db.system.query('_storage').collect())).toHaveLength(0);
});

test('text retries are idempotent and cannot change an existing message', async () => {
  const { t, owner, runner, args, list } = await setup();
  const id = await owner.mutation(api.messages.sendText, args);
  expect(await owner.mutation(api.messages.sendText, args)).toBe(id);
  expect((await owner.query(api.messages.list, list)).page).toHaveLength(1);
  await expect(owner.mutation(api.messages.sendText, { ...args, text: 'Different content' })).rejects.toThrow('already been used');
  await expect(runner.mutation(api.messages.sendText, args)).rejects.toThrow('already been used');
  expect(await t.run(ctx => ctx.db.query('messages').collect())).toHaveLength(1);
});

test('rejects blank text, excessive length and invalid retry references', async () => {
  const { owner, args, list } = await setup();
  for (const change of [{ text: '   \n' }, { text: 'a'.repeat(2001) }, { clientId: '' }]) await expect(owner.mutation(api.messages.sendText, { ...args, ...change })).rejects.toThrow();
  expect((await owner.query(api.messages.list, list)).page).toHaveLength(0);
});

test.each(['delivered', 'cancelled'] as const)('completed or cancelled errands retain read-only history (%s)', async status => {
  const { t, owner, args, list } = await setup();
  const id = await owner.mutation(api.messages.sendText, args);
  await t.run(ctx => ctx.db.patch('errands', args.errandId, { status }));
  if (status === 'delivered') await owner.mutation(api.errands.confirmCompletion, { id: args.errandId, expectedRevision: 0 });
  expect((await owner.query(api.messages.context, { errandId: args.errandId })).canSend).toBe(false);
  expect((await owner.query(api.messages.list, list)).page).toHaveLength(1);
  expect(await owner.mutation(api.messages.sendText, args)).toBe(id);
  await expect(owner.mutation(api.messages.sendText, { ...args, clientId: 'new-message-0002' })).rejects.toThrow('read-only');
  expect((await owner.fetch('/chat/image', { method: 'POST', body: imageForm({ ...args, clientId: 'image-message-0002' }) })).ok).toBe(false);
});

test('unassigned errands cannot send and changed assignments cannot share history', async () => {
  const { t, owner, runner, other, otherId, args, list } = await setup();
  await owner.mutation(api.messages.sendText, args);
  await t.run(ctx => ctx.db.patch('errands', args.errandId, { runnerId: otherId }));
  await expect(runner.query(api.messages.list, list)).rejects.toThrow('not found');
  expect((await other.query(api.messages.list, { ...list, channel: String(otherId) })).page).toHaveLength(0);
  expect((await owner.query(api.messages.list, list)).page).toHaveLength(0);
  await expect(owner.mutation(api.messages.sendText, { ...args, clientId: 'late-message-0002' })).rejects.toThrow('runner changed');
  await t.run(ctx => ctx.db.patch('errands', args.errandId, { runnerId: undefined, status: 'posted' }));
  expect(await owner.query(api.messages.context, { errandId: args.errandId })).toMatchObject({ channel: null, canSend: false });
});

test('demo replies are explicitly labelled, private and disabled by the demo flag', async () => {
  const { owner, runner, args, list } = await setup(true);
  await owner.mutation(api.messages.sendText, args);
  await owner.mutation(api.messages.sendText, args);
  const page = (await owner.query(api.messages.list, list)).page;
  expect(page).toHaveLength(2);
  expect(page[0]).toMatchObject({ demoReply: true });
  expect(page[0].senderId).toBeUndefined();
  expect(page[0].text).toContain('simulated');
  await expect(runner.query(api.messages.list, list)).rejects.toThrow();
  vi.stubEnv('ENABLE_DEMO_TRACKING', 'false');
  await expect(owner.mutation(api.messages.sendText, { ...args, clientId: 'demo-message-0002' })).rejects.toThrow('read-only');
});

test('images and captions are stored through the authenticated uploader; retries do not duplicate files', async () => {
  const { t, owner, runner, args, list } = await setup();
  const response = await owner.fetch('/chat/image', { method: 'POST', body: imageForm(args) });
  expect(await response.clone().text()).not.toContain('error');
  expect(response.status).toBe(200);
  const initial = await response.json();
  const retry = await owner.fetch('/chat/image', { method: 'POST', body: imageForm(args) });
  expect(await retry.json()).toEqual(initial);
  const page = (await runner.query(api.messages.list, list)).page;
  expect(page).toHaveLength(1);
  expect(page[0]).toMatchObject({ text: args.text, image: { mimeType: 'image/png' } });
  expect(page[0].imageUrl).toBeTruthy();
  expect(await t.run(ctx => ctx.db.system.query('_storage').collect())).toHaveLength(1);
});

test('uses image bytes rather than an inaccurate phone MIME label, including stored content type', async () => {
  const { t, owner, args, list } = await setup();
  const jpeg = Uint8Array.from(atob('/9j/4AAQSkZJRgABAQAAAQABAAD/2Q=='), c => c.charCodeAt(0));
  for (const [i, type] of ['image/jpg', 'application/octet-stream', 'image/heic'].entries()) {
    const response = await owner.fetch('/chat/image', { method: 'POST', body: imageForm({ ...args, clientId: `phone-image-${i}` }, new Blob([jpeg], { type })) });
    expect(response.status).toBe(200);
  }
  const page = (await owner.query(api.messages.list, list)).page;
  expect(page).toHaveLength(3);
  for (const message of page) expect(message.image?.mimeType).toBe('image/jpeg');
  const files = await t.run(ctx => ctx.db.system.query('_storage').collect());
  for (const file of files) {
    await t.run(async ctx => {
      const stored = await ctx.storage.get(file._id);
      expect(stored?.type).toBe('image/jpeg');
      expect(new Uint8Array(await stored!.arrayBuffer())).toEqual(jpeg);
    });
  }
});

test('supports image-only messages and labelled image demo acknowledgements', async () => {
  const { owner, args, list } = await setup(true);
  const response = await owner.fetch('/chat/image', { method: 'POST', body: imageForm({ ...args, text: '' }) });
  expect(response.status).toBe(200);
  const page = (await owner.query(api.messages.list, list)).page;
  expect(page).toHaveLength(2);
  expect(page[0].text).toContain('Your image was received');
  expect(page[1].text).toBe('');
});

test('rejects disguised, unsupported, oversized and malformed uploads without storing them', async () => {
  const { t, owner, args } = await setup();
  for (const blob of [new Blob(['<html>not an image</html>'], { type: 'image/jpeg' }), new Blob(['GIF89a012345678901234'], { type: 'image/gif' }), new Blob([new Uint8Array(MAX_IMAGE_BYTES + 1)], { type: 'image/png' })]) {
    const response = await owner.fetch('/chat/image', { method: 'POST', body: imageForm(args, blob) });
    expect(response.status).toBe(400);
  }
  expect((await owner.fetch('/chat/image', { method: 'POST', body: 'invalid' })).status).toBe(400);
  expect(await t.run(ctx => ctx.db.system.query('_storage').collect())).toHaveLength(0);
  expect(await t.run(ctx => ctx.db.query('messages').collect())).toHaveLength(0);
});

test('bounded body rejects chunked oversized data without trusting Content-Length', async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(12)); controller.enqueue(new Uint8Array(12)); controller.close(); } });
  const request = new Request('https://example.test', { method: 'POST', body: stream, duplex: 'half' } as RequestInit);
  await expect(boundedBody(request, 20)).rejects.toThrow('5 MB');
});

test('paginates messages newest first without leaking another conversation', async () => {
  const { owner, args } = await setup();
  for (let i = 0; i < 5; i++) await owner.mutation(api.messages.sendText, { ...args, clientId: `pagination-message-${i}`, text: `Message ${i}` });
  const first = await owner.query(api.messages.list, { errandId: args.errandId, channel: args.channel, paginationOpts: { numItems: 2, cursor: null } });
  expect(first.page.map(message => message.text)).toEqual(['Message 4', 'Message 3']);
  const second = await owner.query(api.messages.list, { errandId: args.errandId, channel: args.channel, paginationOpts: { numItems: 3, cursor: first.continueCursor } });
  expect(second.page.map(message => message.text)).toEqual(['Message 2', 'Message 1', 'Message 0']);
  expect(second.isDone).toBe(true);
});
