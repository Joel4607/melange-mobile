import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { runnerTrust } from "./lib/runnerTrust";
import { TRUST_HISTORY_LIMIT } from "./lib/trustScore";

function ensureTestingEnabled() {
  if (process.env.MELANGE_TEST_FIXTURES !== "true") {
    throw new Error(
      "Trust evaluation fixtures are disabled. Set MELANGE_TEST_FIXTURES=true."
    );
  }
}

/**
 * T11
 * Creates a requested number of eligible completed errands.
 */
export const seedT11 = mutation({
  args: {
    runnerId: v.id("users"),
    buyerA: v.id("users"),
    count: v.number(),
  },

  handler: async (ctx, { runnerId, buyerA, count }) => {
    ensureTestingEnabled();

    if (!Number.isSafeInteger(count) || count < 1 || count > 101) {
      throw new Error("count must be an integer from 1 to 101.");
    }

    const runId = Date.now().toString();
    const now = Date.now();

    const ids: Id<"errands">[] = [];

    for (let i = 0; i < count; i++) {
      const confirmedAt = now - (count - i) * 60_000;

      const id = await ctx.db.insert("errands", {
        title: `T11 Trust Test ${i + 1}`,
        description: "Synthetic thesis trust-history fixture.",
        pickup: "Test Pickup",
        dropoff: "Test Dropoff",
        category: "other",
        urgency: "normal",
        budgetPesewas: 1000,

        requestId: `thesis-t11-${runId}-${i}`,
        customerId: buyerA,

        status: "delivered",
        runnerId,

        deliveredAt: confirmedAt,

        completion: {
          confirmedAt,
          runnerId,
          isDemo: false,
        },

        revision: 1,
        updatedAt: confirmedAt,
      });

      ids.push(id);
    }

    return {
      runId,
      created: ids.length,
      firstId: ids[0],
      lastId: ids[ids.length - 1],
    };
  },
});

/**
 * Inspect T11 using the actual runnerTrust backend logic.
 */
export const inspectT11 = query({
  args: {
    runnerId: v.id("users"),
  },

  handler: async (ctx, { runnerId }) => {
    const rows = await ctx.db
      .query("errands")
      .withIndex("by_runnerId_and_completion_confirmedAt", (q) =>
        q.eq("runnerId", runnerId).gte("completion.confirmedAt", 0)
      )
      .order("desc")
      .filter((q) =>
        q.and(
          q.eq(q.field("status"), "delivered"),
          q.eq(q.field("trackingMode"), undefined),
          q.eq(q.field("completion.isDemo"), false),
          q.eq(q.field("completion.runnerId"), runnerId),
          q.neq(q.field("customerId"), runnerId)
        )
      )
      .take(TRUST_HISTORY_LIMIT + 1);

    const trust = await runnerTrust(ctx, runnerId);

    return {
      eligibleRowsFetched: rows.length,
      historyLimit: TRUST_HISTORY_LIMIT,

      newestRequestId: rows[0]?.requestId ?? null,

      hundredthRequestId:
        rows[TRUST_HISTORY_LIMIT - 1]?.requestId ?? null,

      extraRecordRequestId:
        rows[TRUST_HISTORY_LIMIT]?.requestId ?? null,

      trust,
    };
  },
});

/**
 * T12
 * Creates eligible and deliberately ineligible evidence.
 */
