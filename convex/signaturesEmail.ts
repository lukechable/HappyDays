import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./lib/auth";

/** Email signatures (the PDF signing module lives in signatures.ts). */
export const mine = query({ args: {}, handler: async (ctx) => { const user = await requireUser(ctx); return await ctx.db.query("signatures").withIndex("by_user", (q) => q.eq("userId", user._id)).collect(); } });

export const save = mutation({
  args: { id: v.optional(v.id("signatures")), name: v.string(), html: v.string(), isDefaultNew: v.boolean(), isDefaultReply: v.boolean() },
  handler: async (ctx, { id, ...fields }) => {
    const user = await requireUser(ctx);
    const mine = await ctx.db.query("signatures").withIndex("by_user", (q) => q.eq("userId", user._id)).collect();
    if (fields.isDefaultNew) for (const s of mine) if (s._id !== id && s.isDefaultNew) await ctx.db.patch(s._id, { isDefaultNew: false });
    if (fields.isDefaultReply) for (const s of mine) if (s._id !== id && s.isDefaultReply) await ctx.db.patch(s._id, { isDefaultReply: false });
    if (id) { const s = await ctx.db.get(id); if (!s || s.userId !== user._id) throw new Error("Not your signature"); await ctx.db.patch(id, fields); return id; }
    return await ctx.db.insert("signatures", { userId: user._id, ...fields });
  },
});

export const remove = mutation({ args: { id: v.id("signatures") }, handler: async (ctx, { id }) => { const user = await requireUser(ctx); const s = await ctx.db.get(id); if (s && s.userId === user._id) await ctx.db.delete(id); } });
