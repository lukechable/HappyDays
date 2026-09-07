import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./lib/auth";

export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("auditLog").withIndex("by_at").order("desc").take(limit ?? 100);
    const users = new Map<string, string>();
    for (const r of rows) {
      if (r.userId && !users.has(r.userId)) { const u = await ctx.db.get(r.userId); users.set(r.userId, u?.name ?? u?.email ?? "?"); }
    }
    return rows.map((r) => ({ ...r, who: r.userId ? users.get(r.userId) : "system" }));
  },
});
