import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError, v } from 'convex/values';
import { internal } from './_generated/api';
import { httpAction, internalMutation, internalQuery, mutation, type QueryCtx } from './_generated/server';
import type { Id } from './_generated/dataModel';
import { requireRunner } from './runnerJobs';
import { boundedBody, imageMime, MAX_IMAGE_BYTES } from './lib/chatImage';

async function ownProfile(ctx: QueryCtx) {
  const user = await requireRunner(ctx);
  const profile = await ctx.db.query('runnerProfiles').withIndex('by_userId', q => q.eq('userId', user._id)).unique();
  if (!profile) throw new ConvexError('Save your runner details before adding a photo.');
  return profile;
}
const uploadArgs = { requestId: v.string(), expectedPhotoId: v.string() };
async function check(ctx: QueryCtx, requestId: string, expectedPhotoId: string) {
  const profile = await ownProfile(ctx);
  if (!/^[a-zA-Z0-9-]{10,100}$/.test(requestId)) throw new ConvexError('Invalid photo request.');
  if (profile.photo?.requestId === requestId) return { profile, existing: profile.photo.storageId };
  if ((profile.photo?.storageId ?? '') !== expectedPhotoId) throw new ConvexError('Your photo changed. Reopen your profile before replacing it.');
  return { profile, existing: null };
}
export const context = internalQuery({
  args: uploadArgs, returns: v.union(v.id('_storage'), v.null()),
  handler: async (ctx, args) => (await check(ctx, args.requestId, args.expectedPhotoId)).existing,
});
export const commit = internalMutation({
  args: { ...uploadArgs, storageId: v.id('_storage') },
  returns: v.object({ id: v.id('_storage'), usedUpload: v.boolean() }),
  handler: async (ctx, args) => {
    const { profile, existing } = await check(ctx, args.requestId, args.expectedPhotoId);
    if (existing) return { id: existing, usedUpload: false };
    await ctx.db.patch('runnerProfiles', profile._id, { photo: { storageId: args.storageId, requestId: args.requestId }, updatedAt: Date.now() });
    if (profile.photo) await ctx.storage.delete(profile.photo.storageId);
    return { id: args.storageId, usedUpload: true };
  },
});
export const remove = mutation({
  args: { expectedPhotoId: v.id('_storage') }, returns: v.null(),
  handler: async (ctx, { expectedPhotoId }) => {
    const profile = await ownProfile(ctx);
    if (!profile.photo) return null;
    if (profile.photo.storageId !== expectedPhotoId) throw new ConvexError('Your photo changed. Reopen your profile before removing it.');
    await ctx.db.patch('runnerProfiles', profile._id, { photo: undefined, updatedAt: Date.now() });
    await ctx.storage.delete(expectedPhotoId);
    return null;
  },
});
const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
export const preflight = httpAction(async () => new Response(null, { status: 204, headers }));
export const upload = httpAction(async (ctx, request) => {
  if (!(await getAuthUserId(ctx))) return json({ error: 'Sign in to upload your profile photo.' }, 401);
  let storageId: Id<'_storage'> | undefined;
  let committed = false;
  try {
    const contentType = request.headers.get('content-type') ?? '';
    if (!contentType.startsWith('multipart/form-data;')) throw new Error('Invalid upload.');
    const bytes = await boundedBody(request, MAX_IMAGE_BYTES + 32_768);
    const form = await new Response(bytes, { headers: { 'Content-Type': contentType } }).formData() as unknown as { get(name: string): string | Blob | null };
    const requestId = form.get('requestId'); const expectedPhotoId = form.get('expectedPhotoId'); const image = form.get('image');
    if (typeof requestId !== 'string' || typeof expectedPhotoId !== 'string' || !image || typeof image === 'string') throw new Error('Invalid upload.');
    if (image.size < 12 || image.size > MAX_IMAGE_BYTES) throw new ConvexError('Choose a photo of 5 MB or smaller.');
    const mimeType = imageMime(new Uint8Array(await image.slice(0, 16).arrayBuffer()));
    if (!mimeType) throw new ConvexError('Choose a JPEG, PNG or WebP photo.');
    const args = { requestId, expectedPhotoId };
    const existing: Id<'_storage'> | null = await ctx.runQuery(internal.runnerPhotos.context, args);
    if (existing) return json({ id: existing });
    storageId = await ctx.storage.store(image.slice(0, image.size, mimeType));
    const result: { id: Id<'_storage'>; usedUpload: boolean } = await ctx.runMutation(internal.runnerPhotos.commit, { ...args, storageId });
    committed = result.usedUpload;
    if (!committed) await ctx.storage.delete(storageId);
    return json({ id: result.id });
  } catch (err) {
    if (storageId && !committed) await ctx.storage.delete(storageId);
    return json({ error: err instanceof ConvexError && typeof err.data === 'string' ? err.data : 'Could not save your profile photo. Please retry.' }, 400);
  }
});
