import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

/** Serialize password attempts and first-time key creation across concurrent actions. */
export const attempt = internalMutation({
  args: {}, handler: async ctx => {
    const row = await ctx.db.query("settings").withIndex("by_key", q => q.eq("key", "guest.failures")).unique();
    const value = row?.value as { count: number; at: number } | undefined;
    const withinHour = !!value && Date.now() - value.at < 3_600_000;
    if (withinHour && value.count >= 10) throw new Error("Too many attempts. Try again in an hour.");
    const next = { count: withinHour ? value.count + 1 : 1, at: withinHour ? value.at : Date.now() };
    if (row) await ctx.db.patch(row._id, { value: next, updatedAt: Date.now() });
    else await ctx.db.insert("settings", { key: "guest.failures", value: next, updatedAt: Date.now() });
  },
});

export const installKeys = internalMutation({
  args: { pair: v.object({ privatePem: v.string(), publicJwk: v.record(v.string(), v.string()), kid: v.string(), version: v.number() }) },
  handler: async (ctx, { pair }) => {
    const row = await ctx.db.query("settings").withIndex("by_key", q => q.eq("key", "guest.keypair")).unique();
    const current = row?.value as typeof pair | undefined;
    if (current?.version === 2 && current.privatePem) return current;
    if (row) await ctx.db.patch(row._id, { value: pair, updatedAt: Date.now() });
    else await ctx.db.insert("settings", { key: "guest.keypair", value: pair, updatedAt: Date.now() });
    return pair;
  },
});
