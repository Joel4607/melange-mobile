import { useLocalSearchParams, useRouter, type ErrorBoundaryProps } from 'expo-router';
import { Text } from 'react-native';
import { RequireCustomer } from '@/components/customer-auth';
import { ErrandChat } from '@/components/errand-chat';
import { CustomerButton, CustomerPage, ui } from '@/components/customer-ui';

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <RequireCustomer><ErrandChat errandId={typeof id === 'string' ? id : ''} /></RequireCustomer>;
}
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  const router = useRouter();
  return <CustomerPage><Text style={ui.title}>Chat unavailable</Text><Text style={ui.body}>This conversation may no longer be available to your account. Check your connection and try again.</Text><CustomerButton onPress={() => void retry()}>Try again</CustomerButton><CustomerButton onPress={() => router.replace('/errands')}>My errands</CustomerButton></CustomerPage>;
}
