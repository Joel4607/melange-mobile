import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError, v } from 'convex/values';
import { mutation, query, type QueryCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';

const roleValidator = v.union(v.literal('buyer'), v.literal('runner'));

async function savedRole(ctx: QueryCtx, user: Doc<'users'>) {
  if (user.role) return user.role;
  const profile = await ctx.db.query('runnerProfiles').withIndex('by_userId', q => q.eq('userId', user._id)).unique();
  const access = await ctx.db.query('runnerAccess').withIndex('by_userId', q => q.eq('userId', user._id)).unique();
  return profile || access?.enabled ? 'runner' as const : null;
}

export const me = query({
  args: {}, returns: v.union(v.null(), v.object({ _id: v.id('users'), name: v.string(), email: v.string(), role: v.union(roleValidator, v.null()) })),
  handler: async ctx => {
    const id = await getAuthUserId(ctx);
    const user = id ? await ctx.db.get('users', id) : null;
    return user ? { _id: user._id, name: user.name || 'Melange member', email: user.email || '', role: await savedRole(ctx, user) } : null;
  },
});

// One-time role selection for accounts created before roles were introduced.
export const chooseRole = mutation({
  args: { role: roleValidator }, returns: v.null(),
  handler: async (ctx, { role }) => {
    const id = await getAuthUserId(ctx);
    const user = id ? await ctx.db.get('users', id) : null;
    if (!user) throw new ConvexError('Sign in to choose your account role.');
    const existing = await savedRole(ctx, user);
    if (existing && existing !== role) throw new ConvexError('This account already has a role. Sign in with your other account.');
    await ctx.db.patch('users', user._id, { role });
    return null;
  },
});
