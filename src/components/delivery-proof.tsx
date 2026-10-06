import { useAuthToken } from '@convex-dev/auth/react';
import { useConvexConnectionState, useQuery } from 'convex/react';
import { Image } from 'expo-image';
import { File } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useEffect, useRef, useState } from 'react';
import { Modal, Platform, Pressable, Text, View } from 'react-native';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';
import { CustomerButton, CustomerPage, FormError, ui } from './customer-ui';

export function DeliveryProof({ id, editable = false }: { id: Id<'errands'>; editable?: boolean }) {
  const proof = useQuery(api.deliveryProofs.get, { id });
  const token = useAuthToken();
  const { isWebSocketConnected } = useConvexConnectionState();
  const [photo, setPhoto] = useState<{ uri: string; requestId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [zoom, setZoom] = useState(false);
  const locked = useRef(false); const mounted = useRef(true);
  const upload = useRef<AbortController | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; upload.current?.abort(); }; }, []);
  async function choose(camera: boolean) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError('');
    try {
      if (camera && !(await ImagePicker.requestCameraPermissionsAsync()).granted) throw new Error('Allow camera access to take the handover photo.');
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.8, exif: false, preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible };
      const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      if (result.canceled || !mounted.current) return;
      const asset = result.assets[0]; const context = ImageManipulator.manipulate(asset.uri);
      let rendered: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
      try {
        if (Math.max(asset.width, asset.height) > 1920) context.resize(asset.width >= asset.height ? { width: 1920 } : { height: 1920 });
        rendered = await context.renderAsync();
        const image = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
        if (mounted.current) setPhoto({ uri: image.uri, requestId: `proof-${Date.now()}-${Math.random().toString(36).slice(2)}` });
      } finally { rendered?.release(); context.release(); }
    } catch (err) { if (mounted.current) setError(err instanceof Error ? err.message : 'Could not prepare this photo.'); }
    finally { locked.current = false; if (mounted.current) setBusy(false); }
  }
  async function save() {
    if (locked.current || !photo || !token || !isWebSocketConnected) return;
    locked.current = true; setBusy(true); setError('');
    const controller = new AbortController(); upload.current = controller;
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const site = process.env.EXPO_PUBLIC_CONVEX_SITE_URL;
      if (!site) throw new Error('Photo uploads are not configured.');
      const form = new FormData(); form.append('id', id); form.append('requestId', photo.requestId);
      if (Platform.OS === 'web') form.append('image', await (await fetch(photo.uri)).blob(), 'handover.jpg');
      else { const file = new File(photo.uri); if (file.size > 5 * 1024 * 1024) throw new Error('Choose a smaller photo. Maximum size is 5 MB.'); form.append('image', file); }
      const response = await fetch(`${site}/delivery/photo`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form, signal: controller.signal });
      const result = await response.json();
      if (!response.ok || typeof result.id !== 'string') throw new Error(result.error || 'Could not confirm the upload. Retry the same photo.');
      if (mounted.current) setPhoto(null);
    } catch (err) { if (mounted.current) setError(err instanceof Error && err.name !== 'AbortError' ? err.message : 'Upload interrupted. Retry to confirm or finish saving this photo.'); }
    finally { clearTimeout(timer); upload.current = null; locked.current = false; if (mounted.current) setBusy(false); }
  }
  const uri = proof?.url ?? photo?.uri;
  return <View style={ui.card}><Text style={ui.h2}>Handover photo</Text>
    {uri && <Pressable accessibilityRole="button" accessibilityLabel="Enlarge handover photo" onPress={() => setZoom(true)}><Image source={{ uri }} contentFit="contain" style={{ width: '100%', height: 220, borderRadius: 14 }} /></Pressable>}
    {proof ? <Text style={ui.small}>{proof.url ? 'Saved' : 'Photo unavailable'} · {new Date(proof.createdAt).toLocaleString()}</Text> : proof === undefined ? <Text style={ui.body}>Loading delivery proof…</Text> : editable ? <>
      <Text style={ui.body}>Photograph the delivered items at handover. Avoid including faces or unrelated personal information. The buyer can view the photo before confirming receipt.</Text>
      <FormError message={error} /><CustomerButton disabled={busy || !isWebSocketConnected} onPress={() => void choose(true)}>Take handover photo</CustomerButton><CustomerButton disabled={busy || !isWebSocketConnected} onPress={() => void choose(false)}>Choose photo</CustomerButton>
      {photo && <><Text style={ui.small}>Check the preview. Once saved, this photo becomes the delivery record.</Text><CustomerButton disabled={busy || !isWebSocketConnected} onPress={() => void save()}>{busy ? 'Saving…' : 'Save handover photo'}</CustomerButton><CustomerButton disabled={busy} onPress={() => setPhoto(null)}>Remove selection</CustomerButton></>}
    </> : <Text style={ui.body}>No handover photo has been saved.</Text>}
    <Modal visible={zoom} onRequestClose={() => setZoom(false)}><CustomerPage><CustomerButton onPress={() => setZoom(false)}>Close photo</CustomerButton>{uri && <Image source={{ uri }} contentFit="contain" style={{ width: '100%', height: 480 }} />}</CustomerPage></Modal>
  </View>;
}
