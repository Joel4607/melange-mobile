import { Image } from 'expo-image';
import { useConvexConnectionState, usePaginatedQuery, useQuery } from 'convex/react';
import type { FunctionReturnType } from 'convex/server';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../../convex/_generated/api';
import { ChatComposer } from './chat-composer';
import { CustomerButton, CustomerPage, palette, ui } from './customer-ui';

type ChatContext = FunctionReturnType<typeof api.messages.context>;
type Message = FunctionReturnType<typeof api.messages.list>['page'][number];

export function ErrandChat({ errandId }: { errandId: string }) {
  const context = useQuery(api.messages.context, { errandId });
  const router = useRouter();
  const back = () => { if (router.canGoBack()) router.back(); else router.replace('/errands'); };
  if (context === undefined) return <CustomerPage><CustomerButton onPress={back}>← Back</CustomerButton><ActivityIndicator color={palette.green} /><Text style={ui.body}>Opening conversation…</Text></CustomerPage>;
  return <SafeAreaView edges={['top', 'left', 'right']} style={ui.screen}>
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to errand" onPress={back} style={{ paddingVertical: 8 }}><Text style={ui.h3}>← Back</Text></Pressable>
        <View style={{ flex: 1 }}><Text style={ui.h2}>{context.partnerName}</Text><Text style={ui.small} numberOfLines={1}>{context.title}</Text></View>
        <View style={ui.badge}><Text style={ui.badgeText}>{context.demo ? 'DEMO' : 'CHAT'}</Text></View>
      </View>
      {context.demo && <View style={styles.notice}><Text style={ui.small}>Demo conversation · runner replies are simulated.</Text></View>}
      {context.channel ? <Conversation key={`${context.errandId}-${context.channel}`} context={context} channel={context.channel} /> : <View style={styles.empty}><Text style={ui.h2}>Your runner chat</Text><Text style={ui.body}>{context.reason}</Text></View>}
    </KeyboardAvoidingView>
  </SafeAreaView>;
}

function Conversation({ context, channel }: { context: ChatContext; channel: string }) {
  const { results, status, loadMore } = usePaginatedQuery(api.messages.list, { errandId: context.errandId, channel }, { initialNumItems: 30 });
  const { isWebSocketConnected } = useConvexConnectionState();
  const [fullImage, setFullImage] = useState<string | null>(null);
  const confirmedIds = useMemo(() => results.map(message => message.clientId), [results]);
  return <>
    {!isWebSocketConnected && <View style={styles.notice}><Text style={ui.small}>Reconnecting · showing saved messages</Text></View>}
    <FlatList data={results} inverted keyExtractor={message => message._id}
      style={{ flex: 1 }} contentContainerStyle={styles.messages} keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag" maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 80 }}
      renderItem={({ item }) => <MessageBubble message={item} mine={item.senderId === context.viewerId} partner={context.partnerName} onImage={setFullImage} />}
      ListEmptyComponent={<View style={styles.empty}>{status === 'LoadingFirstPage' ? <ActivityIndicator color={palette.green} /> : <><Text style={ui.h2}>Start the conversation</Text><Text style={ui.body}>Send a note, a photo of an item, or a picture of the pickup spot.</Text></>}</View>}
      ListFooterComponent={status === 'CanLoadMore' || status === 'LoadingMore' ? <Pressable accessibilityRole="button" disabled={status === 'LoadingMore'} onPress={() => loadMore(30)} style={{ padding: 18 }}><Text style={[ui.h3, { textAlign: 'center' }]}>{status === 'LoadingMore' ? 'Loading…' : 'Earlier messages'}</Text></Pressable> : null} />
    {context.canSend ? <ChatComposer errandId={context.errandId} channel={channel} connected={isWebSocketConnected} confirmedIds={confirmedIds} /> : <View style={styles.notice}><Text style={ui.body}>{context.reason}</Text></View>}
    <Modal visible={fullImage !== null} animationType="fade" onRequestClose={() => setFullImage(null)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#111A16' }}><Pressable accessibilityRole="button" accessibilityLabel="Close image" onPress={() => setFullImage(null)} style={{ padding: 22 }}><Text style={{ color: '#FFFFFF', fontSize: 17 }}>✕ Close</Text></Pressable>{fullImage && <Image source={{ uri: fullImage }} style={{ flex: 1 }} contentFit="contain" accessibilityLabel="Full-size chat image" cachePolicy="memory" />}</SafeAreaView>
    </Modal>
  </>;
}

function MessageBubble({ message, mine, partner, onImage }: { message: Message; mine: boolean; partner: string; onImage: (url: string) => void }) {
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  return <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
    <Text style={[styles.sender, mine && { color: '#D3E4D9' }]}>{mine ? 'You' : message.demoReply ? 'Demo runner · simulated' : partner}</Text>
    {message.image && (message.imageUrl ? <Pressable accessibilityRole="button" accessibilityLabel={failed ? 'Retry loading image' : 'Open image full screen'} onPress={() => { if (failed) { setFailed(false); setRetry(value => value + 1); } else onImage(message.imageUrl!); }}>{failed ? <View style={[styles.image, { justifyContent: 'center', padding: 15 }]}><Text style={ui.body}>Image unavailable. Tap to retry.</Text></View> : <Image key={retry} source={{ uri: message.imageUrl }} style={styles.image} contentFit="cover" onError={() => setFailed(true)} accessibilityLabel="Image attachment" cachePolicy="memory" />}</Pressable> : <Text style={[ui.small, mine && { color: '#FFFFFF' }]}>Image no longer available.</Text>)}
    {!!message.text && <Text selectable style={[styles.messageText, mine && { color: '#FFFFFF' }]}>{message.text}</Text>}
    <Text style={[ui.small, { textAlign: 'right', fontSize: 10 }, mine && { color: '#D3E4D9' }]}>{new Date(message._creationTime).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {new Date(message._creationTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{mine ? ' · Sent' : ''}</Text>
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, width: '100%', maxWidth: 700, alignSelf: 'center' },
  header: { paddingHorizontal: 18, paddingVertical: 12, gap: 12, flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: palette.line },
  notice: { backgroundColor: palette.pale, paddingHorizontal: 18, paddingVertical: 10 },
  messages: { padding: 16 },
  empty: { padding: 28, gap: 12, alignItems: 'center' },
  bubble: { maxWidth: '86%', borderRadius: 20, padding: 12, gap: 7, marginBottom: 12 },
  mine: { alignSelf: 'flex-end', backgroundColor: palette.green, borderBottomRightRadius: 5 },
  theirs: { alignSelf: 'flex-start', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: palette.line, borderBottomLeftRadius: 5 },
  sender: { color: palette.orange, fontSize: 11, fontWeight: '700' },
  messageText: { color: palette.ink, fontSize: 15, lineHeight: 22 },
  image: { width: 230, maxWidth: '100%', height: 180, borderRadius: 12, backgroundColor: palette.pale },
});
