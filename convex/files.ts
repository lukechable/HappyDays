import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { firstName, requireUser } from "./lib/auth";
import { audit } from "./lib/audit";
import { notify } from "./notifications";
import { randomCode, sha256Hex } from "./lib/crypto";

/** These are the practice's own documents (reports, signed forms), the one kind of content Happy Days stores. */

const reportKindV = v.union(v.literal("therapy"), v.literal("family"));
export type ReportKind = "therapy" | "family";
/** Older report rows have no kind: a "therapy" in the name puts it on the Therapy list, everything else is a family report. */
export const kindFromName = (name: string): ReportKind => (/therap/i.test(name) ? "therapy" : "family");

export const uploadUrl = mutation({ args: {}, handler: async (ctx) => { await requireUser(ctx); return await ctx.storage.generateUploadUrl(); } });

export const register = mutation({
  args: { storageId: v.id("_storage"), name: v.string(), mime: v.string(), size: v.number(), sha256: v.string(), matterId: v.optional(v.id("matters")), isReport: v.optional(v.boolean()), reportKind: v.optional(reportKindV), encrypted: v.optional(v.boolean()), bundleNames: v.optional(v.array(v.string())), replacesFileId: v.optional(v.id("files")), tagIds: v.optional(v.array(v.id("tags"))) },
  handler: async (ctx, a) => {
    const user = await requireUser(ctx);
    const prev = a.replacesFileId ? await ctx.db.get(a.replacesFileId) : null;
    const isReport = a.isReport ?? prev?.isReport ?? /report/i.test(a.name);
    const id = await ctx.db.insert("files", { name: a.name, mime: a.mime, size: a.size, storageId: a.storageId, sha256: a.sha256, uploadedBy: user._id, matterId: a.matterId ?? prev?.matterId, tagIds: a.tagIds ?? prev?.tagIds ?? [], isReport, reportKind: a.reportKind ?? prev?.reportKind ?? (isReport ? kindFromName(a.name) : undefined), encrypted: a.encrypted, bundleNames: a.bundleNames, version: (prev?.version ?? 0) + 1, previousVersionId: prev?._id, createdAt: Date.now() });
    if (a.matterId ?? prev?.matterId) await ctx.db.insert("matterLinks", { matterId: (a.matterId ?? prev!.matterId)!, kind: "file", refId: id, createdAt: Date.now() });
    await audit(ctx, { userId: user._id, action: prev ? "file.newVersion" : "file.upload", subjectKind: "file", subjectId: id, detail: a.name });
    return id;
  },
});

export const list = query({
  args: { matterId: v.optional(v.id("matters")), q: v.optional(v.string()) },
  handler: async (ctx, { matterId, q }) => {
    await requireUser(ctx);
    let rows = q && q.trim().length >= 2 ? await ctx.db.query("files").withSearchIndex("search_name", (s) => s.search("name", q)).take(100) : matterId ? await ctx.db.query("files").withIndex("by_matter", (x) => x.eq("matterId", matterId)).collect() : await ctx.db.query("files").withIndex("by_created").order("desc").take(200);
    rows = rows.sort((a, b) => b.createdAt - a.createdAt);
    const users = new Map((await ctx.db.query("users").collect()).map((u) => [u._id, firstName(u)]));
    const matters = new Map((await ctx.db.query("matters").collect()).map((m) => [m._id, m.name]));
    const latestOnly = rows.filter((f) => !rows.some((g) => g.previousVersionId === f._id));
    const codes = await ctx.db.query("downloadCodes").withIndex("by_created").order("desc").take(200);
    const out = [];
    for (const f of latestOnly) {
      const mine = codes.filter((c) => c.fileIds.includes(f._id) && !c.revokedAt && c.expiresAt > Date.now());
      out.push({ ...f, uploadedByName: users.get(f.uploadedBy) ?? "?", matterName: f.matterId ? matters.get(f.matterId) : undefined, activeCodes: mine.map((c) => c.code) });
    }
    return out;
  },
});

