import { v } from 'convex/values';
export const trustSummary = v.object({
  version: v.string(), score: v.number(), history: v.union(v.literal('new'), v.literal('limited'), v.literal('established')),
  completedJobs: v.number(), distinctBuyers: v.number(), ratingCount: v.number(), averageRating: v.union(v.number(), v.null()),
  responseCount: v.number(), repliedCount: v.number(), averageReplyMinutes: v.union(v.number(), v.null()),
  completionScore: v.number(), ratingScore: v.number(), responseScore: v.number(), asOf: v.number(), limitedToRecent: v.boolean(),
});
