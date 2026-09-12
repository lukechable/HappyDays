import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./lib/auth";
import { audit } from "./lib/audit";

/** Keys the app reads. Values are JSON; the settings page edits them with real controls. */
export const SETTING_KEYS = ["cliniko.businessId", "cliniko.practitionerId", "cliniko.intakeFormTemplateId", "practice.name", "practice.hours", "mail.overdueHours", "booking.holdMinutes", "booking.slug"] as const;

function requirePublicKey(key: string) {
  if (!(SETTING_KEYS as readonly string[]).includes(key)) throw new Error("This setting is server-only.");
}

function validateValue(key: string, value: unknown) {
  if (key.startsWith("cliniko.")) {
    if (value !== null && (typeof value !== "string" || !/^\d{1,30}$/.test(value))) throw new Error("Choose a valid Cliniko record.");
  } else if (key === "practice.name" || key === "booking.slug") {
    if (typeof value !== "string" || !value.trim() || value.length > 200 || (key === "booking.slug" && !/^[a-z0-9-]+$/.test(value))) throw new Error("Enter a valid name or booking address.");
  } else if (key === "practice.hours") {
    const h = value as { start?: number; end?: number; days?: number[]; tz?: string } | null;
    if (!h || !Number.isInteger(h.start) || !Number.isInteger(h.end) || h.start! < 0 || h.start! > 23 || h.end! < 1 || h.end! > 24 || !Array.isArray(h.days) || h.days.length > 7 || h.days.some(d => !Number.isInteger(d) || d < 0 || d > 6) || typeof h.tz !== "string" || h.tz.length > 100) throw new Error("Enter valid business hours.");
    try { new Intl.DateTimeFormat("en", { timeZone: h.tz }); } catch { throw new Error("Choose a valid time zone."); }
  } else if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > (key === "booking.holdMinutes" ? 1440 : 240)) throw new Error("Enter a valid duration.");
}

export const get = query({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    await requireUser(ctx);
    requirePublicKey(key);
    const row = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", key)).unique();
    return row?.value ?? null;
  },
});

export const all = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await Promise.all(SETTING_KEYS.map(key => ctx.db.query("settings").withIndex("by_key", q => q.eq("key", key)).unique()));
    return Object.fromEntries(rows.flatMap(r => r ? [[r.key, r.value]] : [])) as Record<string, unknown>;
  },
});

export const set = mutation({
  args: { key: v.string(), value: v.any() },
  handler: async (ctx, { key, value }) => {
    const user = await requireUser(ctx);
    requirePublicKey(key);
    validateValue(key, value);
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
    const rows = await Promise.all(["practice.name", "booking.slug"].map(key => ctx.db.query("settings").withIndex("by_key", q => q.eq("key", key)).unique()));
    const map = Object.fromEntries(rows.flatMap(r => r ? [[r.key, r.value]] : [])) as Record<string, unknown>;
    return { name: (map["practice.name"] as string | undefined) ?? "Barbara Fraser & Associates", slug: (map["booking.slug"] as string | undefined) ?? "barbara-fraser", guestEnabled: !!process.env.GUEST_PASSWORD };
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
      basiq: has("BASIQ_API_KEY"),
      guest: has("GUEST_PASSWORD"),
      appUrl: process.env.APP_URL ?? null,
      clinikoShard: process.env.CLINIKO_SHARD ?? "au1",
      clinikoSubdomain: process.env.CLINIKO_SUBDOMAIN ?? null,
    };
  },
});
