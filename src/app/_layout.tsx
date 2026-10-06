import { PushNotificationsProvider } from '@/components/push-notifications';
import { ConvexReactClient } from 'convex/react';
import { ConvexAuthProvider } from '@convex-dev/auth/react';
import { authStorage } from '@/lib/auth-storage';
import { stopRunnerBackground } from '@/lib/runner-background';
import { DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Text } from 'react-native';
import { CustomerPage, palette, ui } from '@/components/customer-ui';
import { AppRefreshProvider } from '@/components/app-refresh';

export { ErrorBoundary } from 'expo-router';
export const unstable_settings = { initialRouteName: '(customer)' };

const url = process.env.EXPO_PUBLIC_CONVEX_URL;
const convex = url ? new ConvexReactClient(url, { unsavedChangesWarning: false }) : null;
const theme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, primary: palette.green, background: palette.background, card: palette.background, text: palette.ink, border: palette.line } };

export default function RootLayout() {
  useEffect(() => { void SplashScreen.hideAsync().catch(() => undefined); }, []);
  useEffect(() => { void stopRunnerBackground().catch(() => undefined); }, []);
  if (!convex) return <CustomerPage><Text style={ui.h2}>Connect your development backend</Text><Text style={ui.body}>Set EXPO_PUBLIC_CONVEX_URL in .env.local, then restart Expo.</Text></CustomerPage>;
  return <ConvexAuthProvider client={convex} storage={authStorage} shouldHandleCode={false}><AppRefreshProvider><PushNotificationsProvider><ThemeProvider value={theme}><StatusBar style="dark" /><Stack screenOptions={{ headerShown: false }}><Stack.Screen name="(customer)" /><Stack.Screen name="runner" /></Stack></ThemeProvider></PushNotificationsProvider></AppRefreshProvider></ConvexAuthProvider>;
}
