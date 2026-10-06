import { runnerGroup } from './lib/shareLifecycle';
import { fenceRunnerLocations } from './lib/locationCleanup';
import { getAuthUserId } from '@convex-dev/auth/server';
import { ConvexError, v } from 'convex/values';
import { gridDisk, latLngToCell } from 'h3-js';
import { internal } from './_generated/api';
import { internalMutation, mutation, query, type QueryCtx } from './_generated/server';
import type { Doc } from './_generated/dataModel';
import { runnerProfileFields } from './lib/runnerProfileFields';
import { addressText, cleanAddressPart, currentAddressLabel } from './lib/runnerAddress';
import { haversineKm } from './lib/shareGeo';
import { runnerTrust } from './lib/runnerTrust';
import { trustSummary } from './lib/trustFields';
import { compareRunnerTrust } from './lib/trustScore';

const H3_RESOLUTION = 8;
const LOCATION_TTL_MS = 45_000;
const statusValidator = v.union(v.literal('online'), v.literal('offline'), v.literal('busy'));
const publicRunner = v.object({
  runnerId: v.string(), name: v.string(), status: statusValidator,
  lat: v.number(), lng: v.number(), h3Index: v.string(), updatedAt: v.number(),
  locationLabel: v.union(v.string(), v.null()),
  trust: trustSummary,
});

function validateCoordinates(lat: number, lng: number) {
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180) {
    throw new ConvexError('Invalid map coordinates.');
  }
}
async function authenticatedUser(ctx: QueryCtx) {
  const id = await getAuthUserId(ctx);
  const user = id ? await ctx.db.get('users', id) : null;
  if (!user) throw new ConvexError('Sign in to view runners.');
  return user;
}

export const profile = query({
  args: {}, returns: v.union(v.null(), v.object({ ...runnerProfileFields, photoUrl: v.union(v.string(), v.null()), photoId: v.union(v.id('_storage'), v.null()) })),
  handler: async ctx => {
    const id = await getAuthUserId(ctx);
    if (!id || !(await ctx.db.get('users', id))) return null;
    const profile = await ctx.db.query('runnerProfiles').withIndex('by_userId', q => q.eq('userId', id)).unique();
    return profile ? { phone: profile.phone, area: profile.area, transport: profile.transport, services: profile.services, bio: profile.bio, photoUrl: profile.photo ? await ctx.storage.getUrl(profile.photo.storageId) : null, photoId: profile.photo?.storageId ?? null } : null;
  },
});

// Self-registration is intentional for this prototype. No approval step.
// Identity comes from the session; registration never accepts another user's ID.
export const register = mutation({
  args: runnerProfileFields, returns: v.null(),
  handler: async (ctx, args) => {
    const user = await authenticatedUser(ctx);
    if (user.role === 'buyer') throw new ConvexError('Sign in with your runner account to set up a runner profile.');
    const phone = args.phone.trim().replace(/[\s()-]/g, '');
    const area = args.area.trim();
    const bio = args.bio?.trim();
    if (bio && bio.length > 300) throw new ConvexError('Keep your introduction under 300 characters.');
    if (!/^\+?[0-9]{9,15}$/.test(phone)) throw new ConvexError('Enter a phone number with 9–15 digits.');
    if (area.length < 2 || area.length > 100) throw new ConvexError('Enter a working area of 2–100 characters.');
    if (args.services.length < 1 || args.services.length > 6) throw new ConvexError('Choose between one and six services.');
    const services = [...new Set(args.services)];
    const profile = await ctx.db.query('runnerProfiles').withIndex('by_userId', q => q.eq('userId', user._id)).unique();
    const values = { userId: user._id, phone, area, transport: args.transport, services, ...(bio !== undefined ? { bio } : {}), updatedAt: Date.now() };
    if (profile) await ctx.db.patch('runnerProfiles', profile._id, values);
    else await ctx.db.insert('runnerProfiles', values);
    const access = await ctx.db.query('runnerAccess').withIndex('by_userId', q => q.eq('userId', user._id)).unique();
    if (access) await ctx.db.patch('runnerAccess', access._id, { enabled: true });
    else await ctx.db.insert('runnerAccess', { userId: user._id, enabled: true });
    if (!user.role) await ctx.db.patch('users', user._id, { role: 'runner' });
    return null;
  },
});

