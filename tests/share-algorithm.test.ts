import { describe, expect, it } from "vitest";
import {
  DEFAULT_ERRAND_SHARE_CONFIG,
  evaluateSharePair,
  rankSharePartners,
  shareWindowEndsAt,
  todayDeadlineAt,
  type ErrandShareConfig,
  type ShareTask,
} from "../convex/lib/shareAlgorithm";

const NOW = Date.UTC(2026, 7, 16, 12, 0, 0);
const EARTH_RADIUS_KM = 6371;

function kmNorth(km: number): number {
  return (km / EARTH_RADIUS_KM) * (180 / Math.PI);
}

function point(northKm: number, eastKm: number) {
  const lat = 5.56 + kmNorth(northKm);
  const lng = -0.2 + kmNorth(eastKm) / Math.cos((5.56 * Math.PI) / 180);
  return { lat, lng };
}

function task(overrides: Partial<ShareTask> = {}): ShareTask {
  return {
    id: "task-a",
    buyerId: "buyer-a",
    urgency: "normal",
    pickup: point(0, 0),
    dropoff: point(0, 2),
    category: "Pickup & Delivery",
    createdAt: NOW,
    windowEndsAt: NOW + 10 * 60_000,
    deadlineAt: Date.UTC(2026, 7, 16, 23, 59, 59, 999),
    status: "posted",
    selectedRunnerId: null,
    shareState: "waiting",
    manualRunner: false,
    stopCount: 0,
    ...overrides,
  };
}

function parallelPartner(overrides: Partial<ShareTask> = {}): ShareTask {
  return task({
    id: "task-b",
    buyerId: "buyer-b",
    urgency: "low",
    pickup: point(0.1, 0),
    dropoff: point(0.1, 2),
    windowEndsAt: NOW + 30 * 60_000,
    deadlineAt: null,
    ...overrides,
  });
}

function config(overrides: Partial<ErrandShareConfig>): ErrandShareConfig {
  return { ...DEFAULT_ERRAND_SHARE_CONFIG, ...overrides } as ErrandShareConfig;
}

