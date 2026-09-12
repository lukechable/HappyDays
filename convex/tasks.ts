import { taskOverdue, taskDueBy } from "./lib/taskViews";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { currentUser, firstName, requireUser } from "./lib/auth";
import { audit } from "./lib/audit";
import { notify } from "./notifications";
import { tone } from "./schema";

const priority = v.union(v.literal("none"), v.literal("low"), v.literal("medium"), v.literal("high"));
const status = v.union(v.literal("open"), v.literal("doing"), v.literal("done"));
const recurrence = v.object({ freq: v.union(v.literal("daily"), v.literal("weekly"), v.literal("monthly"), v.literal("yearly")), interval: v.number(), byWeekday: v.optional(v.array(v.number())) });

/* ------------------------------ lists ------------------------------ */

export const lists = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    const lists = await ctx.db.query("taskLists").withIndex("by_order").collect();
    const open = (await ctx.db.query("tasks").withIndex("by_due", (q) => q.eq("status", "open")).collect()).concat(await ctx.db.query("tasks").withIndex("by_due", (q) => q.eq("status", "doing")).collect());
    const now = Date.now();
    const top = open.filter((t) => !t.parentId);
    return {
      lists: lists.map((l) => ({ ...l, count: top.filter((t) => t.listId === l._id).length })),
      smart: {
        inbox: top.filter((t) => !t.listId).length,
        today: top.filter((t) => taskDueBy(t, now)).length,
        week: top.filter((t) => taskDueBy(t, now, 7)).length,
        overdue: top.filter((t) => taskOverdue(t, now)).length,
        mine: top.filter((t) => t.assigneeId === user._id).length,
        assignedByMe: top.filter((t) => t.creatorId === user._id && t.assigneeId && t.assigneeId !== user._id).length,
        all: top.length,
      },
    };
  },
});

export const saveList = mutation({
  args: { id: v.optional(v.id("taskLists")), name: v.string(), color: tone },
  handler: async (ctx, { id, name, color }) => {
    const user = await requireUser(ctx);
    if (id) { await ctx.db.patch(id, { name: name.trim(), color }); return id; }
    const count = (await ctx.db.query("taskLists").collect()).length;
    return await ctx.db.insert("taskLists", { name: name.trim(), color, order: count, createdBy: user._id });
  },
});

export const removeList = mutation({
  args: { id: v.id("taskLists") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    const tasks = await ctx.db.query("tasks").withIndex("by_list", (q) => q.eq("listId", id)).collect();
    await Promise.all(tasks.map((t) => ctx.db.patch(t._id, { listId: undefined })));
    await ctx.db.delete(id);
  },
});

/* ------------------------------ tasks ------------------------------ */

export type TaskView = Doc<"tasks"> & { assignee?: string; creator: string; subtasks: Array<Pick<Doc<"tasks">, "_id" | "title" | "status" | "order">>; commentCount: number; listName?: string; listColor?: Doc<"taskLists">["color"]; matterName?: string; threadSubject?: string; gmailThreadId?: string };