export const get = query({
  args: { id: v.id("files") },
  handler: async (ctx, { id }) => {
    await requireUser(ctx);
    const f = await ctx.db.get(id);
    if (!f) return null;
    const url = await ctx.storage.getUrl(f.storageId);
    const versions = [];
    let cur = f.previousVersionId ? await ctx.db.get(f.previousVersionId) : null;
    while (cur) { versions.push({ _id: cur._id, version: cur.version, createdAt: cur.createdAt, size: cur.size }); cur = cur.previousVersionId ? await ctx.db.get(cur.previousVersionId) : null; }
    return { ...f, url, versions };
  },
});

export const url = query({ args: { id: v.id("files") }, handler: async (ctx, { id }) => { await requireUser(ctx); const f = await ctx.db.get(id); return f ? await ctx.storage.getUrl(f.storageId) : null; } });

export const update = mutation({
  args: { id: v.id("files"), name: v.optional(v.string()), matterId: v.optional(v.id("matters")), isReport: v.optional(v.boolean()), reportKind: v.optional(reportKindV), tagIds: v.optional(v.array(v.id("tags"))), annotations: v.optional(v.any()) },
  handler: async (ctx, { id, ...patch }) => { const user = await requireUser(ctx); await ctx.db.patch(id, patch); await audit(ctx, { userId: user._id, action: "file.update", subjectKind: "file", subjectId: id }); },
});

export const remove = mutation({
  args: { id: v.id("files") },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx);
    const f = await ctx.db.get(id);
    if (!f) return;
    const codes = (await ctx.db.query("downloadCodes").withIndex("by_created").collect()).filter((c) => c.fileIds.includes(id));
    for (const c of codes) await ctx.db.patch(c._id, { fileIds: c.fileIds.filter((x) => x !== id), revokedAt: c.fileIds.length === 1 ? Date.now() : c.revokedAt });
    await ctx.storage.delete(f.storageId);
    await ctx.db.delete(id);
    await audit(ctx, { userId: user._id, action: "file.delete", subjectKind: "file", subjectId: id, detail: f.name });
  },
});

/* ------------------------------ reports ------------------------------ */

/**
 * The Therapy Reports and Family Reports lists: latest version of every report file of that kind, with its matter's
 * delivery state, its live download codes and the last time it went out through Send Documents.
 */
export const reports = query({
  args: { kind: reportKindV },
  handler: async (ctx, { kind }) => {
    await requireUser(ctx);
    const all = (await ctx.db.query("files").withIndex("by_created").order("desc").take(500)).filter((f) => f.isReport && !f.encrypted);
    const latest = all.filter((f) => !all.some((g) => g.previousVersionId === f._id)).filter((f) => (f.reportKind ?? kindFromName(f.name)) === kind);
    const users = new Map((await ctx.db.query("users").collect()).map((u) => [u._id, firstName(u)]));
    const matters = new Map((await ctx.db.query("matters").collect()).map((m) => [m._id, m]));
    const codes = (await ctx.db.query("downloadCodes").withIndex("by_created").order("desc").take(300)).filter((c) => !c.revokedAt && c.expiresAt > Date.now());
    const sends = await ctx.db.query("documentSends").withIndex("by_sent").order("desc").take(300);
    return latest.map((f) => {
      const m = f.matterId ? matters.get(f.matterId) : undefined;
      const lastSend = sends.find((s) => s.fileNames.includes(f.name) && (!f.matterId || s.matterId === f.matterId));
      return { ...f, uploadedByName: users.get(f.uploadedBy) ?? "?", matter: m ? { _id: m._id, name: m.name, status: m.status, deliveredAt: m.reportDeliveredAt, deliveredVia: m.reportDeliveredVia } : undefined, activeCodes: codes.filter((c) => c.fileIds.includes(f._id)).map((c) => c.code), lastSentAt: lastSend?.sentAt, lastSentTo: lastSend?.to };
    });
  },
});

/* ------------------------------ send documents ------------------------------ */

