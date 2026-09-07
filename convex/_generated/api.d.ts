/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ai from "../ai.js";
import type * as audit from "../audit.js";
import type * as autoReply from "../autoReply.js";
import type * as bookings from "../bookings.js";
import type * as crons from "../crons.js";
import type * as files from "../files.js";
import type * as google from "../google.js";
import type * as googleData from "../googleData.js";
import type * as guest from "../guest.js";
import type * as http from "../http.js";
import type * as labelRules from "../labelRules.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_cliniko from "../lib/cliniko.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_gmail from "../lib/gmail.js";
import type * as mail from "../mail.js";
import type * as matters from "../matters.js";
import type * as money from "../money.js";
import type * as notifications from "../notifications.js";
import type * as settings from "../settings.js";
import type * as signatures from "../signatures.js";
import type * as signaturesEmail from "../signaturesEmail.js";
import type * as stripe from "../stripe.js";
import type * as subpoena from "../subpoena.js";
import type * as subpoenaData from "../subpoenaData.js";
import type * as tags from "../tags.js";
import type * as tasks from "../tasks.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  ai: typeof ai;
  audit: typeof audit;
  autoReply: typeof autoReply;
  bookings: typeof bookings;
  crons: typeof crons;
  files: typeof files;
  google: typeof google;
  googleData: typeof googleData;
  guest: typeof guest;
  http: typeof http;
  labelRules: typeof labelRules;
  "lib/audit": typeof lib_audit;
  "lib/auth": typeof lib_auth;
  "lib/cliniko": typeof lib_cliniko;
  "lib/crypto": typeof lib_crypto;
  "lib/gmail": typeof lib_gmail;
  mail: typeof mail;
  matters: typeof matters;
  money: typeof money;
  notifications: typeof notifications;
  settings: typeof settings;
  signatures: typeof signatures;
  signaturesEmail: typeof signaturesEmail;
  stripe: typeof stripe;
  subpoena: typeof subpoena;
  subpoenaData: typeof subpoenaData;
  tags: typeof tags;
  tasks: typeof tasks;
  users: typeof users;
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
