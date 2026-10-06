import { v } from 'convex/values';
export const sharePoint = v.object({ lat: v.number(), lng: v.number() });
export const shareStop = v.object({ errandId: v.id('errands'), kind: v.union(v.literal('pickup'), v.literal('dropoff')), point: sharePoint });
