import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError } from 'convex/values';
import { httpAction } from './_generated/server';
import { internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { boundedBody, imageMime, MAX_IMAGE_BYTES } from './lib/chatImage';

const headers = {
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Cache-Control': 'no-store',
};
function json(body: object, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } }); }
export const preflight = httpAction(async () => new Response(null, { status: 204, headers }));

export const upload = httpAction(async (ctx, request) => {
  if (!(await getAuthUserId(ctx))) return json({ error: 'Sign in to send an image.' }, 401);
  let storedId: Id<'_storage'> | undefined;
  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.startsWith('multipart/form-data;')) return json({ error: 'Invalid image upload.' }, 400);
    const bytes = await boundedBody(request, MAX_IMAGE_BYTES + 32_768);
    // React Native's global FormData declaration lacks the server-side get()
    // method. This is the standard Web FormData returned by Convex's Response.
    const form = await new Response(bytes, { headers: { 'Content-Type': contentType } }).formData() as unknown as { get(name: string): string | Blob | null };
    const errandId = form.get('errandId'); const channel = form.get('channel');
    const clientId = form.get('clientId'); const text = form.get('text'); const image = form.get('image');
    if (typeof errandId !== 'string' || typeof channel !== 'string' || typeof clientId !== 'string' || typeof text !== 'string' || !image || typeof image === 'string') return json({ error: 'Invalid image upload.' }, 400);
    if (image.size < 12 || image.size > MAX_IMAGE_BYTES) return json({ error: 'Choose an image of 5 MB or smaller.' }, 400);
    const mimeType = imageMime(new Uint8Array(await image.slice(0, 16).arrayBuffer()));
    if (!mimeType) return json({ error: 'This image is not JPEG, PNG or WebP. Choose the photo again so the app can convert it.' }, 400);
    const args = { errandId: errandId as Id<'errands'>, channel, clientId, text };
    const existing: Id<'messages'> | null = await ctx.runQuery(internal.messages.imageUploadContext, args);
    if (existing) return json({ messageId: existing });
    // Phone metadata may describe the original photo rather than the exported
    // file. Validate the bytes and store their actual type, never the label.
    storedId = await ctx.storage.store(image.slice(0, image.size, mimeType));
    const messageId: Id<'messages'> = await ctx.runMutation(internal.messages.commitImage, { ...args, image: { storageId: storedId, mimeType, size: image.size } });
    return json({ messageId });
  } catch (error) {
    if (storedId) await ctx.storage.delete(storedId);
    const message = error instanceof ConvexError && typeof error.data === 'string' ? error.data : error instanceof Error && error.message === 'Image must be 5 MB or smaller.' ? error.message : 'Could not send this image. Please try again.';
    return json({ error: message }, 400);
  }
});
