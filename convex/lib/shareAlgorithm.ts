import { haversineKm, type GeoPoint } from "./shareGeo";
type Urgency = "low" | "normal" | "express";

export type ShareRejectionReason =
  | "ineligible_urgency"
  | "manual_runner"
  | "not_waiting"
  | "same_buyer"
  | "custom_stops"
  | "window_expired"
  | "pickup_too_far"
  | "dropoff_too_far"
  | "no_distance_saving"
  | "detour_ratio_exceeded"
  | "detour_distance_exceeded"
  | "deadline_missed";

export type ShareState = "ineligible" | "waiting" | "paired" | "released";

export interface ShareTask {
  id: string;
  buyerId: string;
  urgency: Urgency;
  pickup: GeoPoint;
  dropoff: GeoPoint;
  category?: string;
  createdAt: number;
  windowEndsAt: number;
  deadlineAt: number | null;
  status:
    | "posted"
    | "matched"
    | "accepted"
    | "in_progress"
    | "completed"
    | "disputed"
    | "resolved"
    | "cancelled";
  selectedRunnerId: string | null;
  shareState: ShareState;
  manualRunner: boolean;
  stopCount: number;
}

export interface ErrandShareConfig {
  algorithmVersion: string;
  configVersion: string;
  windowMinutes: { normal: number; low: number };
  maxPickupSeparationKm: number;
  maxDropoffSeparationKm: number;
  maxDetourRatio: number;
  maxDetourKm: number;
  minimumDirectDistanceForRatioKm: number;
  assumedTravelSpeedKmh: number;
  serviceMinutesPerStop: number;
  matchingBufferMinutes: number;
  maxCandidates: number;
}

export interface ShareRouteStop {
  taskId: string;
  kind: "pickup" | "dropoff";
  point: GeoPoint;
}

export interface ShareTaskMetrics {
  directDistanceKm: number;
  carriedDistanceKm: number;
  detourKm: number;
  detourRatio: number | null;
  predictedCompletionAt: number;
}

export interface ShareDecisionMetrics {
  pickupSeparationKm: number;
  dropoffSeparationKm: number;
  soloDistanceKm: number;
  sharedDistanceKm: number;
  savedDistanceKm: number;
  taskMetrics: Record<string, ShareTaskMetrics>;
}

export type ShareDecision =
  | {
      accepted: true;
      taskIds: [string, string];
      route: ShareRouteStop[];
      stricterDeadlineAt: number | null;
      metrics: ShareDecisionMetrics;
    }
  | {
      accepted: false;
      taskIds: [string, string];
      reason: ShareRejectionReason;
    };

export const DEFAULT_ERRAND_SHARE_CONFIG: ErrandShareConfig = {
  algorithmVersion: "errand-share-v1",
  configVersion: "accra-v1",
  windowMinutes: { normal: 10, low: 30 },
  maxPickupSeparationKm: 1,
  maxDropoffSeparationKm: 2,
  maxDetourRatio: 0.2,
  maxDetourKm: 2,
  minimumDirectDistanceForRatioKm: 0.1,
  assumedTravelSpeedKmh: 20,
  serviceMinutesPerStop: 5,
  matchingBufferMinutes: 30,
  maxCandidates: 50,
};

const ACCRA_CALENDAR = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Accra",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
const EPSILON = 1e-9;

function finitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

export function validateErrandShareConfig(config: ErrandShareConfig): void {
  if (!config.algorithmVersion.trim() || !config.configVersion.trim()) {
    throw new Error("Errand-Share algorithm and configuration versions are required");
  }
  const positive: [string, number][] = [
    ["windowMinutes.normal", config.windowMinutes.normal],
    ["windowMinutes.low", config.windowMinutes.low],
    ["maxPickupSeparationKm", config.maxPickupSeparationKm],
    ["maxDropoffSeparationKm", config.maxDropoffSeparationKm],
    ["maxDetourRatio", config.maxDetourRatio],
    ["maxDetourKm", config.maxDetourKm],
    ["minimumDirectDistanceForRatioKm", config.minimumDirectDistanceForRatioKm],
    ["assumedTravelSpeedKmh", config.assumedTravelSpeedKmh],
    ["serviceMinutesPerStop", config.serviceMinutesPerStop],
    ["matchingBufferMinutes", config.matchingBufferMinutes],
  ];
  for (const [name, value] of positive) {
    if (!finitePositive(value)) {
      throw new Error(`${name} must be finite and positive`);
    }
  }
  if (!Number.isInteger(config.maxCandidates) || config.maxCandidates <= 0) {
    throw new Error("maxCandidates must be a positive integer");
  }
}

export function shareWindowEndsAt(
  createdAt: number,
  urgency: Urgency,
  config: ErrandShareConfig = DEFAULT_ERRAND_SHARE_CONFIG,
): number | null {
  validateErrandShareConfig(config);
  if (!Number.isFinite(createdAt)) throw new Error("createdAt must be finite");
  if (urgency === "express") return null;
  return createdAt + config.windowMinutes[urgency] * 60_000;
}