/** Written by mail.sendDocuments once Gmail has accepted the message. */
export const recordSend = internalMutation({
  args: { fileId: v.id("files"), to: v.string(), toName: v.optional(v.string()), subject: v.string(), sentBy: v.id("users"), gmailThreadId: v.string(), gmailMessageId: v.string(), readReceiptRequested: v.boolean() },
  handler: async (ctx, a) => {
    const f = await ctx.db.get(a.fileId);
    if (!f) throw new Error("File not found.");
    const id = await ctx.db.insert("documentSends", { fileId: f._id, fileName: f.name, fileNames: f.bundleNames ?? [f.name], to: a.to, toName: a.toName, subject: a.subject, matterId: f.matterId, sentBy: a.sentBy, sentAt: Date.now(), gmailThreadId: a.gmailThreadId, gmailMessageId: a.gmailMessageId, readReceiptRequested: a.readReceiptRequested });
    await audit(ctx, { userId: a.sentBy, action: "file.send", subjectKind: "file", subjectId: f._id, detail: `${f.name} to ${a.to}${a.readReceiptRequested ? " (read receipt requested)" : ""}` });
    // A report emailed to its matter's recipient delivers that matter.
    if (f.isReport && f.matterId) {
      const m = await ctx.db.get(f.matterId);
      if (m && !m.reportDeliveredAt && m.status !== "closed") await ctx.db.patch(f.matterId, { reportDeliveredAt: Date.now(), reportDeliveredVia: "email", reportDeliveredBy: a.sentBy, status: "delivered", updatedAt: Date.now() });
    }
    return id;
  },
});

/** The Sent tab on Send Documents: newest first, with who sent it and where the Gmail thread is. */
export const sends = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("documentSends").withIndex("by_sent").order("desc").take(200);
    const users = new Map((await ctx.db.query("users").collect()).map((u) => [u._id, firstName(u)]));
    const matters = new Map((await ctx.db.query("matters").collect()).map((m) => [m._id, m.name]));
    return rows.map((r) => ({ ...r, sentByName: users.get(r.sentBy) ?? "?", matterName: r.matterId ? matters.get(r.matterId) : undefined }));
  },
});

/** The stored bytes of one file, for mail.sendDocuments to attach. */
export const blobFor = internalQuery({ args: { id: v.id("files") }, handler: async (ctx, { id }) => { const f = await ctx.db.get(id); return f ? { ...f, url: await ctx.storage.getUrl(f.storageId) } : null; } });

/* ------------------------------ download codes ------------------------------ */

export const createCode = mutation({
  args: { fileIds: v.array(v.id("files")), recipientName: v.optional(v.string()), recipientEmail: v.optional(v.string()), note: v.optional(v.string()), pin: v.optional(v.string()), expiresInDays: v.number(), maxDownloads: v.optional(v.number()), matterId: v.optional(v.id("matters")) },
  handler: async (ctx, a) => {
    const user = await requireUser(ctx);
    if (!a.fileIds.length) throw new Error("Pick at least one file.");
    if (a.pin !== undefined && a.pin !== "" && !/^\d{4,8}$/.test(a.pin)) throw new Error("A PIN is 4 to 8 digits.");
    let code = randomCode(8);
    while (await ctx.db.query("downloadCodes").withIndex("by_code", (q) => q.eq("code", code)).unique()) code = randomCode(8);
    const files = await Promise.all(a.fileIds.map((id) => ctx.db.get(id)));
    const matterId = a.matterId ?? files.find((f) => f?.matterId)?.matterId;
    const id = await ctx.db.insert("downloadCodes", { code, fileIds: a.fileIds, recipientName: a.recipientName, recipientEmail: a.recipientEmail, note: a.note, pinHash: a.pin ? await sha256Hex(`${code}:${a.pin}`) : undefined, expiresAt: Date.now() + Math.max(1, a.expiresInDays) * 86_400_000, maxDownloads: a.maxDownloads, downloadCount: 0, matterId, createdBy: user._id, createdAt: Date.now() });
    await audit(ctx, { userId: user._id, action: "download.createCode", subjectKind: "downloadCode", subjectId: id, detail: `${code} for ${files.map((f) => f?.name).join(", ")}` });
    return { id, code };
  },
});