export const access = query({
  args: {},
  returns: v.union(v.null(), v.object({
    userId: v.id('users'), name: v.string(), email: v.string(),
    hasProfile: v.boolean(),
    state: v.union(v.literal('approved'), v.literal('not_enrolled'), v.literal('disabled')),
  })),
  handler: async ctx => {
    const id = await getAuthUserId(ctx);
    const user = id ? await ctx.db.get('users', id) : null;
    if (!user) return null;
    const entry = await ctx.db.query('runnerAccess').withIndex('by_userId', q => q.eq('userId', user._id)).unique();
    const profile = await ctx.db.query('runnerProfiles').withIndex('by_userId', q => q.eq('userId', user._id)).unique();
    return {
      userId: user._id, name: user.name?.trim() || 'Runner', email: user.email || '',
      hasProfile: !!profile,
      state: entry?.enabled ? 'approved' as const : entry ? 'disabled' as const : 'not_enrolled' as const,
    };
  },
});

const dashboardErrand = v.object({
  id: v.id('errands'), title: v.string(), pickup: v.string(), dropoff: v.string(),
  budgetPesewas: v.number(), status: v.union(v.literal('accepted'), v.literal('picked_up'), v.literal('delivered')),
  confirmedAt: v.union(v.number(), v.null()), deliveredAt: v.union(v.number(), v.null()),
});
function assignmentSummary(errand: Doc<'errands'>) {
  return {
    id: errand._id, title: errand.title, pickup: errand.pickup, dropoff: errand.dropoff,
    budgetPesewas: errand.budgetPesewas, status: errand.status as 'accepted' | 'picked_up' | 'delivered',
    confirmedAt: errand.completion?.confirmedAt ?? null, deliveredAt: errand.deliveredAt ?? null,
  };
}

// Revocation returns no dashboard data, including on an existing subscription.
export const dashboard = query({
  args: {},
  returns: v.union(v.null(), v.object({
    availability: statusValidator, locationUpdatedAt: v.union(v.number(), v.null()),
    locationLabel: v.union(v.string(), v.null()),
    active: v.array(dashboardErrand), hasMoreActive: v.boolean(),
    recentDeliveries: v.array(dashboardErrand),
    recentReviews: v.array(v.object({ id: v.id('reviews'), rating: v.number(), comment: v.string(), createdAt: v.number() })),
  })),
  handler: async ctx => {
    const id = await getAuthUserId(ctx);
    if (!id || !(await ctx.db.get('users', id))) return null;
    const entry = await ctx.db.query('runnerAccess').withIndex('by_userId', q => q.eq('userId', id)).unique();
    if (!entry?.enabled) return null;
    const [position, accepted, pickedUp, delivered, reviews] = await Promise.all([
      ctx.db.query('errandRunners').withIndex('by_runnerId', q => q.eq('runnerId', id)).unique(),
      ctx.db.query('errands').withIndex('by_runnerId_and_status', q => q.eq('runnerId', id).eq('status', 'accepted')).order('desc').take(11),
      ctx.db.query('errands').withIndex('by_runnerId_and_status', q => q.eq('runnerId', id).eq('status', 'picked_up')).order('desc').take(11),
      ctx.db.query('errands').withIndex('by_runnerId_status_deliveredAt', q => q.eq('runnerId', id).eq('status', 'delivered')).order('desc').take(5),
      ctx.db.query('reviews').withIndex('by_runnerId', q => q.eq('runnerId', id)).order('desc').take(3),
    ]);
    return {
      availability: position?.status ?? 'offline', locationUpdatedAt: position?.updatedAt ?? null,
      locationLabel: position ? currentAddressLabel(position) : null,
      active: [...pickedUp.slice(0, 10), ...accepted.slice(0, 10)].map(assignmentSummary),
      hasMoreActive: pickedUp.length > 10 || accepted.length > 10,
      recentDeliveries: delivered.map(assignmentSummary),
      recentReviews: reviews.filter(review => !review.isDemo).map(review => ({
        id: review._id, rating: review.rating, comment: review.comment, createdAt: review._creationTime,
      })),
    };
  },
});

