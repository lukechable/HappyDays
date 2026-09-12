import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { requireUser } from "./lib/auth";
import { audit } from "./lib/audit";
import { blocksRetry } from "./lib/rebateRules";

export const config = query({ args: {}, handler: async (ctx) => {
  await requireUser(ctx);
  return { goLiveAt: (await ctx.db.query("rebateLaunch").unique())?.goLiveAt ?? null,
    tyroReady: process.env.TYRO_ENV === "prod" && !!process.env.TYRO_API_KEY && !!process.env.TYRO_APP_ID && !!process.env.TYRO_BUSINESS_ID,
    tyroEnvironment: process.env.TYRO_ENV ?? "not configured" };
} });
export const setGoLive = mutation({ args: {}, handler: async (ctx) => {
  const a = { goLiveAt: Date.now() };
  const user = await requireUser(ctx);
  if (user.email.startsWith("guest@")) throw new Error("Guest accounts cannot configure rebates.");
  if (await ctx.db.query("rebateLaunch").unique()) throw new Error("The HappyDays go-live cutoff is fixed and cannot be changed here.");
  await ctx.db.insert("rebateLaunch", { ...a, configuredBy: user._id, configuredAt: Date.now() });
  await audit(ctx, { userId: user._id, action: "rebate.goLiveConfigured", subjectKind: "rebate", detail: new Date(a.goLiveAt).toISOString() });
} });
export const history = query({ args: { paginationOpts: paginationOptsValidator }, handler: async (ctx, a) => {
  await requireUser(ctx);
  return await ctx.db.query("rebateClaims").withIndex("by_created").order("desc").paginate(a.paginationOpts);
} });
export const context = internalQuery({ args: { caseId: v.string(), appointmentId: v.string() }, handler: async (ctx, a) => ({
  goLiveAt: (await ctx.db.query("rebateLaunch").unique())?.goLiveAt ?? null,
  review: await ctx.db.query("carePlanReviews").withIndex("by_case", (q) => q.eq("caseId", a.caseId)).unique(),
  bookingPayments: await ctx.db.query("bookingSessions").withIndex("by_appointment", (q) => q.eq("clinikoAppointmentId", a.appointmentId)).take(2),
  claims: await ctx.db.query("rebateClaims").withIndex("by_appointment", (q) => q.eq("appointmentId", a.appointmentId)).collect(),
  caseClaims: await ctx.db.query("rebateClaims").withIndex("by_case", (q) => q.eq("caseId", a.caseId)).collect(),
}) });
export const review = internalMutation({ args: { caseId: v.string(), patientId: v.string(), caseUpdatedAt: v.string(), userId: v.id("users") }, handler: async (ctx, a) => {
  const existing = await ctx.db.query("carePlanReviews").withIndex("by_case", (q) => q.eq("caseId", a.caseId)).unique();
  const row = { caseId: a.caseId, patientId: a.patientId, caseUpdatedAt: a.caseUpdatedAt, reviewedBy: a.userId, reviewedAt: Date.now() };
  if (existing) await ctx.db.patch(existing._id, row); else await ctx.db.insert("carePlanReviews", row);
  await audit(ctx, { userId: a.userId, action: "case.referralVerified", subjectKind: "clinikoCase", subjectId: a.caseId });
} });
export const reserve = internalMutation({ args: {
  appointmentId: v.string(), patientId: v.string(), caseId: v.string(), invoiceId: v.string(),
  serviceDate: v.string(), amountCents: v.number(), itemCode: v.string(), invoiceReference: v.string(), userId: v.id("users"),
  caseUpdatedAt: v.string(), startsAt: v.number(), maxSessions: v.number(),
}, handler: async (ctx, a) => {
  const launch = await ctx.db.query("rebateLaunch").unique();
  if (!launch || a.startsAt < launch.goLiveAt) throw new Error("Appointments before HappyDays went live cannot be claimed here.");
  const review = await ctx.db.query("carePlanReviews").withIndex("by_case", (q) => q.eq("caseId", a.caseId)).unique();
  if (!review || review.patientId !== a.patientId || review.caseUpdatedAt !== a.caseUpdatedAt) throw new Error("The referral needs verification.");
  const existing = await ctx.db.query("rebateClaims").withIndex("by_appointment", (q) => q.eq("appointmentId", a.appointmentId)).collect();
  if (existing.some((r) => blocksRetry(r.status))) throw new Error("This appointment already has a claim in progress or approved.");
  // Also protect the case allocation if appointments are later moved or removed in Cliniko.
  // This indexed read participates in the same transaction as the appointment reservation.
  const caseClaims = await ctx.db.query("rebateClaims").withIndex("by_case", (q) => q.eq("caseId", a.caseId)).collect();
  if (!Number.isInteger(a.maxSessions) || a.maxSessions < 1 || caseClaims.filter((r) => blocksRetry(r.status)).length >= a.maxSessions) throw new Error("The referral has no remaining claim allocation.");
  const { userId } = a;
  const fields = { appointmentId: a.appointmentId, patientId: a.patientId, caseId: a.caseId, invoiceId: a.invoiceId, serviceDate: a.serviceDate, amountCents: a.amountCents, itemCode: a.itemCode, invoiceReference: a.invoiceReference };
  const id = await ctx.db.insert("rebateClaims", { ...fields, createdBy: userId, createdAt: Date.now(), updatedAt: Date.now(), eligibilityConfirmedAt: Date.now(), status: "launching" });
  await audit(ctx, { userId, action: "rebate.reserved", subjectKind: "rebate", subjectId: id });
  return id;
} });
export const get = internalQuery({ args: { id: v.id("rebateClaims") }, handler: (ctx, a) => ctx.db.get(a.id) });
export const pending = internalMutation({ args: {}, handler: async (ctx) => {
  const groups = await Promise.all(["launching", "pending", "under_review"].map((status) => ctx.db.query("rebateClaims").withIndex("by_poll", (q) => q.eq("status", status)).take(25)));
  const claims = groups.flat().sort((a, b) => (a.lastCheckedAt ?? 0) - (b.lastCheckedAt ?? 0) || a.createdAt - b.createdAt).slice(0, 25);
  // Rotate even when Tyro times out or an abandoned browser has no transaction yet.
  for (const claim of claims) await ctx.db.patch(claim._id, { lastCheckedAt: Date.now() });
  return claims;
} });
export const outcome = internalMutation({ args: { id: v.id("rebateClaims"), status: v.string(), transactionId: v.optional(v.string()) }, handler: async (ctx, a) => {
  const row = await ctx.db.get(a.id);
  if (!row) throw new Error("Claim not found.");
  if (row.transactionId && a.transactionId && row.transactionId !== a.transactionId) throw new Error("Claim transaction mismatch.");
  // Terminal approval cannot be downgraded by a delayed polling response.
  if (row.status === "approved" && a.status !== "approved") return;
  await ctx.db.patch(a.id, { status: a.status, ...(a.transactionId ? { transactionId: a.transactionId } : {}), updatedAt: Date.now() });
  await audit(ctx, { action: "rebate.status", subjectKind: "rebate", subjectId: a.id, detail: a.status });
} });
export const reserveCase = internalMutation({ args: { key: v.string(), patientId: v.string() }, handler: async (ctx, a) => {
  const existing = await ctx.db.query("caseCreations").withIndex("by_key", (q) => q.eq("key", a.key)).unique();
  if (existing) {
    if (existing.patientId !== a.patientId) throw new Error("This source was already assigned to another patient.");
    if (existing.caseId) return { id: existing._id, caseId: existing.caseId };
    throw new Error("Case creation was already started. Check Cliniko before trying again.");
  }
  return { id: await ctx.db.insert("caseCreations", { ...a, status: "creating", createdAt: Date.now() }), caseId: null };
} });
export const finishCase = internalMutation({ args: { id: v.id("caseCreations"), caseId: v.string() }, handler: (ctx, a) => ctx.db.patch(a.id, { caseId: a.caseId, status: "created" }) });

