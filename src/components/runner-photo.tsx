import { useAuthToken } from '@convex-dev/auth/react';
import { useConvexConnectionState, useMutation } from 'convex/react';
import { ConvexError } from 'convex/values';
import { File } from 'expo-file-system';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useEffect, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { CustomerButton, FormError, palette, ui } from './customer-ui';

export function RunnerAvatar({ url, name = 'Runner', size = 72 }: { url?: string | null; name?: string; size?: number }) {
  return url ? <Image source={{ uri: url }} accessibilityLabel={`${name}'s profile photo`} contentFit="cover" style={{ width: size, height: size, borderRadius: size / 2 }} /> : <View accessibilityLabel={`${name}'s profile`} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: palette.pale, alignItems: 'center', justifyContent: 'center' }}><Text style={ui.h2}>{name.trim().slice(0, 1).toUpperCase() || 'R'}</Text></View>;
}

export function RunnerPhotoEditor({ photoUrl, photoId }: { photoUrl: string | null; photoId: Id<'_storage'> | null }) {
  const token = useAuthToken(); const remove = useMutation(api.runnerPhotos.remove);
  const { isWebSocketConnected } = useConvexConnectionState();
  const [draft, setDraft] = useState<{ uri: string; requestId: string; expectedPhotoId: string } | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const locked = useRef(false); const mounted = useRef(true); const controller = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  async function run(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch (err) { if (mounted.current) setError(err instanceof ConvexError && typeof err.data === 'string' ? err.data : err instanceof Error && err.name !== 'AbortError' ? err.message : 'Upload interrupted. Retry saving the photo.'); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  async function choose(camera: boolean) {
    if (camera && !(await ImagePicker.requestCameraPermissionsAsync()).granted) throw new Error('Allow camera access in your phone settings to take a profile photo.');
    const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8, exif: false, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible };
    const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !mounted.current) return;
    const asset = result.assets[0]; const context = ImageManipulator.manipulate(asset.uri);
    let rendered: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
    try {
      if (Math.max(asset.width, asset.height) > 800) context.resize(asset.width >= asset.height ? { width: 800 } : { height: 800 });
      rendered = await context.renderAsync(); const jpeg = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
      if (mounted.current) setDraft({ uri: jpeg.uri, requestId: `profile-${Date.now()}-${Math.random().toString(36).slice(2)}`, expectedPhotoId: photoId ?? '' });
    } finally { rendered?.release(); context.release(); }
  }
  async function save() {
    if (!draft || !token) throw new Error('Sign in again to save your photo.');
    const site = process.env.EXPO_PUBLIC_CONVEX_SITE_URL;
    if (!site) throw new Error('Photo uploads are not configured.');
    const abort = new AbortController(); controller.current = abort;
    const timer = setTimeout(() => abort.abort(), 60_000);
    try {
      const form = new FormData(); form.append('requestId', draft.requestId); form.append('expectedPhotoId', draft.expectedPhotoId);
      if (Platform.OS === 'web') form.append('image', await (await fetch(draft.uri)).blob(), 'runner.jpg');
      else { const file = new File(draft.uri); if (file.size > 5 * 1024 * 1024) throw new Error('Choose a photo smaller than 5 MB.'); form.append('image', file); }
      const response = await fetch(`${site}/runner/photo`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form, signal: abort.signal });
      const result: unknown = await response.json();
      if (!response.ok || !result || typeof result !== 'object' || !('id' in result) || typeof result.id !== 'string') throw new Error(result && typeof result === 'object' && 'error' in result && typeof result.error === 'string' ? result.error : 'Could not confirm the upload. Retry saving this photo.');
      if (mounted.current) { setDraft(null); setNotice('Profile photo saved.'); }
    } finally { clearTimeout(timer); controller.current = null; }
  }
  const disabled = busy || !isWebSocketConnected;
  return <View style={ui.card}><Text style={ui.h2}>Profile photo</Text><RunnerAvatar url={draft?.uri ?? photoUrl} size={96} />
    <Text style={ui.body}>Help buyers recognise you. Your photo and introduction appear with your quotes.</Text>
    <FormError message={error} />{!!notice && <Text accessibilityLiveRegion="polite" style={ui.body}>{notice}</Text>}
    <CustomerButton disabled={disabled} onPress={() => void run(() => choose(false))}>Choose profile photo</CustomerButton>
    <CustomerButton disabled={disabled} onPress={() => void run(() => choose(true))}>Take profile photo</CustomerButton>
    {draft ? <><CustomerButton disabled={disabled} onPress={() => void run(save)}>{busy ? 'Saving…' : 'Save photo'}</CustomerButton><CustomerButton disabled={busy} onPress={() => { setDraft(null); setError(''); }}>Discard selection</CustomerButton></> : photoId && <CustomerButton disabled={disabled} onPress={() => void run(async () => { await remove({ expectedPhotoId: photoId }); if (mounted.current) setNotice('Profile photo removed.'); })}>Remove photo</CustomerButton>}
    {!isWebSocketConnected && <Text style={ui.small}>Reconnect to update your photo.</Text>}
  </View>;
}
