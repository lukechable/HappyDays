import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { currentUser, firstName, requireUser } from "./lib/auth";
import { audit } from "./lib/audit";
import { notify } from "./notifications";

const status = v.union(v.literal("open"), v.literal("report_due"), v.literal("delivered"), v.literal("closed"));

export const list = query({
  args: { includeClosed: v.optional(v.boolean()) },
  handler: async (ctx, { includeClosed }) => {
    await requireUser(ctx);
    const rows = (await ctx.db.query("matters").collect()).filter((m) => includeClosed || m.status !== "closed").sort((a, b) => b.updatedAt - a.updatedAt);
    const out = [];
    const extras = await Promise.all(rows.map(async (m) => { const [links, invoices, tasks] = await Promise.all([ctx.db.query("matterLinks").withIndex("by_matter", (q) => q.eq("matterId", m._id)).collect(), ctx.db.query("stripeInvoices").withIndex("by_matter", (q) => q.eq("matterId", m._id)).collect(), ctx.db.query("tasks").withIndex("by_matter", (q) => q.eq("matterId", m._id)).collect()]); return { links, invoices, tasks }; }));
    for (const [i, m] of rows.entries()) {
      const { links, invoices, tasks } = extras[i];
      out.push({ ...m, counts: { threads: links.filter((l) => l.kind === "thread").length, files: links.filter((l) => l.kind === "file").length, tasks: tasks.filter((t) => t.status !== "done").length, invoices: invoices.length }, paid: invoices.some((i) => i.status === "paid"), unpaidCents: invoices.filter((i) => i.status === "open" || i.status === "uncollectible").reduce((s, i) => s + Math.max(0, i.amountDueCents - i.amountPaidCents), 0) });
    }
    return out;
  },
});

export const search = query({
  args: { q: v.string() },
  handler: async (ctx, { q }) => {
    if (!(await currentUser(ctx))) return [];
    if (q.trim().length < 2) return [];
    return await ctx.db.query("matters").withSearchIndex("search_name", (s) => s.search("name", q)).take(8);
  },
});

export const get = query({
  args: { id: v.id("matters") },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx);
    const m = await ctx.db.get(id);
    if (!m) return null;
    const account = await ctx.db.query("googleAccounts").withIndex("by_user", (q) => q.eq("userId", user._id)).first();
    const threads = (await ctx.db.query("threads").withIndex("by_matter", (q) => q.eq("matterId", id)).collect()).sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    const tasks = (await ctx.db.query("tasks").withIndex("by_matter", (q) => q.eq("matterId", id)).collect()).sort((a, b) => a.order - b.order);
    const files = (await ctx.db.query("files").withIndex("by_matter", (q) => q.eq("matterId", id)).collect()).sort((a, b) => b.createdAt - a.createdAt);
    const invoices = await ctx.db.query("stripeInvoices").withIndex("by_matter", (q) => q.eq("matterId", id)).collect();
    const codes = await ctx.db.query("downloadCodes").withIndex("by_matter", (q) => q.eq("matterId", id)).collect();
    const sigs = await ctx.db.query("signatureRequests").withIndex("by_matter", (q) => q.eq("matterId", id)).collect();
    const users = new Map((await ctx.db.query("users").collect()).map((u) => [u._id, firstName(u)]));
    return {
      ...m,
      deliveredBy: m.reportDeliveredBy ? users.get(m.reportDeliveredBy) : undefined,
      threads: threads.map((t) => ({ threadId: t._id, subject: t.subject, lastMessageAt: t.lastMessageAt, participants: t.participants, repliedBy: (t.repliedByEmails ?? []).map((e) => { const local = e.split("@")[0]; return local.charAt(0).toUpperCase() + local.slice(1); }), gmailThreadId: account ? t.mailboxes.find((x) => x.accountId === account._id)?.gmailThreadId : undefined })),
      tasks, files: files.map((f) => ({ _id: f._id, name: f.name, size: f.size, mime: f.mime, isReport: f.isReport, createdAt: f.createdAt, version: f.version })), invoices, codes, signatureRequests: sigs,
    };
  },
});

