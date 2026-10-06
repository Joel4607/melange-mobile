import { Redirect, Stack, type ErrorBoundaryProps } from 'expo-router';
import { useQuery } from 'convex/react';
import { Text } from 'react-native';
import { api } from '../../../convex/_generated/api';
import { CustomerAuth } from '@/components/customer-auth';
import { CustomerButton, CustomerPage, ui } from '@/components/customer-ui';
import { RunnerOnboarding } from '@/components/runner-onboarding';
import { RunnerLocationProvider } from '@/components/runner-location-sharing';
import { AccountLoading, AccountSignOut, ChooseAccountRole, useAccountRole } from '@/components/account-role';

export const unstable_settings = { initialRouteName: '(tabs)' };

export default function RunnerLayout() {
  const { account, isAuthenticated, loading } = useAccountRole();
  const access = useQuery(api.runners.access, isAuthenticated && account?.role === 'runner' ? {} : 'skip');
  if (loading) return <AccountLoading />;
  if (!isAuthenticated) return <CustomerAuth runner />;
  if (!account) return <CustomerPage><Text style={ui.title}>Account unavailable</Text><AccountSignOut /></CustomerPage>;
  if (!account.role) return <ChooseAccountRole />;
  if (account.role === 'buyer') return <Redirect href="/" />;
  if (access === undefined) return <AccountLoading />;
  if (!access || access.state !== 'approved' || !access.hasProfile) return <RunnerOnboarding />;
  return <RunnerLocationProvider key={access.userId}>
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="errand" /><Stack.Screen name="share" /><Stack.Screen name="chat" />
      <Stack.Screen name="profile" /><Stack.Screen name="pricing" /><Stack.Screen name="earnings" />
    </Stack>
  </RunnerLocationProvider>;
}

export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return <CustomerPage><Text style={ui.title}>Workspace unavailable</Text><Text style={ui.body}>We couldn’t load your runner workspace. Check your connection and try again.</Text><CustomerButton onPress={() => void retry()}>Try again</CustomerButton><AccountSignOut /></CustomerPage>;
}