export const list = query({
  args: { view: v.string(), listId: v.optional(v.id("taskLists")), includeDone: v.optional(v.boolean()), q: v.optional(v.string()), matterId: v.optional(v.id("matters")) },
  handler: async (ctx, { view, listId, includeDone, q, matterId }): Promise<TaskView[]> => {
    const user = await requireUser(ctx);
    let rows: Doc<"tasks">[];
    if (q && q.trim().length >= 2) rows = await ctx.db.query("tasks").withSearchIndex("search_title", (s) => s.search("title", q)).take(100);
    else {
      const open = (await ctx.db.query("tasks").withIndex("by_due", (x) => x.eq("status", "open")).collect()).concat(await ctx.db.query("tasks").withIndex("by_due", (x) => x.eq("status", "doing")).collect());
      const done = includeDone || view === "done" ? (await ctx.db.query("tasks").withIndex("by_due", (x) => x.eq("status", "done")).order("desc").take(100)) : [];
      rows = open.concat(done);
    }
    const now = Date.now();
    rows = rows.filter((t) => !t.parentId && (!matterId || t.matterId === matterId) && (includeDone || view === "done" || t.status !== "done"));
    switch (view) {
      case "inbox": rows = rows.filter((t) => !t.listId); break;
      case "today": rows = rows.filter((t) => taskDueBy(t, now)); break;
      case "week": rows = rows.filter((t) => taskDueBy(t, now, 7)); break;
      case "overdue": rows = rows.filter((t) => taskOverdue(t, now)); break;
      case "mine": rows = rows.filter((t) => t.assigneeId === user._id); break;
      case "assignedByMe": rows = rows.filter((t) => t.creatorId === user._id && t.assigneeId && t.assigneeId !== user._id); break;
      case "done": rows = rows.filter((t) => t.status === "done"); break;
      case "list": rows = rows.filter((t) => t.listId === listId); break;
      default: break;
    }
    const users = new Map((await ctx.db.query("users").collect()).map((u) => [u._id, firstName(u)]));
    const lists = new Map((await ctx.db.query("taskLists").collect()).map((l) => [l._id, l]));
    const account = await ctx.db.query("googleAccounts").withIndex("by_user", (x) => x.eq("userId", user._id)).first();
    const subsByParent = new Map<string, Doc<"tasks">[]>();
    const commentCounts = new Map<string, number>();
    await Promise.all(rows.map(async (t) => {
      const [subs, comments] = await Promise.all([ctx.db.query("tasks").withIndex("by_parent", (x) => x.eq("parentId", t._id)).collect(), ctx.db.query("taskComments").withIndex("by_task", (x) => x.eq("taskId", t._id)).collect()]);
      subsByParent.set(t._id, subs); commentCounts.set(t._id, comments.length);
    }));
    const matterCache = new Map<string, Doc<"matters"> | null>();
    const threadCache = new Map<string, Doc<"threads"> | null>();
    const out: TaskView[] = [];
    for (const t of rows) {
      const subs = subsByParent.get(t._id) ?? [];
      if (t.matterId && !matterCache.has(t.matterId)) matterCache.set(t.matterId, await ctx.db.get(t.matterId));
      if (t.sourceThreadId && !threadCache.has(t.sourceThreadId)) threadCache.set(t.sourceThreadId, await ctx.db.get(t.sourceThreadId));
      const matter = t.matterId ? matterCache.get(t.matterId) : null;
      const thread = t.sourceThreadId ? threadCache.get(t.sourceThreadId) : null;
      out.push({ ...t, assignee: t.assigneeId ? users.get(t.assigneeId) : undefined, creator: users.get(t.creatorId) ?? "?", subtasks: subs.map((s) => ({ _id: s._id, title: s.title, status: s.status, order: s.order })).sort((a, b) => a.order - b.order), commentCount: commentCounts.get(t._id) ?? 0, listName: t.listId ? lists.get(t.listId)?.name : undefined, listColor: t.listId ? lists.get(t.listId)?.color : undefined, matterName: matter?.name, threadSubject: thread?.subject, gmailThreadId: thread && account ? thread.mailboxes.find((m) => m.accountId === account._id)?.gmailThreadId : undefined });
    }
    const pr = { high: 0, medium: 1, low: 2, none: 3 };
    out.sort((a, b) => (a.status === "done" ? 1 : 0) - (b.status === "done" ? 1 : 0) || (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity) || pr[a.priority] - pr[b.priority] || a.order - b.order);
    return out;
  },
});

export const get = query({
  args: { id: v.id("tasks") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    const t = await ctx.db.get(id);
    if (!t) return null;
    const users = new Map((await ctx.db.query("users").collect()).map((u) => [u._id, firstName(u)]));
    const comments = await ctx.db.query("taskComments").withIndex("by_task", (x) => x.eq("taskId", id)).collect();
    const subtasks = (await ctx.db.query("tasks").withIndex("by_parent", (x) => x.eq("parentId", id)).collect()).sort((a, b) => a.order - b.order);
    return { ...t, comments: comments.map((c) => ({ ...c, who: users.get(c.userId) ?? "?" })), subtasks };
  },
});

