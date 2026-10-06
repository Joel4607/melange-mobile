import { v } from 'convex/values';
export const pushKind = v.union(v.literal('share'), v.literal('message'), v.literal('quote'), v.literal('quote_decision'), v.literal('assigned'), v.literal('picked_up'), v.literal('delivered'), v.literal('completed'), v.literal('review'), v.literal('payment_sent'), v.literal('payment_received'), v.literal('pickup_request'), v.literal('tracking_interrupted'), v.literal('tracking_attention'), v.literal('tracking_recovered'));
export const trackingPushFields = {
  trackingObligationId: v.optional(v.id('trackingObligations')),
  trackingIncidentAt: v.optional(v.number()), pickupRequestVersion: v.optional(v.number()),
};
export const pushCopy = {
  pickup_request: ['Collection approval requested', 'Your runner requested permission to collect. Review the request in Melange.'],
  tracking_interrupted: ['Location updates interrupted', 'Location updates are delayed. Open Melange to check tracking or restore location.'],
  tracking_attention: ['Tracking needs attention', 'Fresh location is needed before confirming progress. Open Melange for details.'],
  tracking_recovered: ['Location updates recovered', 'Fresh location updates have resumed. Open Melange to check your errand.'],
  share: ['Shared route update', 'There is an update to your shared errand. Open Melange for details.'],
  message: ['New message', 'You have a new errand message. Open Melange to read it.'],
  quote: ['Runner quote updated', 'A runner sent or updated a service-fee quote. Review it in Melange.'],
  quote_decision: ['Quote update', 'There is an update to an errand quote. Open Melange for details.'],
  assigned: ['Quote approved', 'The buyer approved your fee. Open your assigned errand to get started.'],
  picked_up: ['Pickup confirmed', 'Your runner confirmed pickup. Open Melange to follow the delivery.'],
  delivered: ['Delivery reported', 'Review the handover photo and confirm receipt in Melange.'],
  completed: ['Errand completed', 'The buyer confirmed completion of your errand.'],
  review: ['New buyer review', 'A buyer left feedback on your completed errand.'],
  payment_sent: ['Buyer reports payment sent', 'Check your payment account before confirming receipt in Melange.'],
  payment_received: ['Runner confirmed receipt', 'Your runner reported receiving the service fee. This is not provider verification.'],
} as const;