export const importConfig = internalQuery({ args: {}, handler: (ctx) => ctx.db.query("caseImportSettings").unique() });
export const autoImportStatus = query({ args: {}, handler: async (ctx) => { await requireUser(ctx); return (await ctx.db.query("caseImportSettings").unique())?.enabled ?? false; } });
export const setAutoImport = mutation({ args: { enabled: v.boolean() }, handler: async (ctx, a) => {
  const user = await requireUser(ctx);
  if (user.email.startsWith("guest@")) throw new Error("Guest accounts cannot enable automatic imports.");
  const existing = await ctx.db.query("caseImportSettings").unique();
  const row = { enabled: a.enabled, enabledAt: existing?.enabled && a.enabled ? existing.enabledAt : Date.now(), updatedBy: user._id };
  if (existing) await ctx.db.patch(existing._id, row); else await ctx.db.insert("caseImportSettings", row);
  await audit(ctx, { userId: user._id, action: "case.autoImportSetting", subjectKind: "setting", detail: String(a.enabled) });
} });
export const reserveImport = internalMutation({ args: { key: v.string(), userId: v.id("users") }, handler: async (ctx, a) => {
  if (await ctx.db.query("caseImportEvents").withIndex("by_key", (q) => q.eq("key", a.key)).unique()) return null;
  return await ctx.db.insert("caseImportEvents", { ...a, status: "processing", createdAt: Date.now() });
} });
export const finishImport = internalMutation({ args: { id: v.id("caseImportEvents"), success: v.boolean() }, handler: async (ctx, a) => {
  const row = await ctx.db.get(a.id);
  if (!row) return;
  await ctx.db.patch(a.id, { status: a.success ? "created" : "needs_review" });
  // In-app only: no emails or push messages containing patient details.
  await ctx.db.insert("notifications", { userId: row.userId, kind: "caseImport", title: a.success ? "Referral case created — verification needed" : "Referral import needs your attention", body: a.success ? "A labelled referral was imported into Cliniko. Review the original document before claiming." : "Open the labelled email and create the case manually. If an earlier attempt was interrupted, check Cliniko first.", href: "/mail", createdAt: Date.now() });
} });
