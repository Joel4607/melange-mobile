import { authTables } from '@convex-dev/auth/server';
import { defineSchema, defineTable } from 'convex/server';
import { v } from 'convex/values';
import { errandFields } from './lib/errandFields';
import { locationPoint } from './lib/locationFields';
import { runnerProfileFields } from './lib/runnerProfileFields';
import { rateValidator, agreedPricingValidator, directPaymentValidator } from './lib/pricingFields';
import { pushKind, trackingPushFields } from './lib/pushFields';
import { sharePoint, shareStop } from './lib/shareFields';
import { trackingFields } from './lib/trackingFields';

export default defineSchema({
  ...authTables,
  pickupApprovals: defineTable({
    errandId: v.id('errands'), runnerId: v.id('users'), obligationId: v.id('trackingObligations'),
    requestVersion: v.number(), requestedAt: v.number(), approvedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()), consumedAt: v.optional(v.number()),
    state: v.union(v.literal('requested'), v.literal('approved'), v.literal('expired'), v.literal('consumed')),
  }).index('by_errandId', ['errandId']),
  trackingObligations: defineTable(trackingFields).index('by_runnerId_and_endedAt', ['runnerId', 'endedAt']),
  shareGroups: defineTable({
    errandIds: v.array(v.id('errands')), route: v.array(shareStop),
    savedKm: v.number(), soloKm: v.number(), sharedKm: v.number(),
    deadlineAt: v.union(v.number(), v.null()), expiresAt: v.number(),
    status: v.union(v.literal('open'), v.literal('reserved'), v.literal('active'), v.literal('delivered'), v.literal('dissolved')),
    runnerId: v.optional(v.id('users')), offerId: v.optional(v.id('shareOffers')),
    approvedIds: v.array(v.id('errands')), nextStop: v.number(), reason: v.optional(v.string()),
  }).index('by_status', ['status']).index('by_runnerId_and_status', ['runnerId', 'status']),
  shareOffers: defineTable({
    groupId: v.id('shareGroups'), runnerId: v.id('users'), fees: v.array(v.number()), note: v.string(), version: v.number(),
  }).index('by_groupId', ['groupId']).index('by_groupId_and_runnerId', ['groupId', 'runnerId']),
  trustClock: defineTable({ key: v.literal('daily'), at: v.number() }).index('by_key', ['key']),
  pushDevices: defineTable({
    userId: v.id('users'), installationId: v.string(), token: v.string(), platform: v.union(v.literal('android'), v.literal('ios')),
    messages: v.boolean(), updates: v.boolean(), updatedAt: v.number(),
  }).index('by_userId', ['userId']).index('by_installationId', ['installationId']).index('by_token', ['token']),
  pushJobs: defineTable({
    ...trackingPushFields,
    userId: v.id('users'), deviceId: v.id('pushDevices'), eventKey: v.string(), errandId: v.id('errands'), kind: pushKind,
    state: v.union(v.literal('pending'), v.literal('sending'), v.literal('ticket'), v.literal('delivered'), v.literal('failed'), v.literal('skipped')),
    attempts: v.number(), leaseUntil: v.optional(v.number()), ticketId: v.optional(v.string()), receiptChecks: v.optional(v.number()), errorCode: v.optional(v.string()),
  }).index('by_deviceId_and_eventKey', ['deviceId', 'eventKey']),
  users: defineTable({
    ...authTables.users.validator.fields,
    role: v.optional(v.union(v.literal('buyer'), v.literal('runner'))),
  }).index('email', ['email']).index('phone', ['phone']),
  reviews: defineTable({
    errandId: v.id('errands'), customerId: v.id('users'),
    runnerId: v.optional(v.id('users')), isDemo: v.boolean(),
    rating: v.number(), comment: v.string(),
  }).index('by_errandId', ['errandId'])
    .index('by_runnerId', ['runnerId']),
  messages: defineTable({
    errandId: v.id('errands'), channel: v.string(),
    senderId: v.optional(v.id('users')), demoReply: v.boolean(),
    clientId: v.string(), text: v.string(),
    image: v.optional(v.object({ storageId: v.id('_storage'), mimeType: v.string(), size: v.number() })),
  }).index('by_errand_and_channel', ['errandId', 'channel'])
    .index('by_errand_channel_clientId', ['errandId', 'channel', 'clientId']),
  runnerProfiles: defineTable({
    userId: v.id('users'), ...runnerProfileFields, updatedAt: v.number(),
    photo: v.optional(v.object({ storageId: v.id('_storage'), requestId: v.string() })),
  }).index('by_userId', ['userId']),
  runnerPricing: defineTable({ runnerId: v.id('users'), rates: v.array(rateValidator), updatedAt: v.number() }).index('by_runnerId', ['runnerId']),
  runnerQuotes: defineTable({
    errandId: v.id('errands'), runnerId: v.id('users'), serviceFeePesewas: v.number(),
    startingFeePesewas: v.optional(v.number()), note: v.string(), errandRevision: v.number(), version: v.number(), updatedAt: v.number(),
    status: v.union(v.literal('pending'), v.literal('withdrawn'), v.literal('declined'), v.literal('accepted')),
  }).index('by_errandId', ['errandId']).index('by_errandId_and_runnerId', ['errandId', 'runnerId']).index('by_runnerId', ['runnerId']),
  // Prototype runner registration enables the signed-in account directly.
  runnerAccess: defineTable({ userId: v.id('users'), enabled: v.boolean(), locationSessionId: v.optional(v.string()) })
    .index('by_userId', ['userId']),
  errandRunners: defineTable({
    runnerId: v.string(), name: v.string(),
    status: v.union(v.literal('online'), v.literal('offline'), v.literal('busy')),
    lat: v.number(), lng: v.number(), h3Index: v.string(), updatedAt: v.number(),
    capturedAt: v.number(), expiryScheduled: v.boolean(),
    locationSessionId: v.optional(v.string()),
    address: v.optional(v.object({ city: v.string(), street: v.string(), lat: v.number(), lng: v.number(), capturedAt: v.number(), sessionId: v.string() })),
  }).index('by_runnerId', ['runnerId'])
    .index('by_h3Index', ['h3Index'])
    .index('by_h3Index_and_status', ['h3Index', 'status']),
  runnerLocations: defineTable({
    errandId: v.id('errands'), publisherId: v.id('users'),
    source: v.union(v.literal('runner_gps'), v.literal('demo_route')),
    point: v.optional(locationPoint), receivedAt: v.number(), sharing: v.boolean(),
    sessionId: v.optional(v.string()), expiryScheduled: v.optional(v.boolean()),
  }).index('by_errandId', ['errandId']).index('by_publisherId', ['publisherId']),
  buyerLocations: defineTable({
    errandId: v.id('errands'), buyerId: v.id('users'), runnerId: v.id('users'),
    sessionId: v.optional(v.string()), point: v.optional(locationPoint),
    receivedAt: v.number(), sharing: v.boolean(), expiryScheduled: v.boolean(),
  }).index('by_errandId', ['errandId']),
  buyerLocationShares: defineTable({
    errandId: v.id('errands'), buyerId: v.id('users'), runnerId: v.id('users'),
    sessionId: v.optional(v.string()), point: v.optional(locationPoint),
    startedAt: v.number(), receivedAt: v.number(), sharing: v.boolean(),
  }).index('by_errandId', ['errandId']),
  deliveryProofs: defineTable({
    errandId: v.id('errands'), runnerId: v.id('users'), storageId: v.id('_storage'),
    mimeType: v.string(), size: v.number(), requestId: v.string(),
  }).index('by_errandId', ['errandId']),
  customerPreferences: defineTable({
    customerId: v.id('users'),
    deliveryAddress: v.string(),
  }).index('by_customerId', ['customerId']),
  errands: defineTable({
    ...errandFields,
    sharePickup: v.optional(sharePoint), shareDropoff: v.optional(sharePoint),
    shareState: v.optional(v.union(v.literal('waiting'), v.literal('paired'), v.literal('released'))),
    shareWindowEndsAt: v.optional(v.number()), shareGroupId: v.optional(v.id('shareGroups')),
    customerId: v.id('users'),
    requestId: v.string(),
    status: v.union(v.literal('posted'), v.literal('accepted'), v.literal('picked_up'), v.literal('delivered'), v.literal('cancelled')),
    trackingMode: v.optional(v.literal('demo')),
    trackingObligationId: v.optional(v.id('trackingObligations')),
    acceptedAt: v.optional(v.number()),
    pickedUpAt: v.optional(v.number()),
    deliveredAt: v.optional(v.number()),
    completion: v.optional(v.object({ confirmedAt: v.number(), runnerId: v.optional(v.id('users')), isDemo: v.boolean() })),
    reviewedAt: v.optional(v.number()),
    reviewRating: v.optional(v.number()),
    runnerId: v.optional(v.id('users')),
    agreedPricing: v.optional(agreedPricingValidator),
    trustResponse: v.optional(v.object({ runnerId: v.id('users'), buyerMessageAt: v.optional(v.number()), runnerReplyAt: v.optional(v.number()) })),
    directPayment: v.optional(directPaymentValidator),
    revision: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    cancellationReason: v.optional(v.string()),
  }).index('by_shareState', ['shareState']).index('by_customerId', ['customerId'])
    .index('by_status', ['status'])
    .index('by_status_and_category', ['status', 'category'])
    .index('by_runnerId_and_status', ['runnerId', 'status'])
    .index('by_runnerId_and_completion_confirmedAt', ['runnerId', 'completion.confirmedAt'])
    .index('by_runnerId_updatedAt', ['runnerId', 'updatedAt'])
    .index('by_runnerId_status_updatedAt', ['runnerId', 'status', 'updatedAt'])
    .index('by_runnerId_status_deliveredAt', ['runnerId', 'status', 'deliveredAt'])
    .index('by_customerId_and_requestId', ['customerId', 'requestId']),
  errandActivity: defineTable({
    errandId: v.id('errands'),
    kind: v.union(v.literal('edited'), v.literal('cancelled'), v.literal('accepted'), v.literal('picked_up'), v.literal('delivered'), v.literal('completed'), v.literal('reviewed')),
    isDemo: v.optional(v.boolean()),
    summary: v.string(),
  }).index('by_errandId', ['errandId']),
});
