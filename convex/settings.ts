import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./lib/auth";
import { audit } from "./lib/audit";

/** Keys the app reads. Values are JSON; the settings page edits them with real controls. */
export const SETTING_KEYS = ["cliniko.businessId", "cliniko.practitionerId", "practice.name", "practice.hours", "mail.overdueHours", "booking.holdMinutes", "booking.slug"] as const;

export const get = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    await requireUser(ctx);
    const row = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", key)).unique();
    return row?.value ?? null;
  },
});

export const all = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("settings").collect();
    return Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, unknown>;
  },
});

export const set = mutation({
  args: { key: v.string(), value: v.any() },
  handler: async (ctx, { key, value }) => {
    const user = await requireUser(ctx);
    const row = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (row) await ctx.db.patch(row._id, { value, updatedBy: user._id, updatedAt: Date.now() });
    else await ctx.db.insert("settings", { key, value, updatedBy: user._id, updatedAt: Date.now() });
    await audit(ctx, { userId: user._id, action: "settings.set", subjectKind: "setting", subjectId: key });
  },
});

export const getInternal = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => (await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", key)).unique())?.value ?? null,
});

export const setInternal = internalMutation({
  args: { key: v.string(), value: v.any() },
  handler: async (ctx, { key, value }) => {
    const row = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", key)).unique();
    if (row) await ctx.db.patch(row._id, { value, updatedAt: Date.now() });
    else await ctx.db.insert("settings", { key, value, updatedAt: Date.now() });
  },
});

/** Public, unauthenticated: what the booking page needs to render (practice name, slug). */
export const publicPractice = query({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db.query("settings").collect();
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value])) as Record<string, unknown>;
    return { name: (map["practice.name"] as string | undefined) ?? "Barbara Fraser & Associates", slug: (map["booking.slug"] as string | undefined) ?? "barbara-fraser" };
  },
});

/** Which secrets are configured on the deployment (booleans only, never values), for the Settings checklist. */
export const setupStatus = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const has = (k: string) => !!process.env[k];
    return {
      clerkJwt: has("CLERK_JWT_ISSUER_DOMAIN") && !process.env.CLERK_JWT_ISSUER_DOMAIN!.includes("not-yet-configured"),
      googleOAuth: has("GOOGLE_CLIENT_ID") && has("GOOGLE_CLIENT_SECRET"),
      tokenKey: has("TOKEN_ENCRYPTION_KEY"),
      pubsub: has("GOOGLE_PUBSUB_TOPIC") && has("GOOGLE_PUBSUB_VERIFICATION_TOKEN"),
      cliniko: has("CLINIKO_API_KEY"),
      stripe: has("STRIPE_SECRET_KEY"),
      stripeWebhook: has("STRIPE_WEBHOOK_SECRET"),
      anthropic: has("ANTHROPIC_API_KEY"),
      appUrl: process.env.APP_URL ?? null,
      clinikoShard: process.env.CLINIKO_SHARD ?? "au1",
      clinikoSubdomain: process.env.CLINIKO_SUBDOMAIN ?? null,
    };
  },
});
