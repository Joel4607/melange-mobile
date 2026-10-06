import { beforeEach, expect, test, vi } from 'vitest';
const state = vi.hoisted(() => ({ os: 'android', environment: 'standalone', projectId: 'test-project-id', store: new Map<string, string>(), permission: vi.fn(), request: vi.fn(), token: vi.fn(), channel: vi.fn() }));
vi.mock('react-native', () => ({ Platform: { get OS() { return state.os; } } }));
vi.mock('expo-constants', () => ({ default: { get executionEnvironment() { return state.environment; }, get expoConfig() { return { extra: { eas: { projectId: state.projectId } } }; } }, ExecutionEnvironment: { StoreClient: 'storeClient' } }));
vi.mock('expo-secure-store', () => ({ getItemAsync: async (key: string) => state.store.get(key) ?? null, setItemAsync: async (key: string, value: string) => { state.store.set(key, value); }, deleteItemAsync: async (key: string) => { state.store.delete(key); } }));
vi.mock('expo-notifications', () => ({ getPermissionsAsync: state.permission, requestPermissionsAsync: state.request, getExpoPushTokenAsync: state.token, setNotificationChannelAsync: state.channel, AndroidImportance: { HIGH: 4 }, IosAuthorizationStatus: { PROVISIONAL: 3 } }));
beforeEach(() => {
  vi.resetModules(); state.os = 'android'; state.environment = 'standalone'; state.projectId = 'test-project-id'; state.store.clear();
  state.permission.mockReset().mockResolvedValue({ granted: true, canAskAgain: true });
  state.request.mockReset().mockResolvedValue({ granted: false, canAskAgain: false });
  state.token.mockReset().mockResolvedValue({ data: 'ExpoPushToken[example-device-token]' }); state.channel.mockReset().mockResolvedValue(null);
});
test('Expo Go and web never attempt push registration', async () => {
  for (const surface of ['storeClient', 'web']) {
    vi.resetModules(); if (surface === 'web') state.os = 'web'; else state.environment = 'storeClient';
    const device = await import('../src/lib/push-device');
    expect(device.pushSupported).toBe(false); expect(await device.installationId()).toBeNull();
    await expect(device.getPushToken(true)).rejects.toThrow('development build');
  }
  expect(state.token).not.toHaveBeenCalled(); expect(state.request).not.toHaveBeenCalled();
});
test('automatic registration refresh does not prompt for permissions', async () => {
  state.permission.mockResolvedValue({ granted: false, canAskAgain: true });
  const device = await import('../src/lib/push-device');
  expect(await device.getPushToken(false)).toBeNull(); expect(state.request).not.toHaveBeenCalled();
  expect(await device.getPushToken(true)).toBeNull(); expect(state.request).toHaveBeenCalledTimes(1); expect(state.token).not.toHaveBeenCalled();
});
test('Android creates the channel before registering and requires an EAS project', async () => {
  const device = await import('../src/lib/push-device');
  expect(await device.getPushToken(true)).toBe('ExpoPushToken[example-device-token]');
  expect(state.channel.mock.invocationCallOrder[0]).toBeLessThan(state.permission.mock.invocationCallOrder[0]);
  expect(state.token).toHaveBeenCalledWith({ projectId: 'test-project-id' });
  state.projectId = ''; await expect(device.getPushToken(true)).rejects.toThrow('Expo/EAS');
});
test('clearing the signed-in binding preserves a stable installation identifier', async () => {
  const device = await import('../src/lib/push-device');
  const id = await device.installationId(); expect(await device.installationId()).toBe(id);
  await device.saveBinding({ userId: 'buyer', messages: false, updates: true });
  expect(await device.binding()).toMatchObject({ userId: 'buyer', messages: false });
  await device.saveBinding(null); expect(await device.binding()).toBeNull(); expect(await device.installationId()).toBe(id);
});
