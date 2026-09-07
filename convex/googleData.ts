import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { currentUser } from "./lib/auth";

/** Plain-runtime queries and mutations the Node actions in google.ts / mail.ts call. */

export const meForAction = internalQuery({ args: {}, handler: async (ctx) => { const u = await currentUser(ctx); return u ? { _id: u._id, email: u.email, name: u.name, prefs: u.prefs ?? {} } : null; } });

export const accountForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => await ctx.db.query("googleAccounts").withIndex("by_user", (q) => q.eq("userId", userId)).first(),
});

export const accountById = internalQuery({ args: { accountId: v.id("googleAccounts") }, handler: async (ctx, { accountId }) => await ctx.db.get(accountId) });

export const accountByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => await ctx.db.query("googleAccounts").withIndex("by_email", (q) => q.eq("email", email.toLowerCase())).first(),
});

export const connectedAccounts = internalQuery({ args: {}, handler: async (ctx) => (await ctx.db.query("googleAccounts").collect()).filter((a) => a.status === "connected") });

export const upsertAccount = internalMutation({
  args: { userId: v.id("users"), email: v.string(), refreshTokenEnc: v.string(), accessToken: v.string(), accessTokenExpiresAt: v.number(), scopes: v.array(v.string()), historyId: v.string() },
  handler: async (ctx, a) => {
    const existing = await ctx.db.query("googleAccounts").withIndex("by_user", (q) => q.eq("userId", a.userId)).first();
    const patch = { ...a, status: "connected" as const, connectedAt: Date.now() };
    if (existing) { await ctx.db.patch(existing._id, patch); await ctx.db.insert("auditLog", { userId: a.userId, action: "google.reconnect", subjectKind: "googleAccount", subjectId: existing._id, at: Date.now() }); return existing._id; }
    const id = await ctx.db.insert("googleAccounts", patch);
    await ctx.db.insert("auditLog", { userId: a.userId, action: "google.connect", subjectKind: "googleAccount", subjectId: id, at: Date.now() });
    return id;
  },
});

export const patchAccount = internalMutation({
  args: { accountId: v.id("googleAccounts"), patch: v.object({ accessToken: v.optional(v.string()), accessTokenExpiresAt: v.optional(v.number()), historyId: v.optional(v.string()), watchExpiresAt: v.optional(v.number()), lastSyncAt: v.optional(v.number()), status: v.optional(v.union(v.literal("connected"), v.literal("needs_reauth"), v.literal("disconnected"))) }) },
  handler: async (ctx, { accountId, patch }) => { await ctx.db.patch(accountId, patch); },
});

export const setStatus = internalMutation({
  args: { accountId: v.id("googleAccounts"), status: v.union(v.literal("connected"), v.literal("needs_reauth"), v.literal("disconnected")) },
  handler: async (ctx, { accountId, status }) => { await ctx.db.patch(accountId, { status, ...(status === "disconnected" ? { accessToken: undefined, accessTokenExpiresAt: undefined, watchExpiresAt: undefined } : {}) }); },
});

export const ownerName = internalQuery({ args: { accountId: v.id("googleAccounts") }, handler: async (ctx, { accountId }) => { const a = await ctx.db.get(accountId); const u = a ? await ctx.db.get(a.userId) : null; return u?.name ?? null; } });
