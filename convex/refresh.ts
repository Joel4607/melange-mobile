import { v } from 'convex/values';
import { query } from './_generated/server';

// A unique request joins the client's current consistent query snapshot. It
// confirms a server round-trip without changing records or restarting GPS.
export const sync = query({
  args: { nonce: v.string() },
  returns: v.number(),
  handler: () => Date.now(),
});
