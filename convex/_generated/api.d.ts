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
import type * as bank from "../bank.js";
import type * as bookings from "../bookings.js";
import type * as cases from "../cases.js";
import type * as court from "../court.js";
import type * as crons from "../crons.js";
import type * as files from "../files.js";
import type * as google from "../google.js";
import type * as googleData from "../googleData.js";
import type * as guest from "../guest.js";
import type * as guestData from "../guestData.js";
import type * as http from "../http.js";
import type * as labelRules from "../labelRules.js";
import type * as lib_appointmentPayments from "../lib/appointmentPayments.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_cliniko from "../lib/cliniko.js";
import type * as lib_crypto from "../lib/crypto.js";
import type * as lib_gmail from "../lib/gmail.js";
import type * as lib_invoiceFlags from "../lib/invoiceFlags.js";
import type * as lib_mailViews from "../lib/mailViews.js";
import type * as lib_rebateRules from "../lib/rebateRules.js";
import type * as lib_smartMail from "../lib/smartMail.js";
import type * as lib_taskViews from "../lib/taskViews.js";
import type * as lib_tyro from "../lib/tyro.js";
import type * as mail from "../mail.js";
import type * as mailQuota from "../mailQuota.js";
import type * as matters from "../matters.js";
import type * as money from "../money.js";
import type * as notifications from "../notifications.js";
import type * as push from "../push.js";
import type * as pushData from "../pushData.js";
import type * as rebateData from "../rebateData.js";
import type * as rebates from "../rebates.js";
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
  bank: typeof bank;
  bookings: typeof bookings;
  cases: typeof cases;
  court: typeof court;
  crons: typeof crons;
  files: typeof files;
  google: typeof google;
  googleData: typeof googleData;
  guest: typeof guest;
  guestData: typeof guestData;
  http: typeof http;
  labelRules: typeof labelRules;
  "lib/appointmentPayments": typeof lib_appointmentPayments;
  "lib/audit": typeof lib_audit;
  "lib/auth": typeof lib_auth;
  "lib/cliniko": typeof lib_cliniko;
  "lib/crypto": typeof lib_crypto;
  "lib/gmail": typeof lib_gmail;
  "lib/invoiceFlags": typeof lib_invoiceFlags;
  "lib/mailViews": typeof lib_mailViews;
  "lib/rebateRules": typeof lib_rebateRules;
  "lib/smartMail": typeof lib_smartMail;
  "lib/taskViews": typeof lib_taskViews;
  "lib/tyro": typeof lib_tyro;
  mail: typeof mail;
  mailQuota: typeof mailQuota;
  matters: typeof matters;
  money: typeof money;
  notifications: typeof notifications;
  push: typeof push;
  pushData: typeof pushData;
  rebateData: typeof rebateData;
  rebates: typeof rebates;
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
