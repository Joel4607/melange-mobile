import { v } from 'convex/values';

export const categoryValidator = v.union(v.literal('groceries'), v.literal('food'), v.literal('pharmacy'), v.literal('delivery'), v.literal('market'), v.literal('other'));
export const errandFields = {
  title: v.string(), description: v.string(), category: categoryValidator,
  pickup: v.string(), dropoff: v.string(), budgetPesewas: v.number(),
  budgetPurpose: v.optional(v.literal('items')),
  urgency: v.union(v.literal('low'), v.literal('normal'), v.literal('express')),
};