// Optional internal maintenance; normal prototype signup uses register above.
export const setRunnerAccess = internalMutation({
  args: { userId: v.id('users'), enabled: v.boolean() }, returns: v.null(),
  handler: async (ctx, { userId, enabled }) => {
    if (!(await ctx.db.get('users', userId))) throw new ConvexError('User not found.');
    const access = await ctx.db.query('runnerAccess').withIndex('by_userId', q => q.eq('userId', userId)).unique();
    if (access) await ctx.db.patch('runnerAccess', access._id, { enabled, ...(!enabled ? { locationSessionId: undefined } : {}) });
    else await ctx.db.insert('runnerAccess', { userId, enabled });
    if (!enabled) {
      const runner = await ctx.db.query('errandRunners').withIndex('by_runnerId', q => q.eq('runnerId', userId)).unique();
      if (runner) await ctx.db.delete('errandRunners', runner._id);
      await fenceRunnerLocations(ctx, userId);
    }
    return null;
  },
});

export const updateLocation = mutation({
  args: { lat: v.number(), lng: v.number(), capturedAt: v.number(), status: statusValidator, sessionId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const user = await authenticatedUser(ctx);
    const access = await ctx.db.query('runnerAccess').withIndex('by_userId', q => q.eq('userId', user._id)).unique();
    if (user.role === 'buyer' || !access?.enabled) throw new ConvexError('Runner publishing access is required.');
    if (access.locationSessionId !== args.sessionId) return false;
    validateCoordinates(args.lat, args.lng);
    const now = Date.now();
    if (!Number.isFinite(args.capturedAt) || args.capturedAt < now - 30_000 || args.capturedAt > now + 10_000) {
      throw new ConvexError('Location reading is too old or has an invalid timestamp.');
    }
    const old = await ctx.db.query('errandRunners').withIndex('by_runnerId', q => q.eq('runnerId', user._id)).unique();
    if (old && args.capturedAt <= old.capturedAt) return false;
    const assignments = await Promise.all(['accepted', 'picked_up'].map(status =>
      ctx.db.query('errands').withIndex('by_runnerId_and_status', q => q.eq('runnerId', user._id).eq('status', status as 'accepted' | 'picked_up')).first(),
    ));
    const group = await runnerGroup(ctx, user._id);
    const status = args.status === 'online' && (assignments.some(Boolean) || group) ? 'busy' : args.status;
    const scheduleExpiry = status !== 'offline' && !old?.expiryScheduled;
    const values = {
      runnerId: String(user._id), name: user.name?.trim().slice(0, 80) || 'Runner', status,
      lat: args.lat, lng: args.lng, h3Index: latLngToCell(args.lat, args.lng, H3_RESOLUTION),
      capturedAt: args.capturedAt, updatedAt: now, expiryScheduled: !!old?.expiryScheduled || scheduleExpiry,
      locationSessionId: args.sessionId,
    };
    const id = old ? old._id : await ctx.db.insert('errandRunners', values);
    if (old) await ctx.db.patch('errandRunners', id, values);
    if (scheduleExpiry) await ctx.scheduler.runAfter(LOCATION_TTL_MS, internal.runners.expireLocation, { id });
    return true;
  },
});

// Address lookup is separate from GPS publishing: geocoder failures cannot stop tracking.
export const updateAddress = mutation({
  args: { city: v.string(), street: v.string(), lat: v.number(), lng: v.number(), capturedAt: v.number(), sessionId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const user = await authenticatedUser(ctx);
    const access = await ctx.db.query('runnerAccess').withIndex('by_userId', q => q.eq('userId', user._id)).unique();
    if (user.role === 'buyer' || !access?.enabled) throw new ConvexError('Runner publishing access is required.');
    if (access.locationSessionId !== args.sessionId) return false;
    validateCoordinates(args.lat, args.lng);
    if (args.city.length > 120 || args.street.length > 120) throw new ConvexError('Location name is too long.');
    const runner = await ctx.db.query('errandRunners').withIndex('by_runnerId', q => q.eq('runnerId', user._id)).unique();
    if (!runner || runner.status !== 'online' || runner.locationSessionId !== args.sessionId ||
      !Number.isFinite(args.capturedAt) || args.capturedAt < Date.now() - 30_000 || args.capturedAt > runner.capturedAt ||
      (runner.address?.sessionId === args.sessionId && args.capturedAt <= runner.address.capturedAt) ||
      haversineKm(runner, args) > 0.1) return false;
    const city = cleanAddressPart(args.city); const street = cleanAddressPart(args.street);
    if (!addressText(city, street)) return false;
    await ctx.db.patch('errandRunners', runner._id, { address: { ...args, city, street } });
    return true;
  },
});

