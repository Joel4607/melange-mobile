import { Redirect } from 'expo-router';
import AppTabs from '@/components/app-tabs';
import { AccountLoading, ChooseAccountRole, useAccountRole } from '@/components/account-role';

export default function BuyerLayout() {
  const { loading, isAuthenticated, account } = useAccountRole();
  if (loading) return <AccountLoading />;
  if (isAuthenticated && account?.role === 'runner') return <Redirect href="/runner" />;
  if (isAuthenticated && account && !account.role) return <ChooseAccountRole />;
  return <AppTabs />;
}
