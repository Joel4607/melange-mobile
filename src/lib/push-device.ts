import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export const pushSupported = (Platform.OS === 'android' || Platform.OS === 'ios') && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient;
const INSTALLATION = 'melange.push.installation';
const BINDING = 'melange.push.binding';
export type PushBinding = { userId: string; messages: boolean; updates: boolean };
export const nativeNotifications = () => import('expo-notifications');
export async function installationId() {
  if (!pushSupported) return null;
  let id = await SecureStore.getItemAsync(INSTALLATION);
  if (!id) { id = `push-${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`; await SecureStore.setItemAsync(INSTALLATION, id); }
  return id;
}
export async function binding(): Promise<PushBinding | null> {
  if (!pushSupported) return null;
  const raw = await SecureStore.getItemAsync(BINDING);
  if (!raw) return null;
  try { const value = JSON.parse(raw); return typeof value.userId === 'string' && typeof value.messages === 'boolean' && typeof value.updates === 'boolean' ? value : null; } catch { return null; }
}
export async function saveBinding(value: PushBinding | null) {
  if (!pushSupported) return;
  if (value) await SecureStore.setItemAsync(BINDING, JSON.stringify(value)); else await SecureStore.deleteItemAsync(BINDING);
}
export async function getPushToken(prompt: boolean) {
  if (!pushSupported) throw new Error('Push alerts require a development build of Melange.');
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (typeof projectId !== 'string' || !projectId) throw new Error('Connect this app to an Expo/EAS project and rebuild to enable push alerts.');
  const notifications = await nativeNotifications();
  if (Platform.OS === 'android') await notifications.setNotificationChannelAsync('errand-updates', { name: 'Errand updates', importance: notifications.AndroidImportance.HIGH });
  let permission = await notifications.getPermissionsAsync();
  if (!permission.granted && prompt && permission.canAskAgain) permission = await notifications.requestPermissionsAsync();
  if (!permission.granted && permission.ios?.status !== notifications.IosAuthorizationStatus.PROVISIONAL) return null;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const token = await Promise.race([
      notifications.getExpoPushTokenAsync({ projectId }),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Push registration timed out. Check your connection and try again.')), 20_000); }),
    ]);
    return token.data;
  } finally { clearTimeout(timeout); }
}
