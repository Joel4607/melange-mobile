/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as auth from "../auth.js";
import type * as buyerLocationShares from "../buyerLocationShares.js";
import type * as buyerLocations from "../buyerLocations.js";
import type * as catalogue from "../catalogue.js";
import type * as chatUploads from "../chatUploads.js";
import type * as crons from "../crons.js";
import type * as customers from "../customers.js";
import type * as deliveryProofs from "../deliveryProofs.js";
import type * as errands from "../errands.js";
import type * as http from "../http.js";
import type * as lib_buyerLocationShare from "../lib/buyerLocationShare.js";
import type * as lib_chatAccess from "../lib/chatAccess.js";
import type * as lib_chatImage from "../lib/chatImage.js";
import type * as lib_errandFields from "../lib/errandFields.js";
import type * as lib_locationCleanup from "../lib/locationCleanup.js";
import type * as lib_locationFields from "../lib/locationFields.js";
import type * as lib_pickupLifecycle from "../lib/pickupLifecycle.js";
import type * as lib_pricingFields from "../lib/pricingFields.js";
import type * as lib_pushFields from "../lib/pushFields.js";
import type * as lib_queuePush from "../lib/queuePush.js";
import type * as lib_runnerAddress from "../lib/runnerAddress.js";
import type * as lib_runnerProfileFields from "../lib/runnerProfileFields.js";
import type * as lib_runnerTrust from "../lib/runnerTrust.js";
import type * as lib_shareAlgorithm from "../lib/shareAlgorithm.js";
import type * as lib_shareFields from "../lib/shareFields.js";
import type * as lib_shareGeo from "../lib/shareGeo.js";
import type * as lib_shareLifecycle from "../lib/shareLifecycle.js";
import type * as lib_trackingFields from "../lib/trackingFields.js";
import type * as lib_trackingLifecycle from "../lib/trackingLifecycle.js";
import type * as lib_trackingNotifications from "../lib/trackingNotifications.js";
import type * as lib_trackingPolicy from "../lib/trackingPolicy.js";
import type * as lib_trackingState from "../lib/trackingState.js";
import type * as lib_trustFields from "../lib/trustFields.js";
import type * as lib_trustScore from "../lib/trustScore.js";
import type * as locations from "../locations.js";
import type * as messages from "../messages.js";
import type * as pickup from "../pickup.js";
import type * as pricing from "../pricing.js";
import type * as push from "../push.js";
import type * as pushDelivery from "../pushDelivery.js";
import type * as refresh from "../refresh.js";
import type * as reviews from "../reviews.js";
import type * as runnerJobs from "../runnerJobs.js";
import type * as runnerPhotos from "../runnerPhotos.js";
import type * as runners from "../runners.js";
import type * as share from "../share.js";
import type * as tracking from "../tracking.js";
import type * as trust from "../trust.js";
import type * as trustEvaluation from "../trustEvaluation.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  auth: typeof auth;
  buyerLocationShares: typeof buyerLocationShares;
  buyerLocations: typeof buyerLocations;
  catalogue: typeof catalogue;
  chatUploads: typeof chatUploads;
  crons: typeof crons;
  customers: typeof customers;
  deliveryProofs: typeof deliveryProofs;
  errands: typeof errands;
  http: typeof http;
  "lib/buyerLocationShare": typeof lib_buyerLocationShare;
  "lib/chatAccess": typeof lib_chatAccess;
  "lib/chatImage": typeof lib_chatImage;
  "lib/errandFields": typeof lib_errandFields;
  "lib/locationCleanup": typeof lib_locationCleanup;
  "lib/locationFields": typeof lib_locationFields;
  "lib/pickupLifecycle": typeof lib_pickupLifecycle;
  "lib/pricingFields": typeof lib_pricingFields;
  "lib/pushFields": typeof lib_pushFields;
  "lib/queuePush": typeof lib_queuePush;
  "lib/runnerAddress": typeof lib_runnerAddress;
  "lib/runnerProfileFields": typeof lib_runnerProfileFields;
  "lib/runnerTrust": typeof lib_runnerTrust;
  "lib/shareAlgorithm": typeof lib_shareAlgorithm;
  "lib/shareFields": typeof lib_shareFields;
  "lib/shareGeo": typeof lib_shareGeo;
  "lib/shareLifecycle": typeof lib_shareLifecycle;
  "lib/trackingFields": typeof lib_trackingFields;
  "lib/trackingLifecycle": typeof lib_trackingLifecycle;
  "lib/trackingNotifications": typeof lib_trackingNotifications;
  "lib/trackingPolicy": typeof lib_trackingPolicy;
  "lib/trackingState": typeof lib_trackingState;
  "lib/trustFields": typeof lib_trustFields;
  "lib/trustScore": typeof lib_trustScore;
  locations: typeof locations;
  messages: typeof messages;
  pickup: typeof pickup;
  pricing: typeof pricing;
  push: typeof push;
  pushDelivery: typeof pushDelivery;
  refresh: typeof refresh;
  reviews: typeof reviews;
  runnerJobs: typeof runnerJobs;
  runnerPhotos: typeof runnerPhotos;
  runners: typeof runners;
  share: typeof share;
  tracking: typeof tracking;
  trust: typeof trust;
  trustEvaluation: typeof trustEvaluation;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