export const seedT12 = mutation({
  args: {
    runnerId: v.id("users"),
    buyerA: v.id("users"),
    buyerB: v.id("users"),
  },

  handler: async (ctx, { runnerId, buyerA, buyerB }) => {
    ensureTestingEnabled();

    const runId = Date.now().toString();
    const now = Date.now();

    const makeEligible = async (
      suffix: string,
      buyerId: Id<"users">,
      offset: number
    ) => {
      const confirmedAt = now - offset * 60_000;

      return await ctx.db.insert("errands", {
        title: `T12 Eligible ${suffix}`,
        description: "Synthetic thesis eligibility fixture.",
        pickup: "Test Pickup",
        dropoff: "Test Dropoff",
        category: "other",
        urgency: "normal",
        budgetPesewas: 1000,

        requestId: `thesis-t12-${runId}-eligible-${suffix}`,
        customerId: buyerId,

        status: "delivered",
        runnerId,

        deliveredAt: confirmedAt,

        completion: {
          confirmedAt,
          runnerId,
          isDemo: false,
        },

        revision: 1,
        updatedAt: confirmedAt,
      });
    };

    // --------------------
    // Eligible jobs
    // --------------------

    const validReviewJob = await makeEligible(
      "valid-review",
      buyerA,
      1
    );

    const demoReviewJob = await makeEligible(
      "demo-review",
      buyerA,
      2
    );

    const wrongBuyerReviewJob = await makeEligible(
      "wrong-buyer",
      buyerA,
      3
    );

    const wrongRunnerReviewJob = await makeEligible(
      "wrong-runner",
      buyerB,
      4
    );

    // Valid review
    await ctx.db.insert("reviews", {
      errandId: validReviewJob,
      customerId: buyerA,
      runnerId,
      isDemo: false,
      rating: 5,
      comment: "T12 valid review",
    });

    // Demo review — should be excluded
    await ctx.db.insert("reviews", {
      errandId: demoReviewJob,
      customerId: buyerA,
      runnerId,
      isDemo: true,
      rating: 5,
      comment: "T12 demo review",
    });

    // Wrong buyer — should be excluded
    await ctx.db.insert("reviews", {
      errandId: wrongBuyerReviewJob,
      customerId: buyerB,
      runnerId,
      isDemo: false,
      rating: 5,
      comment: "T12 wrong buyer review",
    });

    // Wrong runner — should be excluded
    await ctx.db.insert("reviews", {
      errandId: wrongRunnerReviewJob,
      customerId: buyerB,
      runnerId: buyerA,
      isDemo: false,
      rating: 5,
      comment: "T12 wrong runner review",
    });

    // --------------------
    // Ineligible errands
    // --------------------

    // Demo completion
    await ctx.db.insert("errands", {
      title: "T12 Demo",
      description: "Synthetic thesis exclusion fixture.",
      pickup: "Test Pickup",
      dropoff: "Test Dropoff",
      category: "other",
      urgency: "normal",
      budgetPesewas: 1000,

      requestId: `thesis-t12-${runId}-demo`,
      customerId: buyerA,

      status: "delivered",
      trackingMode: "demo",
      deliveredAt: now,

      completion: {
        confirmedAt: now,
        isDemo: true,
      },

      revision: 1,
      updatedAt: now,
    });

    // Self-owned job
    await ctx.db.insert("errands", {
      title: "T12 Self Owned",
      description: "Synthetic thesis exclusion fixture.",
      pickup: "Test Pickup",
      dropoff: "Test Dropoff",
      category: "other",
      urgency: "normal",
      budgetPesewas: 1000,

      requestId: `thesis-t12-${runId}-self`,
      customerId: runnerId,

      status: "delivered",
      runnerId,

      deliveredAt: now,

      completion: {
        confirmedAt: now,
        runnerId,
        isDemo: false,
      },

      revision: 1,
      updatedAt: now,
    });

    // Unconfirmed delivery
    await ctx.db.insert("errands", {
      title: "T12 Unconfirmed",
      description: "Synthetic thesis exclusion fixture.",
      pickup: "Test Pickup",
      dropoff: "Test Dropoff",
      category: "other",
      urgency: "normal",
      budgetPesewas: 1000,

      requestId: `thesis-t12-${runId}-unconfirmed`,
      customerId: buyerA,

      status: "delivered",
      runnerId,
      deliveredAt: now,

      revision: 1,
      updatedAt: now,
    });

    // Completion runner mismatch
    await ctx.db.insert("errands", {
      title: "T12 Runner Mismatch",
      description: "Synthetic thesis exclusion fixture.",
      pickup: "Test Pickup",
      dropoff: "Test Dropoff",
      category: "other",
      urgency: "normal",
      budgetPesewas: 1000,

      requestId: `thesis-t12-${runId}-mismatch`,
      customerId: buyerA,

      status: "delivered",
      runnerId,

      deliveredAt: now,

      completion: {
        confirmedAt: now,
        runnerId: buyerB,
        isDemo: false,
      },

      revision: 1,
      updatedAt: now,
    });

    // Wrong status
    await ctx.db.insert("errands", {
      title: "T12 Wrong Status",
      description: "Synthetic thesis exclusion fixture.",
      pickup: "Test Pickup",
      dropoff: "Test Dropoff",
      category: "other",
      urgency: "normal",
      budgetPesewas: 1000,

      requestId: `thesis-t12-${runId}-status`,
      customerId: buyerA,

      status: "picked_up",
      runnerId,

      completion: {
        confirmedAt: now,
        runnerId,
        isDemo: false,
      },

      revision: 1,
      updatedAt: now,
    });

    return {
      runId,
      expectedEligibleJobs: 4,
      expectedValidRatings: 1,
    };
  },
});

/**
 * Inspect T12 using the production runnerTrust logic.
 */
export const inspectT12 = query({
  args: {
    runnerId: v.id("users"),
  },

  handler: async (ctx, { runnerId }) => {
    const trust = await runnerTrust(ctx, runnerId);

    return {
      completedJobs: trust.completedJobs,
      ratingCount: trust.ratingCount,
      distinctBuyers: trust.distinctBuyers,
      score: trust.score,
      history: trust.history,
      limitedToRecent: trust.limitedToRecent,
    };
  },
});