export const save = mutation({
  args: {
    id: v.optional(v.id("tasks")), title: v.string(), notes: v.optional(v.string()), listId: v.optional(v.id("taskLists")), assigneeId: v.optional(v.id("users")), dueAt: v.optional(v.number()), allDay: v.optional(v.boolean()),
    priority: v.optional(priority), tagIds: v.optional(v.array(v.id("tags"))), recurrence: v.optional(recurrence), parentId: v.optional(v.id("tasks")), sourceThreadId: v.optional(v.id("threads")), matterId: v.optional(v.id("matters")),
  },
  handler: async (ctx, { id, ...f }) => {
    const user = await requireUser(ctx);
    const title = f.title.trim();
    if (!title) throw new Error("Give the task a title.");
    if (id) {
      const before = await ctx.db.get(id);
      if (!before) throw new Error("Task not found");
      await ctx.db.patch(id, { title, notes: f.notes, listId: f.listId, assigneeId: f.assigneeId, dueAt: f.dueAt, allDay: f.allDay ?? before.allDay, priority: f.priority ?? before.priority, tagIds: f.tagIds ?? before.tagIds, recurrence: f.recurrence, matterId: f.matterId ?? before.matterId, updatedAt: Date.now() });
      if (f.assigneeId && f.assigneeId !== before.assigneeId && f.assigneeId !== user._id) await notify(ctx, { userId: f.assigneeId, kind: "task.assigned", title: `${firstName(user)} assigned you a task`, body: title, href: `/tasks?task=${id}` });
      return id;
    }
    const siblings = f.parentId ? await ctx.db.query("tasks").withIndex("by_parent", (x) => x.eq("parentId", f.parentId)).collect() : await ctx.db.query("tasks").withIndex("by_list", (x) => x.eq("listId", f.listId).eq("status", "open")).collect();
    const newId = await ctx.db.insert("tasks", { title, notes: f.notes, listId: f.listId, assigneeId: f.assigneeId, creatorId: user._id, dueAt: f.dueAt, allDay: f.allDay ?? true, priority: f.priority ?? "none", status: "open", parentId: f.parentId, order: siblings.length, tagIds: f.tagIds ?? [], recurrence: f.recurrence, sourceThreadId: f.sourceThreadId, matterId: f.matterId, updatedAt: Date.now() });
    if (f.matterId) await ctx.db.insert("matterLinks", { matterId: f.matterId, kind: "task", refId: newId, createdAt: Date.now() });
    if (f.assigneeId && f.assigneeId !== user._id) await notify(ctx, { userId: f.assigneeId, kind: "task.assigned", title: `${firstName(user)} assigned you a task`, body: title, href: `/tasks?task=${newId}` });
    await audit(ctx, { userId: user._id, action: "task.create", subjectKind: "task", subjectId: newId, detail: title });
    return newId;
  },
});

const nextDue = (dueAt: number, r: { freq: string; interval: number; byWeekday?: number[] }) => {
  const d = new Date(dueAt);
  const n = Math.max(1, r.interval);
  if (r.freq === "daily") d.setDate(d.getDate() + n);
  else if (r.freq === "weekly") {
    if (r.byWeekday?.length) { for (let i = 1; i <= 7 * n; i++) { d.setDate(d.getDate() + 1); if (r.byWeekday.includes(d.getDay())) break; } }
    else d.setDate(d.getDate() + 7 * n);
  } else if (r.freq === "monthly") d.setMonth(d.getMonth() + n);
  else d.setFullYear(d.getFullYear() + n);
  return d.getTime();
};

