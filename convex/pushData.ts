import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { requireUser } from "./lib/auth";

/** The VAPID public key lives on Convex so the client never needs a rebuild to pick it up. */
export const vapidPublicKey = query({ args: {}, handler: async () => process.env.VAPID_PUBLIC_KEY ?? null });

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const subs = await ctx.db.query("pushSubscriptions").withIndex("by_user", (q) => q.eq("userId", user._id)).collect();
    return subs.map((s) => ({ _id: s._id, endpoint: s.endpoint, userAgent: s.userAgent, createdAt: s.createdAt, lastOkAt: s.lastOkAt, failures: s.failures }));
  },
});

export const subscribe = mutation({
  args: { endpoint: v.string(), p256dh: v.string(), auth: v.string(), userAgent: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const user = await requireUser(ctx);
    const existing = await ctx.db.query("pushSubscriptions").withIndex("by_endpoint", (q) => q.eq("endpoint", a.endpoint)).unique();
    if (existing) { await ctx.db.patch(existing._id, { userId: user._id, p256dh: a.p256dh, auth: a.auth, userAgent: a.userAgent, failures: 0 }); return existing._id; }
    return await ctx.db.insert("pushSubscriptions", { ...a, userId: user._id, createdAt: Date.now(), failures: 0 });
  },
});

export const unsubscribe = mutation({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    const user = await requireUser(ctx);
    const existing = await ctx.db.query("pushSubscriptions").withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint)).unique();
    if (existing && existing.userId === user._id) await ctx.db.delete(existing._id);
  },
});

export const subsForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => await ctx.db.query("pushSubscriptions").withIndex("by_user", (q) => q.eq("userId", userId)).collect(),
});

export const record = internalMutation({
  args: { id: v.id("pushSubscriptions"), ok: v.boolean(), gone: v.optional(v.boolean()) },
  handler: async (ctx, { id, ok, gone }) => {
    const s = await ctx.db.get(id);
    if (!s) return;
    if (gone || (!ok && s.failures >= 4)) { await ctx.db.delete(id); return; }
    await ctx.db.patch(id, ok ? { lastOkAt: Date.now(), failures: 0 } : { failures: s.failures + 1 });
  },
});
