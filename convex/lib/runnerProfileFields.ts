import { v } from 'convex/values';
import { categoryValidator } from './errandFields';

export const runnerProfileFields = {
  phone: v.string(), area: v.string(),
  bio: v.optional(v.string()),
  transport: v.union(v.literal('walking'), v.literal('bicycle'), v.literal('motorbike'), v.literal('car')),
  services: v.array(categoryValidator),
};
