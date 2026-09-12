import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

/** Current Gmail defaults: 6,000 units/minute/user; leave headroom for attachment and ancillary calls. */
export const reserve = internalMutation({
  args: { accountId: v.id("googleAccounts"), cost: v.number() },
  handler: async (ctx, { accountId, cost }) => {
    if (!Number.isFinite(cost) || cost <= 0 || cost > 1000) throw new Error("Invalid mail request cost");
    const account = await ctx.db.get(accountId);
    if (!account) throw new Error("Mail account is disconnected");
    const key = `mail.quota:${account.email.toLowerCase()}`;
    const row = await ctx.db.query("settings").withIndex("by_key", q => q.eq("key", key)).unique();
    const previous = row?.value as { tokens: number; at: number } | undefined;
    const now = Date.now();
    const tokens = previous ? Math.min(1000, previous.tokens + Math.max(0, now - previous.at) * 0.08) : 1000;
    if (tokens < cost) return Math.ceil((cost - tokens) / 0.08);
    const value = { tokens: tokens - cost, at: now };
    if (row) await ctx.db.patch(row._id, { value, updatedAt: now });
    else await ctx.db.insert("settings", { key, value, updatedAt: now });
    return 0;
  },
});