export const codes = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("downloadCodes").withIndex("by_created").order("desc").take(200);
    const users = new Map((await ctx.db.query("users").collect()).map((u) => [u._id, firstName(u)]));
    const fileIds = Array.from(new Set(rows.flatMap((c) => c.fileIds)));
    const fileById = new Map((await Promise.all(fileIds.map((id) => ctx.db.get(id)))).filter((f): f is NonNullable<typeof f> => !!f).map((f) => [f._id, f]));
    const matterIds = Array.from(new Set(rows.map((c) => c.matterId).filter((x): x is NonNullable<typeof x> => !!x)));
    const matterById = new Map((await Promise.all(matterIds.map((id) => ctx.db.get(id)))).filter((m): m is NonNullable<typeof m> => !!m).map((m) => [m._id, m]));
    const eventsByCode = new Map(await Promise.all(rows.map(async (c) => [c._id, await ctx.db.query("downloadEvents").withIndex("by_code", (q) => q.eq("codeId", c._id)).order("desc").take(20)] as const)));
    const out = [];
    for (const c of rows) {
      const files = c.fileIds.map((id) => fileById.get(id)).filter((f): f is NonNullable<typeof f> => !!f);
      const events = eventsByCode.get(c._id) ?? [];
      const matter = c.matterId ? matterById.get(c.matterId) ?? null : null;
      const state = c.revokedAt ? "revoked" : c.expiresAt < Date.now() ? "expired" : c.maxDownloads && c.downloadCount >= c.maxDownloads ? "used" : c.downloadCount ? "downloaded" : "waiting";
      out.push({ ...c, files: files.map((f) => ({ _id: f._id, name: f.name, size: f.size })), events, createdByName: users.get(c.createdBy) ?? "?", matterName: matter?.name, state, hasPin: !!c.pinHash });
    }
    return out;
  },
});

export const revokeCode = mutation({ args: { id: v.id("downloadCodes") }, handler: async (ctx, { id }) => { const user = await requireUser(ctx); await ctx.db.patch(id, { revokedAt: Date.now() }); await audit(ctx, { userId: user._id, action: "download.revoke", subjectKind: "downloadCode", subjectId: id }); } });
export const extendCode = mutation({ args: { id: v.id("downloadCodes"), days: v.number() }, handler: async (ctx, { id, days }) => { await requireUser(ctx); await ctx.db.patch(id, { expiresAt: Date.now() + days * 86_400_000, revokedAt: undefined }); } });

/* ------------------------------ public side (no login) ------------------------------ */

/** What the public page can show before a PIN: practice name, file names and sizes, and whether a PIN is needed. */
export const publicLookup = query({
  args: { code: v.string() },
  handler: async (ctx, { code }) => {
    const c = await ctx.db.query("downloadCodes").withIndex("by_code", (q) => q.eq("code", code.trim().toUpperCase())).unique();
    if (!c) return { state: "unknown" as const };
    if (c.revokedAt) return { state: "revoked" as const };
    if (c.expiresAt < Date.now()) return { state: "expired" as const };
    if (c.maxDownloads && c.downloadCount >= c.maxDownloads) return { state: "limit" as const };
    const files = (await Promise.all(c.fileIds.map((id) => ctx.db.get(id)))).filter((f): f is NonNullable<typeof f> => !!f);
    return { state: "ok" as const, needsPin: !!c.pinHash, recipientName: c.recipientName, note: c.note, files: files.map((f) => ({ _id: f._id, name: f.name, size: f.size, mime: f.mime })) };
  },
});

