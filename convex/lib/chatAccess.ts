import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError } from 'convex/values';
import type { QueryCtx } from '../_generated/server';

export async function chatAccess(ctx: QueryCtx, errandId: string) {
  const userId = await getAuthUserId(ctx);
  if (!userId || !(await ctx.db.get('users', userId))) throw new ConvexError('Sign in to use messages.');
  const id = ctx.db.normalizeId('errands', errandId);
  const errand = id ? await ctx.db.get('errands', id) : null;
  if (!errand || (errand.customerId !== userId && errand.runnerId !== userId)) throw new ConvexError('Conversation not found.');
  const demo = !errand.runnerId && errand.trackingMode === 'demo';
  const channel = errand.runnerId ? String(errand.runnerId) : demo ? 'demo' : null;
  const active = !errand.completion && (errand.status === 'accepted' || errand.status === 'picked_up' || errand.status === 'delivered');
  const canSend = !!channel && active && (!demo || process.env.ENABLE_DEMO_TRACKING === 'true');
  return { userId, errand, channel, demo, canSend };
}

export function validateMessage(text: string, clientId: string) {
  if (text.length > 2000) throw new ConvexError('Keep messages under 2,000 characters.');
  if (!/^[a-zA-Z0-9-]{10,100}$/.test(clientId)) throw new ConvexError('Invalid message reference.');
  return text.trim();
}
