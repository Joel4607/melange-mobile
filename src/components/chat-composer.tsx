import { useAuthToken } from '@convex-dev/auth/react';
import { useMutation } from 'convex/react';
import { ConvexError } from 'convex/values';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { FormError, palette, ui } from './customer-ui';

type Attachment = { asset: ImagePicker.ImagePickerAsset; mimeType: string };
const siteUrl = process.env.EXPO_PUBLIC_CONVEX_SITE_URL;

export function ChatComposer({ errandId, channel, connected, confirmedIds }: {
  errandId: Id<'errands'>; channel: string; connected: boolean; confirmedIds: string[];
}) {
  const token = useAuthToken();
  const sendText = useMutation(api.messages.sendText);
  const [text, setText] = useState('');
  const [attachment, setAttachment] = useState<Attachment>();
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');
  const clientId = useRef<string | null>(null);
  const locked = useRef(false);
  const pickerLocked = useRef(false);
  const mounted = useRef(true);
  const upload = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; upload.current?.abort(); }; }, []);
  useEffect(() => {
    if (clientId.current && confirmedIds.includes(clientId.current)) {
      clientId.current = null; setText(''); setAttachment(undefined); setError('');
    }
  }, [confirmedIds]);
  function edited() { clientId.current = null; setError(''); }

  async function pick(camera: boolean) {
    if (locked.current || pickerLocked.current) return;
    pickerLocked.current = true; setPicking(true); setError('');
    try {
      if (camera) {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) throw new Error('Allow camera access in your phone settings to take a photo.');
      }
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.75, allowsMultipleSelection: false, exif: false, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible };
      const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (!mounted.current || result.canceled) return;
      const asset = result.assets[0];
      // Encode the actual pixels, not just a new filename/MIME label. This also
      // handles HEIC photos and bounds upload size without a base64 copy.
      const context = ImageManipulator.manipulate(asset.uri);
      let rendered: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
      try {
        if (Math.max(asset.width, asset.height) > 1920) context.resize(asset.width >= asset.height ? { width: 1920 } : { height: 1920 });
        rendered = await context.renderAsync();
        const jpeg = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
        if (!mounted.current) return;
        // Do not retain asset.file: on web it points at the unconverted original.
        edited(); setAttachment({ asset: { uri: jpeg.uri, width: jpeg.width, height: jpeg.height, mimeType: 'image/jpeg', fileName: 'chat-photo.jpg' }, mimeType: 'image/jpeg' });
      } catch {
        throw new Error('Could not prepare this photo. Try another photo or a screenshot.');
      } finally { rendered?.release(); context.release(); }
    } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : 'Could not open your photos.'); }
    finally { pickerLocked.current = false; if (mounted.current) setPicking(false); }
  }

  async function send() {
    if (locked.current || pickerLocked.current || !connected || (!text.trim() && !attachment)) return;
    locked.current = true; setBusy(true); setError('');
    const reference = clientId.current ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    clientId.current = reference;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      if (attachment) {
        if (!siteUrl || !token) throw new Error('Image sending is unavailable. Check your connection and sign in again.');
        const form = new FormData();
        form.append('errandId', errandId); form.append('channel', channel);
        form.append('clientId', reference); form.append('text', text.trim());
        const name = `chat-photo.${attachment.mimeType === 'image/png' ? 'png' : attachment.mimeType === 'image/webp' ? 'webp' : 'jpg'}`;
        if (Platform.OS === 'web') {
          const blob = attachment.asset.file ?? await (await fetch(attachment.asset.uri)).blob();
          form.append('image', blob, name);
        } else {
          // Expo fetch requires a File/Blob, not React Native's URI descriptor.
          const file = new File(attachment.asset.uri);
          if (file.size > 5 * 1024 * 1024) throw new Error('Choose an image of 5 MB or smaller.');
          form.append('image', file);
        }
        const controller = new AbortController(); upload.current = controller;
        timeout = setTimeout(() => controller.abort(), 60_000);
        const response = await fetch(`${siteUrl}/chat/image`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form, signal: controller.signal });
        const result: unknown = await response.json();
        if (!response.ok) throw new Error(result && typeof result === 'object' && 'error' in result && typeof result.error === 'string' ? result.error : 'Could not send the image. Retry when connected.');
        if (!result || typeof result !== 'object' || !('messageId' in result) || typeof result.messageId !== 'string') throw new Error('Could not confirm delivery. Please retry.');
      } else {
        await sendText({ errandId, channel, clientId: reference, text: text.trim() });
      }
      if (mounted.current) { clientId.current = null; setText(''); setAttachment(undefined); setError(''); }
    } catch (err) {
      // A live echo can confirm an upload even if its HTTP response was lost.
      if (mounted.current && clientId.current === reference) {
        setError(err instanceof ConvexError && typeof err.data === 'string' ? err.data : err instanceof Error && err.name !== 'AbortError' ? err.message : 'Could not confirm delivery. Retry to check or finish sending.');
      }
    } finally {
      clearTimeout(timeout); upload.current = null; locked.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const disabled = busy || picking;
  return <View style={styles.composer}>
    <FormError message={error} />
    {attachment && <View style={ui.row}>
      <Image source={{ uri: attachment.asset.uri }} style={styles.preview} contentFit="cover" accessibilityLabel="Selected image preview" />
      <View style={{ flex: 1, gap: 5 }}><Text style={ui.h3}>Image ready to send</Text><Text style={ui.small}>Add a caption below, or send it on its own.</Text><Pressable accessibilityRole="button" disabled={disabled} onPress={() => { edited(); setAttachment(undefined); }}><Text style={{ color: palette.orange }}>Remove image</Text></Pressable></View>
    </View>}
    <View style={ui.row}>
      <TextInput accessibilityLabel={attachment ? 'Image caption' : 'Message'} value={text} onChangeText={value => { edited(); setText(value); }} multiline maxLength={2000} editable={!disabled} placeholder={attachment ? 'Add a caption…' : 'Write a message…'} placeholderTextColor={palette.muted} style={styles.input} />
      <Pressable accessibilityRole="button" accessibilityLabel={error ? 'Retry sending message' : 'Send message'} accessibilityState={{ disabled: disabled || !connected || (!text.trim() && !attachment) }} disabled={disabled || !connected || (!text.trim() && !attachment)} onPress={() => void send()} style={[styles.send, { opacity: disabled || !connected || (!text.trim() && !attachment) ? 0.5 : 1 }]}>{busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>{error ? 'Retry' : 'Send'}</Text>}</Pressable>
    </View>
    <View style={ui.between}>
      <View style={ui.row}><Pressable accessibilityRole="button" disabled={disabled} onPress={() => void pick(false)} style={styles.attach}><Text style={ui.h3}>＋ Photo</Text></Pressable><Pressable accessibilityRole="button" disabled={disabled} onPress={() => void pick(true)} style={styles.attach}><Text style={ui.h3}>Camera</Text></Pressable></View>
      <Text style={ui.small}>{busy ? attachment ? 'Uploading…' : 'Sending…' : picking ? 'Choosing image…' : `${text.length}/2000`}</Text>
    </View>
    {!connected && <Text style={ui.small}>Reconnecting… {busy ? 'waiting for confirmation.' : 'your draft stays here until you send.'}</Text>}
  </View>;
}
const styles = StyleSheet.create({
  composer: { padding: 14, gap: 10, backgroundColor: '#FFFFFF', borderTopWidth: 1, borderTopColor: palette.line },
  input: { flex: 1, minHeight: 48, maxHeight: 120, borderRadius: 18, backgroundColor: palette.background, padding: 13, fontSize: 16, color: palette.ink },
  send: { minWidth: 62, minHeight: 48, borderRadius: 16, backgroundColor: palette.green, alignItems: 'center', justifyContent: 'center' },
  preview: { height: 74, width: 74, borderRadius: 12 },
  attach: { paddingVertical: 6, paddingHorizontal: 4, minHeight: 36 },
});
