import { v } from 'convex/values';
import { internalAction } from './_generated/server';
import { internal } from './_generated/api';
import { pushCopy } from './lib/pushFields';

type ExpoResult = { status?: string; id?: string; details?: { error?: string } };
async function post(path: 'send' | 'getReceipts', payload: unknown) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`https://exp.host/--/api/v2/push/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(process.env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` } : {}) }, body: JSON.stringify(payload), signal: controller.signal });
    const body: unknown = await response.json();
    return { status: response.status, body };
  } finally { clearTimeout(timer); }
}
function data(body: unknown): unknown { return body && typeof body === 'object' && 'data' in body ? body.data : null; }
function result(value: unknown): ExpoResult | null {
  if (!value || typeof value !== 'object' || !('status' in value) || !['ok', 'error'].includes(String(value.status))) return null;
  const item = value as ExpoResult;
  return { status: item.status, id: typeof item.id === 'string' ? item.id : undefined, details: { error: typeof item.details?.error === 'string' ? item.details.error : undefined } };
}
export const send = internalAction({
  args: { id: v.id('pushJobs') }, returns: v.null(),
  handler: async (ctx, { id }) => {
    const claim = await ctx.runMutation(internal.push.claim, { id }); if (!claim) return null;
    const { job, token, attempt } = claim;
    try {
      const [title, body] = pushCopy[job.kind];
      const response = await post('send', { to: token, title, body, sound: 'default', channelId: 'errand-updates', ttl: 3600, data: { notificationId: id, recipientId: job.userId } });
      const raw = data(response.body); const ticket = result(Array.isArray(raw) ? raw[0] : raw);
      if (response.status >= 200 && response.status < 300 && ticket?.status === 'ok' && ticket.id) await ctx.runMutation(internal.push.finishSend, { id, attempt, ticketId: ticket.id });
      else {
        const code = ticket?.details?.error ?? `HTTP${response.status}`;
        await ctx.runMutation(internal.push.finishSend, { id, attempt, errorCode: code, retry: response.status === 429 || response.status >= 500 || code === 'MessageRateExceeded' });
      }
    } catch { await ctx.runMutation(internal.push.finishSend, { id, attempt, errorCode: 'NetworkError', retry: true }); }
    return null;
  },
});
export const receipt = internalAction({
  args: { id: v.id('pushJobs') }, returns: v.null(),
  handler: async (ctx, { id }) => {
    const job = await ctx.runQuery(internal.push.receiptJob, { id }); if (!job?.ticketId) return null;
    try {
      const response = await post('getReceipts', { ids: [job.ticketId] });
      const raw = data(response.body); const entry = raw && typeof raw === 'object' && job.ticketId in raw ? result((raw as Record<string, unknown>)[job.ticketId]) : null;
      await ctx.runMutation(internal.push.finishReceipt, { id, status: entry?.status === 'ok' ? 'ok' : entry?.status === 'error' ? 'error' : 'pending', errorCode: entry?.details?.error });
    } catch { await ctx.runMutation(internal.push.finishReceipt, { id, status: 'pending', errorCode: 'ReceiptNetworkError' }); }
    return null;
  },
});
