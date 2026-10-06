import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError, v } from 'convex/values';
import { mutation, query, type QueryCtx } from './_generated/server';

async function requireCustomer(ctx: QueryCtx) {
  const id = await getAuthUserId(ctx);
  if (!id || !(await ctx.db.get('users', id))) throw new ConvexError('Sign in to change your settings.');
  return id;
}

export const me = query({
  args: {},
  returns: v.union(v.null(), v.object({ name: v.string(), email: v.string() })),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    const user = await ctx.db.get('users', userId);
    return user ? { name: user.name ?? 'Customer', email: user.email ?? '' } : null;
  },
});

export const preferences = query({
  args: {},
  returns: v.union(v.null(), v.object({ deliveryAddress: v.string() })),
  handler: async (ctx) => {
    const customerId = await getAuthUserId(ctx);
    if (!customerId) return null;
    const preferences = await ctx.db.query('customerPreferences').withIndex('by_customerId', (q) => q.eq('customerId', customerId)).unique();
    return { deliveryAddress: preferences?.deliveryAddress ?? '' };
  },
});

export const updateName = mutation({
  args: { name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const customerId = await requireCustomer(ctx);
    const name = args.name.trim();
    if (name.length < 2 || name.length > 80) throw new ConvexError('Your name must be 2–80 characters.');
    await ctx.db.patch('users', customerId, { name });
    return null;
  },
});

export const updateDeliveryAddress = mutation({
  args: { deliveryAddress: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const customerId = await requireCustomer(ctx);
    const deliveryAddress = args.deliveryAddress.trim();
    if (deliveryAddress.length > 300 || (deliveryAddress.length > 0 && deliveryAddress.length < 3)) throw new ConvexError('Use 3–300 characters for your address, or leave it empty to remove it.');
    const existing = await ctx.db.query('customerPreferences').withIndex('by_customerId', (q) => q.eq('customerId', customerId)).unique();
    if (existing) await ctx.db.patch('customerPreferences', existing._id, { deliveryAddress });
    else await ctx.db.insert('customerPreferences', { customerId, deliveryAddress });
    return null;
  },
});