// A GPS freshness lease, not room/session presence. One scheduled check per
// runner materializes expiry so Convex subscriptions update without polling.
export const expireLocation = internalMutation({
  args: { id: v.id('errandRunners') }, returns: v.null(),
  handler: async (ctx, { id }) => {
    const runner = await ctx.db.get('errandRunners', id);
    if (!runner) return null;
    const remaining = runner.updatedAt + LOCATION_TTL_MS - Date.now();
    if (runner.status !== 'offline' && remaining > 0) {
      await ctx.scheduler.runAfter(remaining, internal.runners.expireLocation, { id });
    } else {
      await ctx.db.patch('errandRunners', id, { status: 'offline', expiryScheduled: false });
    }
    return null;
  },
});

export const setOffline = mutation({
  args: { sessionId: v.optional(v.string()) }, returns: v.null(),
  handler: async (ctx, { sessionId }) => {
    const user = await authenticatedUser(ctx);
    const access = await ctx.db.query('runnerAccess').withIndex('by_userId', q => q.eq('userId', user._id)).unique();
    if (sessionId && access?.locationSessionId !== sessionId) return null;
    if (access) await ctx.db.patch('runnerAccess', access._id, { locationSessionId: undefined });
    const runner = await ctx.db.query('errandRunners').withIndex('by_runnerId', q => q.eq('runnerId', user._id)).unique();
    if (runner) await ctx.db.patch('errandRunners', runner._id, { status: 'offline', capturedAt: Date.now() });
    return null;
  },
});

export const startAvailability = mutation({
  args: { sessionId: v.string() }, returns: v.null(),
  handler: async (ctx, { sessionId }) => {
    const user = await authenticatedUser(ctx);
    const access = await ctx.db.query('runnerAccess').withIndex('by_userId', q => q.eq('userId', user._id)).unique();
    if (user.role === 'buyer' || !access?.enabled) throw new ConvexError('Runner publishing access is required.');
    if (!/^[a-zA-Z0-9-]{10,100}$/.test(sessionId)) throw new ConvexError('Invalid location session.');
    const obligation = await ctx.db.query('trackingObligations').withIndex('by_runnerId_and_endedAt', q => q.eq('runnerId', user._id).eq('endedAt', undefined)).first();
    if (obligation) throw new ConvexError('Use private location sharing for your active errand.');
    await ctx.db.patch('runnerAccess', access._id, { locationSessionId: sessionId });
    const previous = await ctx.db.query('errandRunners').withIndex('by_runnerId', q => q.eq('runnerId', user._id)).unique();
    if (previous) await ctx.db.patch('errandRunners', previous._id, { status: 'offline', address: undefined, locationSessionId: sessionId });
    return null;
  },
});

export const availabilitySession = query({
  args: {}, returns: v.union(v.string(), v.null()),
  handler: async ctx => {
    const user = await authenticatedUser(ctx);
    const access = await ctx.db.query('runnerAccess').withIndex('by_userId', q => q.eq('userId', user._id)).unique();
    return access?.enabled ? access.locationSessionId ?? null : null;
  },
});

export const getNearbyRunners = query({
  args: { riderLat: v.number(), riderLng: v.number() }, returns: v.array(publicRunner),
  handler: async (ctx, { riderLat, riderLng }) => {
    await authenticatedUser(ctx);
    validateCoordinates(riderLat, riderLng);
    const cells = gridDisk(latLngToCell(riderLat, riderLng, H3_RESOLUTION), 1);
    const groups = await Promise.all(cells.map(cell =>
      ctx.db.query('errandRunners')
        .withIndex('by_h3Index_and_status', q => q.eq('h3Index', cell).eq('status', 'online'))
        // All online runners in these seven cells, as required by discovery.
        .collect(),
    ));
    const ranked = await Promise.all(groups.flat().map(async runner => {
      const { runnerId, name, status, lat, lng, h3Index, updatedAt } = runner;
      const userId = ctx.db.normalizeId('users', runnerId);
      if (!userId) return null;
      return { runnerId, name, status, lat, lng, h3Index, updatedAt, locationLabel: currentAddressLabel(runner), trust: await runnerTrust(ctx, userId) };
    }));
    return ranked.filter((runner): runner is NonNullable<typeof runner> => runner !== null)
      .sort((a, b) => compareRunnerTrust(a.trust, b.trust) || a.runnerId.localeCompare(b.runnerId));
  },
});