export const cleanup = mutation({
  args: {},

  handler: async (ctx) => {
    ensureTestingEnabled();

    const errands = await ctx.db.query("errands").collect();

    const fixtures = errands.filter(
      (e) =>
        e.requestId.startsWith("thesis-t11-") ||
        e.requestId.startsWith("thesis-t12-") ||
        e.requestId.startsWith("thesis-t13-")
    );

    let reviewCount = 0;
    let messageCount = 0;
    let activityCount = 0;
    let pushJobCount = 0;

    for (const errand of fixtures) {
      // Delete reviews linked to the fixture errand.
      const reviews = await ctx.db
        .query("reviews")
        .withIndex("by_errandId", (q) =>
          q.eq("errandId", errand._id)
        )
        .collect();

      for (const review of reviews) {
        await ctx.db.delete(review._id);
        reviewCount++;
      }

      // Delete messages linked to the fixture errand.
      const messages = await ctx.db.query("messages").collect();

      for (const message of messages) {
        if (message.errandId === errand._id) {
          await ctx.db.delete(message._id);
          messageCount++;
        }
      }

      // Delete errand activity records.
      const activities = await ctx.db
        .query("errandActivity")
        .withIndex("by_errandId", (q) =>
          q.eq("errandId", errand._id)
        )
        .collect();

      for (const activity of activities) {
        await ctx.db.delete(activity._id);
        activityCount++;
      }

      // Delete any queued push jobs created by the fixture.
      const pushJobs = await ctx.db.query("pushJobs").collect();

      for (const job of pushJobs) {
        if (job.errandId === errand._id) {
          await ctx.db.delete(job._id);
          pushJobCount++;
        }
      }

      // Finally delete the fixture errand itself.
      await ctx.db.delete(errand._id);
    }

    return {
      deletedErrands: fixtures.length,
      deletedReviews: reviewCount,
      deletedMessages: messageCount,
      deletedActivities: activityCount,
      deletedPushJobs: pushJobCount,
    };
  },
});
/**
 * T13-A
 * Creates one delivered errand ready for buyer confirmation.
 */
export const seedT13Completion = mutation({
  args: {
    runnerId: v.id("users"),
    buyerA: v.id("users"),
  },

  handler: async (ctx, { runnerId, buyerA }) => {
    ensureTestingEnabled();

    const runId = Date.now().toString();
    const now = Date.now();

    const errandId = await ctx.db.insert("errands", {
      title: "T13 Completion Retry Test",
      description: "Synthetic thesis duplicate-confirmation fixture.",
      pickup: "Test Pickup",
      dropoff: "Test Dropoff",
      category: "other",
      urgency: "normal",
      budgetPesewas: 1000,

      requestId: `thesis-t13-completion-${runId}`,
      customerId: buyerA,

      status: "delivered",
      runnerId,

      acceptedAt: now - 30 * 60_000,
      pickedUpAt: now - 20 * 60_000,
      deliveredAt: now - 10 * 60_000,

      revision: 1,
      updatedAt: now,
    });

    return {
      errandId,
      expectedRevision: 1,
      runId,
    };
  },
});

/**
 * Inspect completion and completed-activity count for T13-A.
 */
export const inspectT13Completion = query({
  args: {
    errandId: v.id("errands"),
  },

  handler: async (ctx, { errandId }) => {
    const errand = await ctx.db.get("errands", errandId);

    const activity = await ctx.db
      .query("errandActivity")
      .withIndex("by_errandId", q => q.eq("errandId", errandId))
      .collect();

    return {
      exists: !!errand,
      status: errand?.status ?? null,
      revision: errand?.revision ?? null,
      completion: errand?.completion ?? null,
      completedActivityCount: activity.filter(
        row => row.kind === "completed"
      ).length,
    };
  },
});

/**
 * T13-B
 * Creates one active assigned errand ready for real chat testing.
 */
export const seedT13Messaging = mutation({
  args: {
    runnerId: v.id("users"),
    buyerA: v.id("users"),
  },

  handler: async (ctx, { runnerId, buyerA }) => {
    ensureTestingEnabled();

    const runId = Date.now().toString();
    const now = Date.now();

    const errandId = await ctx.db.insert("errands", {
      title: "T13 Messaging Retry Test",
      description: "Synthetic thesis first-response fixture.",
      pickup: "Test Pickup",
      dropoff: "Test Dropoff",
      category: "other",
      urgency: "normal",
      budgetPesewas: 1000,

      requestId: `thesis-t13-message-${runId}`,
      customerId: buyerA,

      status: "accepted",
      runnerId,

      acceptedAt: now,
      trustResponse: {
        runnerId,
      },

      revision: 1,
      updatedAt: now,
    });

    return {
      errandId,
      channel: String(runnerId),
      runId,
    };
  },
});

/**
 * Inspect message count and first-response timestamps.
 */
export const inspectT13Messaging = query({
  args: {
    errandId: v.id("errands"),
  },

  handler: async (ctx, { errandId }) => {
    const errand = await ctx.db.get("errands", errandId);

    if (!errand) {
      return {
        exists: false,
        status: null,
        messageCount: 0,
        trustResponse: null,
        clientIds: [],
      };
    }

    const channel = errand.runnerId
      ? String(errand.runnerId)
      : "none";

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_errand_and_channel", q =>
        q.eq("errandId", errandId).eq("channel", channel)
      )
      .collect();

    return {
      exists: true,
      status: errand.status,
      revision: errand.revision ?? null,
      channel,
      messageCount: messages.length,
      trustResponse: errand.trustResponse ?? null,
      clientIds: messages.map(m => m.clientId).sort(),
    };
  },
});