describe("Errand-Share pairing", () => {
  it("uses the approved Today/Whenever windows and excludes Express", () => {
    expect(shareWindowEndsAt(NOW, "normal")).toBe(NOW + 10 * 60_000);
    expect(shareWindowEndsAt(NOW, "low")).toBe(NOW + 30 * 60_000);
    expect(shareWindowEndsAt(NOW, "express")).toBeNull();
    expect(todayDeadlineAt(NOW)).toBe(Date.UTC(2026, 7, 16, 23, 59, 59, 999));
  });

  it("enumerates only routes where each pickup precedes its dropoff", () => {
    const decision = evaluateSharePair(task(), parallelPartner(), NOW);

    expect(decision.accepted).toBe(true);
    if (!decision.accepted) return;
    for (const taskId of decision.taskIds) {
      const pickupIndex = decision.route.findIndex(
        (stop) => stop.taskId === taskId && stop.kind === "pickup",
      );
      const dropoffIndex = decision.route.findIndex(
        (stop) => stop.taskId === taskId && stop.kind === "dropoff",
      );
      expect(pickupIndex).toBeGreaterThanOrEqual(0);
      expect(dropoffIndex).toBeGreaterThan(pickupIndex);
    }
  });

  it("accepts a feasible Today and Whenever pair under the Today deadline", () => {
    const a = task();
    const decision = evaluateSharePair(a, parallelPartner(), NOW);

    expect(decision.accepted).toBe(true);
    if (!decision.accepted) return;
    expect(decision.stricterDeadlineAt).toBe(a.deadlineAt);
    expect(decision.metrics.savedDistanceKm).toBeGreaterThan(1.7);
    expect(decision.metrics.taskMetrics[a.id].predictedCompletionAt).toBeLessThan(
      a.deadlineAt as number,
    );
  });

  it.each([
    ["ineligible_urgency", { urgency: "express" as const }],
    ["manual_runner", { manualRunner: true }],
    ["not_waiting", { shareState: "released" as const }],
    ["not_waiting", { status: "matched" as const }],
    ["not_waiting", { selectedRunnerId: "runner-a" }],
    ["custom_stops", { stopCount: 1 }],
    ["window_expired", { windowEndsAt: NOW - 1 }],
  ])("rejects %s tasks", (reason, overrides) => {
    const decision = evaluateSharePair(task(overrides), parallelPartner(), NOW);
    expect(decision).toMatchObject({ accepted: false, reason });
  });

  it("rejects errands from the same buyer", () => {
    const decision = evaluateSharePair(
      task(),
      parallelPartner({ buyerId: "buyer-a" }),
      NOW,
    );
    expect(decision).toMatchObject({ accepted: false, reason: "same_buyer" });
  });

  it("enforces pickup and dropoff radius boundaries", () => {
    const wideDetour = config({ maxDetourRatio: 10, maxDetourKm: 10 });
    const longTask = task({ dropoff: point(0, 10) });
    const atPickupBoundary = parallelPartner({
      pickup: point(1, 0),
      dropoff: point(1, 10),
    });
    const overPickupBoundary = parallelPartner({
      pickup: point(1.001, 0),
      dropoff: point(1, 10),
    });
    const overDropoffBoundary = parallelPartner({
      pickup: point(0.5, 0),
      dropoff: point(2.001, 10),
    });

    expect(evaluateSharePair(longTask, atPickupBoundary, NOW, wideDetour).accepted).toBe(true);
    expect(evaluateSharePair(longTask, overPickupBoundary, NOW, wideDetour)).toMatchObject({
      accepted: false,
      reason: "pickup_too_far",
    });
    expect(evaluateSharePair(longTask, overDropoffBoundary, NOW, wideDetour)).toMatchObject({
      accepted: false,
      reason: "dropoff_too_far",
    });
  });

  it("rejects proportional and absolute detour violations independently", () => {
    const partner = parallelPartner({ pickup: point(0.2, 0), dropoff: point(0.2, 2) });
    const ratioDecision = evaluateSharePair(
      task(),
      partner,
      NOW,
      config({ maxDetourRatio: 0.05, maxDetourKm: 10 }),
    );
    const absoluteDecision = evaluateSharePair(
      task(),
      partner,
      NOW,
      config({ maxDetourRatio: 10, maxDetourKm: 0.1 }),
    );

    expect(ratioDecision).toMatchObject({ accepted: false, reason: "detour_ratio_exceeded" });
    expect(absoluteDecision).toMatchObject({
      accepted: false,
      reason: "detour_distance_exceeded",
    });
  });

  it("uses only the absolute cap below the ratio floor", () => {
    const tiny = task({ dropoff: point(0, 0.05) });
    const long = parallelPartner({ pickup: point(0, 0), dropoff: point(0, 1.9) });
    const decision = evaluateSharePair(tiny, long, NOW);

    expect(decision.accepted).toBe(true);
    if (!decision.accepted) return;
    expect(decision.metrics.taskMetrics[tiny.id].detourRatio).toBeNull();
  });

  it("rejects routes with no positive distance saving", () => {
    const east = task({ dropoff: point(0, 1) });
    const west = parallelPartner({ pickup: point(0, 0), dropoff: point(0, -1) });
    const decision = evaluateSharePair(
      east,
      west,
      NOW,
      config({ maxDropoffSeparationKm: 3, maxDetourRatio: 10, maxDetourKm: 10 }),
    );

    expect(decision).toMatchObject({ accepted: false, reason: "no_distance_saving" });
  });

  it("rejects a route that misses the stricter deadline after service and matching buffers", () => {
    const deadline = NOW + 45 * 60_000;
    const decision = evaluateSharePair(
      task({ deadlineAt: deadline }),
      parallelPartner(),
      NOW,
    );

    expect(decision).toMatchObject({ accepted: false, reason: "deadline_missed" });
  });

  it("ranks by saving, then creation time, then stable task id", () => {
    const newTask = task({ id: "new-task", buyerId: "new-buyer" });
    const greaterSaving = parallelPartner({
      id: "saving",
      buyerId: "saving-buyer",
      pickup: point(0.02, 0),
      dropoff: point(0.02, 2),
      createdAt: NOW + 2,
    });
    const early = parallelPartner({ id: "z-early", buyerId: "early-buyer", createdAt: NOW - 1 });
    const stable = parallelPartner({ id: "a-stable", buyerId: "stable-buyer", createdAt: NOW });
    const laterId = parallelPartner({ id: "b-stable", buyerId: "later-buyer", createdAt: NOW });

    const ranked = rankSharePartners(
      newTask,
      [laterId, stable, early, greaterSaving],
      NOW,
    ).filter((decision) => decision.accepted);

    expect(ranked.map((decision) => decision.taskIds[1])).toEqual([
      "saving",
      "z-early",
      "a-stable",
      "b-stable",
    ]);
  });

  it("returns the same route and metrics for repeated evaluation", () => {
    const first = evaluateSharePair(task(), parallelPartner(), NOW);
    const second = evaluateSharePair(task(), parallelPartner(), NOW);
    expect(second).toEqual(first);
  });

  it("rejects invalid non-versioned or non-positive configuration", () => {
    expect(() =>
      evaluateSharePair(
        task(),
        parallelPartner(),
        NOW,
        config({ assumedTravelSpeedKmh: 0 }),
      ),
    ).toThrow("assumedTravelSpeedKmh must be finite and positive");
    expect(() =>
      evaluateSharePair(
        task(),
        parallelPartner(),
        NOW,
        config({ configVersion: "" as "accra-v1" }),
      ),
    ).toThrow("Errand-Share algorithm and configuration versions are required");
  });
});