export const setStatus = mutation({
  args: { id: v.id("tasks"), status },
  handler: async (ctx, { id, status: s }) => {
    const user = await requireUser(ctx);
    const t = await ctx.db.get(id);
    if (!t) return;
    await ctx.db.patch(id, { status: s, completedAt: s === "done" ? Date.now() : undefined, updatedAt: Date.now() });
    if (s === "done" && t.recurrence && t.dueAt && !t.parentId) {
      await ctx.db.insert("tasks", { title: t.title, notes: t.notes, listId: t.listId, assigneeId: t.assigneeId, creatorId: t.creatorId, dueAt: nextDue(t.dueAt, t.recurrence), allDay: t.allDay, priority: t.priority, status: "open", order: t.order, tagIds: t.tagIds, recurrence: t.recurrence, matterId: t.matterId, updatedAt: Date.now() });
    }
    if (s === "done" && t.creatorId !== user._id && t.assigneeId === user._id) await notify(ctx, { userId: t.creatorId, kind: "task.done", title: `${firstName(user)} completed a task`, body: t.title, href: `/tasks?task=${id}` });
  },
});

export const reorder = mutation({ args: { ids: v.array(v.id("tasks")) }, handler: async (ctx, { ids }) => { await requireUser(ctx); await Promise.all(ids.map((id, i) => ctx.db.patch(id, { order: i }))); } });

/** Dragging on the calendar changes only the due date; it must not clear task details. */
export const reschedule = mutation({ args: { id: v.id("tasks"), dueAt: v.number() }, handler: async (ctx, { id, dueAt }) => {
  await requireUser(ctx);
  if (!Number.isFinite(dueAt)) throw new Error("Choose a valid due date.");
  if (!await ctx.db.get(id)) throw new Error("Task not found.");
  await ctx.db.patch(id, { dueAt, updatedAt: Date.now() });
} });

export const linkMatter = mutation({ args: { id: v.id("tasks"), matterId: v.union(v.id("matters"), v.null()) }, handler: async (ctx, { id, matterId }) => {
  await requireUser(ctx);
  if (!await ctx.db.get(id)) throw new Error("Task not found.");
  if (matterId && !await ctx.db.get(matterId)) throw new Error("Matter not found.");
  await ctx.db.patch(id, { matterId: matterId ?? undefined, updatedAt: Date.now() });
} });

export const remove = mutation({
  args: { id: v.id("tasks") },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx);
    const subs = await ctx.db.query("tasks").withIndex("by_parent", (x) => x.eq("parentId", id)).collect();
    await Promise.all(subs.map((s) => ctx.db.delete(s._id)));
    const comments = await ctx.db.query("taskComments").withIndex("by_task", (x) => x.eq("taskId", id)).collect();
    await Promise.all(comments.map((c) => ctx.db.delete(c._id)));
    await ctx.db.delete(id);
    await audit(ctx, { userId: user._id, action: "task.delete", subjectKind: "task", subjectId: id });
  },
});

export const comment = mutation({
  args: { taskId: v.id("tasks"), body: v.string() },
  handler: async (ctx, { taskId, body }) => {
    const user = await requireUser(ctx);
    if (!body.trim()) return;
    await ctx.db.insert("taskComments", { taskId, userId: user._id, body: body.trim(), createdAt: Date.now() });
    const t = await ctx.db.get(taskId);
    const others = new Set<Id<"users">>([t?.creatorId, t?.assigneeId].filter((x): x is Id<"users"> => !!x && x !== user._id));
    for (const o of others) await notify(ctx, { userId: o, kind: "task.comment", title: `${firstName(user)} commented`, body: `${t?.title}: ${body.trim().slice(0, 120)}`, href: `/tasks?task=${taskId}` });
  },
});

/** Calendar view: tasks with due dates in a window. */
export const inRange = query({
  args: { from: v.number(), to: v.number() },
  handler: async (ctx, { from, to }) => {
    if (!(await currentUser(ctx))) return [];
    const open = (await ctx.db.query("tasks").withIndex("by_due", (x) => x.eq("status", "open").gte("dueAt", from).lt("dueAt", to)).collect()).concat(await ctx.db.query("tasks").withIndex("by_due", (x) => x.eq("status", "doing").gte("dueAt", from).lt("dueAt", to)).collect()).concat(await ctx.db.query("tasks").withIndex("by_due", (x) => x.eq("status", "done").gte("dueAt", from).lt("dueAt", to)).collect());
    return open.filter((t) => !t.parentId);
  },
});
