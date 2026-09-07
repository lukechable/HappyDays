import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireUser } from "./lib/auth";
import { internal } from "./_generated/api";

export async function notify(ctx: MutationCtx, n: { userId: Id<"users">; kind: string; title: string; body?: string; href?: string }) {
  await ctx.db.insert("notifications", { ...n, createdAt: Date.now() });
  const user = await ctx.db.get(n.userId);
  if (user?.prefs?.pushActivity !== false) await ctx.scheduler.runAfter(0, internal.push.sendToUser, { userId: n.userId, title: n.title, body: n.body, href: n.href, tag: `${n.kind}` });
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return await ctx.db.query("notifications").withIndex("by_user", (q) => q.eq("userId", user._id)).order("desc").take(50);
  },
});

export const markRead = mutation({
  args: { id: v.optional(v.id("notifications")) },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx);
    if (id) {
      const n = await ctx.db.get(id);
      if (n && n.userId === user._id && !n.readAt) await ctx.db.patch(id, { readAt: Date.now() });
      return;
    }
    const unread = await ctx.db.query("notifications").withIndex("by_user", (q) => q.eq("userId", user._id).eq("readAt", undefined)).collect();
    await Promise.all(unread.map((n) => ctx.db.patch(n._id, { readAt: Date.now() })));
  },
});
