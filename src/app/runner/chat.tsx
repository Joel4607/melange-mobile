import { useLocalSearchParams } from 'expo-router';
import { ErrandChat } from '@/components/errand-chat';

export default function RunnerChat() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ErrandChat errandId={typeof id === 'string' ? id : ''} />;
}
