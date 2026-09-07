import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./lib/auth";
import { tone } from "./schema";

export const list = query({ args: {}, handler: async (ctx) => { await requireUser(ctx); return (await ctx.db.query("tags").collect()).sort((a, b) => a.order - b.order); } });

export const save = mutation({
  args: { id: v.optional(v.id("tags")), name: v.string(), color: tone, aiHint: v.optional(v.string()) },
  handler: async (ctx, { id, name, color, aiHint }) => {
    const user = await requireUser(ctx);
    const clean = name.trim();
    if (!clean) throw new Error("Give the tag a name.");
    if (id) { await ctx.db.patch(id, { name: clean, color, aiHint }); return id; }
    const dupe = await ctx.db.query("tags").withIndex("by_name", (q) => q.eq("name", clean)).unique();
    if (dupe) throw new Error(`A tag called "${clean}" already exists.`);
    const count = (await ctx.db.query("tags").collect()).length;
    return await ctx.db.insert("tags", { name: clean, color, aiHint, createdBy: user._id, order: count });
  },
});

export const remove = mutation({
  args: { id: v.id("tags") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    const threads = await ctx.db.query("threads").withIndex("by_lastMessage").order("desc").take(5000);
    await Promise.all(threads.filter((t) => t.tagIds.includes(id)).map((t) => ctx.db.patch(t._id, { tagIds: t.tagIds.filter((x) => x !== id) })));
    const tasks = await ctx.db.query("tasks").withIndex("by_due").take(5000);
    await Promise.all(tasks.filter((t) => t.tagIds.includes(id)).map((t) => ctx.db.patch(t._id, { tagIds: t.tagIds.filter((x) => x !== id) })));
    await ctx.db.delete(id);
  },
});

export const reorder = mutation({ args: { ids: v.array(v.id("tags")) }, handler: async (ctx, { ids }) => { await requireUser(ctx); await Promise.all(ids.map((id, i) => ctx.db.patch(id, { order: i }))); } });

/** Threads carrying a tag, newest first (feeds the tag view in Mail and the subpoena filter). */
export const threadsWithTag = query({
  args: { tagId: v.id("tags") },
  handler: async (ctx, { tagId }) => {
    const user = await requireUser(ctx);
    const account = await ctx.db.query("googleAccounts").withIndex("by_user", (q) => q.eq("userId", user._id)).first();
    const threads = (await ctx.db.query("threads").withIndex("by_lastMessage").order("desc").take(500)).filter((t) => t.tagIds.includes(tagId));
    return threads.map((t) => ({ threadId: t._id, subject: t.subject, lastMessageAt: t.lastMessageAt, gmailThreadId: account ? t.mailboxes.find((m) => m.accountId === account._id)?.gmailThreadId : undefined }));
  },
});