export function todayDeadlineAt(createdAt: number): number {
  if (!Number.isFinite(createdAt)) throw new Error("createdAt must be finite");
  const parts = Object.fromEntries(
    ACCRA_CALENDAR.formatToParts(new Date(createdAt)).map((part) => [part.type, part.value]),
  );
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), 23, 59, 59, 999);
}

function rejection(
  a: ShareTask,
  b: ShareTask,
  reason: ShareRejectionReason,
): ShareDecision {
  return { accepted: false, taskIds: [a.id, b.id], reason };
}

function taskRejection(task: ShareTask, now: number): ShareRejectionReason | null {
  if (task.urgency === "express") return "ineligible_urgency";
  if (task.manualRunner) return "manual_runner";
  if (
    task.shareState !== "waiting" ||
    task.status !== "posted" ||
    task.selectedRunnerId !== null
  ) {
    return "not_waiting";
  }
  if (task.stopCount > 0) return "custom_stops";
  if (now >= task.windowEndsAt) return "window_expired";
  return null;
}

function permutations<T>(values: T[]): T[][] {
  if (values.length <= 1) return [values];
  const result: T[][] = [];
  values.forEach((value, index) => {
    const rest = values.slice(0, index).concat(values.slice(index + 1));
    for (const tail of permutations(rest)) result.push([value, ...tail]);
  });
  return result;
}

function validRoutes(a: ShareTask, b: ShareTask): ShareRouteStop[][] {
  const stops: ShareRouteStop[] = [
    { taskId: a.id, kind: "pickup", point: a.pickup },
    { taskId: a.id, kind: "dropoff", point: a.dropoff },
    { taskId: b.id, kind: "pickup", point: b.pickup },
    { taskId: b.id, kind: "dropoff", point: b.dropoff },
  ];
  return permutations(stops).filter((route) =>
    [a.id, b.id].every(
      (taskId) =>
        route.findIndex((stop) => stop.taskId === taskId && stop.kind === "pickup") <
        route.findIndex((stop) => stop.taskId === taskId && stop.kind === "dropoff"),
    ),
  );
}

function segmentDistances(route: ShareRouteStop[]): number[] {
  const distances: number[] = [];
  for (let index = 1; index < route.length; index += 1) {
    distances.push(haversineKm(route[index - 1].point, route[index].point));
  }
  return distances;
}

function routeKey(route: ShareRouteStop[]): string {
  return route.map((stop) => `${stop.taskId}:${stop.kind}`).join("|");
}

function stricterDeadline(a: ShareTask, b: ShareTask): number | null {
  const deadlines = [a.deadlineAt, b.deadlineAt].filter(
    (deadline): deadline is number => deadline !== null,
  );
  return deadlines.length > 0 ? Math.min(...deadlines) : null;
}

interface EvaluatedRoute {
  route: ShareRouteStop[];
  metrics: ShareDecisionMetrics;
  ratioViolation: boolean;
  distanceViolation: boolean;
  deadlineViolation: boolean;
}

function evaluateRoute(
  route: ShareRouteStop[],
  a: ShareTask,
  b: ShareTask,
  now: number,
  config: ErrandShareConfig,
  pickupSeparationKm: number,
  dropoffSeparationKm: number,
): EvaluatedRoute {
  const segments = segmentDistances(route);
  const sharedDistanceKm = segments.reduce((sum, value) => sum + value, 0);
  const direct = new Map([
    [a.id, haversineKm(a.pickup, a.dropoff)],
    [b.id, haversineKm(b.pickup, b.dropoff)],
  ]);
  const soloDistanceKm = [...direct.values()].reduce((sum, value) => sum + value, 0);
  const taskById = new Map([
    [a.id, a],
    [b.id, b],
  ]);
  const taskMetrics: Record<string, ShareTaskMetrics> = {};
  let ratioViolation = false;
  let distanceViolation = false;
  let deadlineViolation = false;

  for (const taskId of [a.id, b.id]) {
    const pickupIndex = route.findIndex(
      (stop) => stop.taskId === taskId && stop.kind === "pickup",
    );
    const dropoffIndex = route.findIndex(
      (stop) => stop.taskId === taskId && stop.kind === "dropoff",
    );
    const carriedDistanceKm = segments
      .slice(pickupIndex, dropoffIndex)
      .reduce((sum, value) => sum + value, 0);
    const directDistanceKm = direct.get(taskId) as number;
    const detourKm = Math.max(0, carriedDistanceKm - directDistanceKm);
    const detourRatio =
      directDistanceKm < config.minimumDirectDistanceForRatioKm
        ? null
        : detourKm / directDistanceKm;
    const distanceToDropoff = segments
      .slice(0, dropoffIndex)
      .reduce((sum, value) => sum + value, 0);
    const predictedCompletionAt =
      now +
      (config.matchingBufferMinutes +
        (distanceToDropoff / config.assumedTravelSpeedKmh) * 60 +
        (dropoffIndex + 1) * config.serviceMinutesPerStop) *
        60_000;
    const deadlineAt = taskById.get(taskId)?.deadlineAt ?? null;

    ratioViolation ||= detourRatio !== null && detourRatio > config.maxDetourRatio + EPSILON;
    distanceViolation ||= detourKm > config.maxDetourKm + EPSILON;
    deadlineViolation ||= deadlineAt !== null && predictedCompletionAt > deadlineAt;
    taskMetrics[taskId] = {
      directDistanceKm,
      carriedDistanceKm,
      detourKm,
      detourRatio,
      predictedCompletionAt,
    };
  }

  return {
    route,
    metrics: {
      pickupSeparationKm,
      dropoffSeparationKm,
      soloDistanceKm,
      sharedDistanceKm,
      savedDistanceKm: soloDistanceKm - sharedDistanceKm,
      taskMetrics,
    },
    ratioViolation,
    distanceViolation,
    deadlineViolation,
  };
}

