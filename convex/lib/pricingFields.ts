import { v } from 'convex/values';
import { categoryValidator } from './errandFields';

export const rateValidator = v.object({ category: categoryValidator, startingFeePesewas: v.number() });
export const agreedPricingValidator = v.object({ quoteId: v.id('runnerQuotes'), serviceFeePesewas: v.number(), agreedAt: v.number() });
export const directPaymentValidator = v.object({ sentAt: v.number(), method: v.string(), receivedAt: v.optional(v.number()) });