export const save = mutation({
  args: { id: v.optional(v.id("matters")), name: v.string(), courtFileNo: v.optional(v.string()), court: v.optional(v.string()), parties: v.array(v.string()), clinikoPatientIds: v.array(v.string()), status: v.optional(status), notes: v.optional(v.string()) },
  handler: async (ctx, { id, ...fields }) => {
    const user = await requireUser(ctx);
    if (!fields.name.trim()) throw new Error("Give the matter a name.");
    if (id) { await ctx.db.patch(id, { ...fields, status: fields.status ?? "open", updatedAt: Date.now() }); await audit(ctx, { userId: user._id, action: "matter.update", subjectKind: "matter", subjectId: id }); return id; }
    const newId = await ctx.db.insert("matters", { ...fields, status: fields.status ?? "open", createdBy: user._id, updatedAt: Date.now() });
    await audit(ctx, { userId: user._id, action: "matter.create", subjectKind: "matter", subjectId: newId, detail: fields.name });
    return newId;
  },
});

export const setStatus = mutation({
  args: { id: v.id("matters"), status },
  handler: async (ctx, { id, status: s }) => { const user = await requireUser(ctx); await ctx.db.patch(id, { status: s, updatedAt: Date.now() }); await audit(ctx, { userId: user._id, action: "matter.status", subjectKind: "matter", subjectId: id, detail: s }); },
});

/** Mark the written report delivered. Download codes and Report-tagged sends call this automatically. */
export const markDelivered = mutation({
  args: { id: v.id("matters"), via: v.union(v.literal("download"), v.literal("email"), v.literal("manual")), undo: v.optional(v.boolean()) },
  handler: async (ctx, { id, via, undo }) => {
    const user = await requireUser(ctx);
    const m = await ctx.db.get(id);
    if (!m) return;
    if (m.status === "closed" && !undo) throw new Error("This matter is closed. Reopen it before marking the report delivered.");
    if (undo) { await ctx.db.patch(id, { reportDeliveredAt: undefined, reportDeliveredVia: undefined, reportDeliveredBy: undefined, status: m.status === "delivered" ? "report_due" : m.status, updatedAt: Date.now() }); return; }
    await ctx.db.patch(id, { reportDeliveredAt: Date.now(), reportDeliveredVia: via, reportDeliveredBy: user._id, status: "delivered", updatedAt: Date.now() });
    await audit(ctx, { userId: user._id, action: "matter.delivered", subjectKind: "matter", subjectId: id, detail: via });
    const others = (await ctx.db.query("users").collect()).filter((u) => u._id !== user._id);
    for (const o of others) await notify(ctx, { userId: o._id, kind: "matter.delivered", title: `Report delivered: ${m.name}`, body: `${firstName(user)} marked it delivered (${via})`, href: `/matters/${id}` });
  },
});

export const remove = mutation({
  args: { id: v.id("matters") },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx);
    const links = await ctx.db.query("matterLinks").withIndex("by_matter", (q) => q.eq("matterId", id)).collect();
    await Promise.all(links.map((l) => ctx.db.delete(l._id)));
    for (const t of await ctx.db.query("threads").withIndex("by_matter", (q) => q.eq("matterId", id)).collect()) await ctx.db.patch(t._id, { matterId: undefined });
    for (const t of await ctx.db.query("tasks").withIndex("by_matter", (q) => q.eq("matterId", id)).collect()) await ctx.db.patch(t._id, { matterId: undefined });
    for (const f of await ctx.db.query("files").withIndex("by_matter", (q) => q.eq("matterId", id)).collect()) await ctx.db.patch(f._id, { matterId: undefined });
    await ctx.db.delete(id);
    await audit(ctx, { userId: user._id, action: "matter.delete", subjectKind: "matter", subjectId: id });
  },
});
