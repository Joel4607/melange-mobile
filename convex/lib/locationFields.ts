import { v } from 'convex/values';

export const locationPoint = v.object({ latitude: v.number(), longitude: v.number(), accuracy: v.optional(v.number()), capturedAt: v.number() });