export function evaluateSharePair(
  a: ShareTask,
  b: ShareTask,
  now: number,
  config: ErrandShareConfig = DEFAULT_ERRAND_SHARE_CONFIG,
): ShareDecision {
  validateErrandShareConfig(config);
  if (!Number.isFinite(now)) throw new Error("now must be finite");

  const aReason = taskRejection(a, now);
  if (aReason) return rejection(a, b, aReason);
  const bReason = taskRejection(b, now);
  if (bReason) return rejection(a, b, bReason);
  if (a.buyerId === b.buyerId) return rejection(a, b, "same_buyer");

  const pickupSeparationKm = haversineKm(a.pickup, b.pickup);
  if (pickupSeparationKm > config.maxPickupSeparationKm + EPSILON) {
    return rejection(a, b, "pickup_too_far");
  }
  const dropoffSeparationKm = haversineKm(a.dropoff, b.dropoff);
  if (dropoffSeparationKm > config.maxDropoffSeparationKm + EPSILON) {
    return rejection(a, b, "dropoff_too_far");
  }

  const routes = validRoutes(a, b).map((route) =>
    evaluateRoute(route, a, b, now, config, pickupSeparationKm, dropoffSeparationKm),
  );
  const savingRoutes = routes.filter((route) => route.metrics.savedDistanceKm > EPSILON);
  if (savingRoutes.length === 0) return rejection(a, b, "no_distance_saving");

  const ratioRoutes = savingRoutes.filter((route) => !route.ratioViolation);
  if (ratioRoutes.length === 0) return rejection(a, b, "detour_ratio_exceeded");
  const distanceRoutes = ratioRoutes.filter((route) => !route.distanceViolation);
  if (distanceRoutes.length === 0) return rejection(a, b, "detour_distance_exceeded");
  const deadlineRoutes = distanceRoutes.filter((route) => !route.deadlineViolation);
  if (deadlineRoutes.length === 0) return rejection(a, b, "deadline_missed");

  deadlineRoutes.sort(
    (left, right) =>
      left.metrics.sharedDistanceKm - right.metrics.sharedDistanceKm ||
      routeKey(left.route).localeCompare(routeKey(right.route)),
  );
  const best = deadlineRoutes[0];
  return {
    accepted: true,
    taskIds: [a.id, b.id],
    route: best.route,
    stricterDeadlineAt: stricterDeadline(a, b),
    metrics: best.metrics,
  };
}

export function rankSharePartners(
  newTask: ShareTask,
  candidates: ShareTask[],
  now: number,
  config: ErrandShareConfig = DEFAULT_ERRAND_SHARE_CONFIG,
): ShareDecision[] {
  validateErrandShareConfig(config);
  const limited = [...candidates]
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
    .slice(0, config.maxCandidates);
  const candidateById = new Map(limited.map((candidate) => [candidate.id, candidate]));
  const decisions = limited.map((candidate) =>
    evaluateSharePair(newTask, candidate, now, config),
  );
  return decisions.sort((left, right) => {
    if (left.accepted !== right.accepted) return left.accepted ? -1 : 1;
    const leftCandidate = candidateById.get(left.taskIds[1]) as ShareTask;
    const rightCandidate = candidateById.get(right.taskIds[1]) as ShareTask;
    if (left.accepted && right.accepted) {
      return (
        right.metrics.savedDistanceKm - left.metrics.savedDistanceKm ||
        leftCandidate.createdAt - rightCandidate.createdAt ||
        leftCandidate.id.localeCompare(rightCandidate.id)
      );
    }
    return (
      leftCandidate.createdAt - rightCandidate.createdAt ||
      leftCandidate.id.localeCompare(rightCandidate.id)
    );
  });
}
