import type { TestConvex, TestConvexForDataModel } from 'convex-test';
import { api } from '../../convex/_generated/api';
import type { DataModel, Id } from '../../convex/_generated/dataModel';
import type schema from '../../convex/schema';

// Exercise the real quote and owner approval flow in existing job lifecycle tests.
export async function approveJob(t: TestConvex<typeof schema>, runner: TestConvexForDataModel<DataModel>, args: { id: Id<'errands'>; expectedRevision: number }) {
  const errand = await t.run(ctx => ctx.db.get('errands', args.id));
  const buyer = t.withIdentity({ subject: `${errand!.customerId}|session` });
  const old = await runner.query(api.pricing.myQuote, { id: args.id });
  if (old?.status === 'accepted') return buyer.mutation(api.pricing.approveQuote, { quoteId: old._id, expectedVersion: old.version, expectedRevision: args.expectedRevision });
  const quoteId = await runner.mutation(api.pricing.submitQuote, { ...args, expectedVersion: old?.version ?? 0, serviceFeePesewas: 2000, note: '' });
  const quote = await runner.query(api.pricing.myQuote, { id: args.id });
  return buyer.mutation(api.pricing.approveQuote, { quoteId, expectedVersion: quote!.version, expectedRevision: args.expectedRevision });
}
