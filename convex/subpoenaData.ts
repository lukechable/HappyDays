import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

/** Plain-runtime queries and mutations used by the Node action in subpoena.ts. */

export const candidateThreads = internalQuery({
  args: { accountId: v.id("googleAccounts"), matterId: v.optional(v.id("matters")), tagIds: v.optional(v.array(v.id("tags"))) },
  handler: async (ctx, { accountId, matterId, tagIds }) => {
    const out: string[] = [];
    const add = (t: { mailboxes: Array<{ accountId: Id<"googleAccounts">; gmailThreadId: string }> }) => { const m = t.mailboxes.find((x) => x.accountId === accountId); if (m) out.push(m.gmailThreadId); };
    if (matterId) for (const t of await ctx.db.query("threads").withIndex("by_matter", (q) => q.eq("matterId", matterId)).collect()) add(t);
    if (tagIds?.length) for (const t of await ctx.db.query("threads").withIndex("by_lastMessage").order("desc").take(2000)) if (t.tagIds.some((id) => tagIds.includes(id))) add(t);
    return Array.from(new Set(out));
  },
});

export const matter = internalQuery({ args: { id: v.id("matters") }, handler: async (ctx, { id }) => await ctx.db.get(id) });

export const saveOutputs = internalMutation({
  args: { userId: v.id("users"), matterId: v.optional(v.id("matters")), pdf: v.object({ name: v.string(), storageId: v.id("_storage"), size: v.number(), sha256: v.string() }), zip: v.object({ name: v.string(), storageId: v.id("_storage"), size: v.number(), sha256: v.string() }), detail: v.string() },
  handler: async (ctx, a) => {
    const mk = async (f: typeof a.pdf, mime: string) => { const id = await ctx.db.insert("files", { name: f.name, mime, size: f.size, storageId: f.storageId, sha256: f.sha256, uploadedBy: a.userId, matterId: a.matterId, tagIds: [], isReport: false, version: 1, createdAt: Date.now() }); if (a.matterId) await ctx.db.insert("matterLinks", { matterId: a.matterId, kind: "file", refId: id, createdAt: Date.now() }); return id; };
    const pdfFileId = await mk(a.pdf, "application/pdf");
    const zipFileId = await mk(a.zip, "application/zip");
    await ctx.db.insert("auditLog", { userId: a.userId, action: "subpoena.export", subjectKind: "matter", subjectId: a.matterId, detail: a.detail, at: Date.now() });
    return { pdfFileId, zipFileId, pdfUrl: await ctx.storage.getUrl(a.pdf.storageId), zipUrl: await ctx.storage.getUrl(a.zip.storageId) };
  },
});
