/// <reference types="vite/client" />
import { generateKeyPairSync } from 'node:crypto';
import { convexTest } from 'convex-test';
import { beforeAll, afterAll, expect, test, vi } from 'vitest';
import { api } from '../convex/_generated/api';
import schema from '../convex/schema';

const modules = import.meta.glob('../convex/**/*.{ts,js}');
beforeAll(() => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  vi.stubEnv('JWT_PRIVATE_KEY', privateKey.export({ format: 'pem', type: 'pkcs8' }).toString());
  vi.stubEnv('CONVEX_SITE_URL', 'https://example.convex.site');
});
afterAll(() => vi.unstubAllEnvs());

test('registers a customer, signs in again, and rejects a wrong password', async () => {
  const t = convexTest(schema, modules);
  const email = 'mobile-test@example.test';
  const password = 'Test-only-pass-937!';
  const registration = await t.action(api.auth.signIn, { provider: 'password', params: { flow: 'signUp', email, password, name: 'Mobile Tester' } });
  expect(registration.tokens?.token).toBeTruthy();
  const login = await t.action(api.auth.signIn, { provider: 'password', params: { flow: 'signIn', email, password } });
  expect(login.tokens?.token).toBeTruthy();
  await expect(t.action(api.auth.signIn, { provider: 'password', params: { flow: 'signIn', email, password: 'Incorrect-password' } })).rejects.toThrow();
  const user = await t.run(async (ctx) => ctx.db.query('users').unique());
  expect(user).toMatchObject({ name: 'Mobile Tester', email, role: 'buyer' });
  const account = await t.run(async (ctx) => ctx.db.query('authAccounts').unique());
  expect(account?.secret).toBeTruthy();
  expect(account?.secret).not.toBe(password);
  const session = t.withIdentity({ subject: `${user!._id}|test-session` });
  expect(await session.query(api.customers.me)).toEqual({ name: 'Mobile Tester', email });
});

test('rejects weak passwords and invalid profiles without creating a user', async () => {
  const t = convexTest(schema, modules);
  for (const params of [
    { email: 'bad-email', name: 'Customer', password: 'Strong-enough-1' },
    { email: 'valid@example.test', name: 'A', password: 'Strong-enough-1' },
    { email: 'valid@example.test', name: 'Customer', password: 'short' },
  ]) await expect(t.action(api.auth.signIn, { provider: 'password', params: { ...params, flow: 'signUp' } })).rejects.toThrow();
  expect(await t.run(async (ctx) => ctx.db.query('users').collect())).toEqual([]);
});

test('new runner signs up, completes their profile and returns to the dashboard after signing in again', async () => {
  const t = convexTest(schema, modules);
  const email = 'new-runner@example.test';
  const password = 'Test-only-pass-937!';
  await t.action(api.auth.signIn, { provider: 'password', params: { flow: 'signUp', name: 'New Runner', email, password, role: 'runner' } });
  const user = await t.run(ctx => ctx.db.query('users').unique());
  const runner = t.withIdentity({ subject: `${user!._id}|test-session` });
  expect(user?.role).toBe('runner');
  await runner.mutation(api.runners.register, { phone: '+233241234567', area: 'Osu', transport: 'walking', services: ['delivery'] });
  expect(await runner.query(api.runners.dashboard, {})).not.toBeNull();
  const login = await t.action(api.auth.signIn, { provider: 'password', params: { flow: 'signIn', email, password } });
  expect(login.tokens?.token).toBeTruthy();
  expect(await runner.query(api.runners.access, {})).toMatchObject({ state: 'approved', hasProfile: true });
  expect(await t.run(ctx => ctx.db.query('users').collect())).toHaveLength(1);
});

test('sign-in role parameters cannot change the account role', async () => {
  const t = convexTest(schema, modules);
  const email = 'role-test@example.test';
  const password = 'Test-only-pass-937!';
  await t.action(api.auth.signIn, { provider: 'password', params: { flow: 'signUp', name: 'Runner', email, password, role: 'runner' } });
  await t.action(api.auth.signIn, { provider: 'password', params: { flow: 'signIn', email, password, role: 'buyer' } });
  expect((await t.run(ctx => ctx.db.query('users').unique()))?.role).toBe('runner');
});

test('signup rejects unsupported roles', async () => {
  const t = convexTest(schema, modules);
  await expect(t.action(api.auth.signIn, { provider: 'password', params: { flow: 'signUp', name: 'Invalid Role', email: 'invalid-role@example.test', password: 'Test-only-pass-937!', role: 'admin' } })).rejects.toThrow('Choose Buyer or Runner');
  expect(await t.run(ctx => ctx.db.query('users').collect())).toEqual([]);
});