/** Called by the Next download route: verifies the PIN, logs, counts, and returns storage URLs. */
export const publicRedeem = internalMutation({
  args: { code: v.string(), pin: v.optional(v.string()), ip: v.optional(v.string()), userAgent: v.optional(v.string()), fileId: v.optional(v.id("files")) },
  handler: async (ctx, { code, pin, ip, userAgent, fileId }) => {
    const c = await ctx.db.query("downloadCodes").withIndex("by_code", (q) => q.eq("code", code.trim().toUpperCase())).unique();
    if (!c) return { ok: false as const, reason: "unknown" as const };
    const fail = async (outcome: "bad_pin" | "expired" | "revoked" | "limit") => { await ctx.db.insert("downloadEvents", { codeId: c._id, fileId, at: Date.now(), ip, userAgent, outcome }); return { ok: false as const, reason: outcome }; };
    if (c.revokedAt) return fail("revoked");
    if (c.expiresAt < Date.now()) return fail("expired");
    if (c.maxDownloads && c.downloadCount >= c.maxDownloads) return fail("limit");
    if (c.pinHash) {
      // Brute-force guard: five wrong PINs in an hour locks the code until the hour passes.
      const recent = await ctx.db.query("downloadEvents").withIndex("by_code", (q) => q.eq("codeId", c._id).gt("at", Date.now() - 3_600_000)).collect();
      if (recent.filter((e) => e.outcome === "bad_pin").length >= 5) return fail("bad_pin");
      if ((await sha256Hex(`${c.code}:${pin ?? ""}`)) !== c.pinHash) return fail("bad_pin");
    }
    const ids = fileId ? c.fileIds.filter((x) => x === fileId) : c.fileIds;
    const files = (await Promise.all(ids.map((id) => ctx.db.get(id)))).filter((f): f is NonNullable<typeof f> => !!f);
    const out = [];
    for (const f of files) out.push({ _id: f._id, name: f.name, mime: f.mime, size: f.size, url: await ctx.storage.getUrl(f.storageId) });
    await ctx.db.insert("downloadEvents", { codeId: c._id, fileId, at: Date.now(), ip, userAgent, outcome: "ok" });
    const first = !c.firstDownloadedAt;
    await ctx.db.patch(c._id, { downloadCount: c.downloadCount + 1, firstDownloadedAt: c.firstDownloadedAt ?? Date.now() });
    if (first) {
      await notify(ctx, { userId: c.createdBy, kind: "download.first", title: `${c.recipientName ?? "Someone"} downloaded ${files.map((f) => f.name).join(", ")}`, body: `Code ${c.code}`, href: "/files?tab=codes" });
      // A Report file going out through a code delivers the matter's report.
      const report = files.find((f) => f.isReport);
      const matterId = c.matterId ?? report?.matterId;
      if (report && matterId) {
        const m = await ctx.db.get(matterId);
        if (m && !m.reportDeliveredAt && m.status !== "closed") await ctx.db.patch(matterId, { reportDeliveredAt: Date.now(), reportDeliveredVia: "download", reportDeliveredBy: c.createdBy, status: "delivered", updatedAt: Date.now() });
      }
    }
    await ctx.db.insert("auditLog", { action: "download.redeem", subjectKind: "downloadCode", subjectId: c._id, detail: files.map((f) => f.name).join(", "), ip, at: Date.now() });
    return { ok: true as const, files: out };
  },
});

export const byIds = internalQuery({ args: { ids: v.array(v.id("files")) }, handler: async (ctx, { ids }) => (await Promise.all(ids.map((id) => ctx.db.get(id)))).filter((f): f is NonNullable<typeof f> => !!f) });
export const storageUrl = internalQuery({ args: { storageId: v.id("_storage") }, handler: async (ctx, { storageId }) => await ctx.storage.getUrl(storageId) });

/** Report-tagged attachment sent on a matter thread: mark delivered (called by the compose flow). */
export const reportSentByEmail = mutation({
  args: { matterId: v.id("matters") },
  handler: async (ctx, { matterId }) => {
    const user = await requireUser(ctx);
    const m = await ctx.db.get(matterId);
    if (m && !m.reportDeliveredAt && m.status !== "closed") { await ctx.db.patch(matterId, { reportDeliveredAt: Date.now(), reportDeliveredVia: "email", reportDeliveredBy: user._id, status: "delivered", updatedAt: Date.now() }); await audit(ctx, { userId: user._id, action: "matter.delivered", subjectKind: "matter", subjectId: matterId, detail: "email" }); }
  },
});

export type PublicFile = { _id: Id<"files">; name: string; mime: string; size: number; url: string | null };
