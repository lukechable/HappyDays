import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { firstName, requireUser } from "./lib/auth";
import { audit } from "./lib/audit";
import { notify } from "./notifications";
import { randomToken } from "./lib/crypto";

/** PDF signature requests: the practice drops fields on a file, the signer completes them at /sign/<token> with no login. */

const fieldV = v.object({ id: v.string(), kind: v.union(v.literal("signature"), v.literal("initials"), v.literal("date"), v.literal("text")), page: v.number(), x: v.number(), y: v.number(), w: v.number(), h: v.number(), label: v.optional(v.string()) });

export const create = mutation({
  args: { fileId: v.id("files"), signerName: v.string(), signerEmail: v.string(), message: v.optional(v.string()), fields: v.array(fieldV), matterId: v.optional(v.id("matters")), expiresInDays: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const user = await requireUser(ctx);
    if (!a.fields.some((f) => f.kind === "signature")) throw new Error("Add at least one signature field.");
    const file = await ctx.db.get(a.fileId);
    if (!file) throw new Error("File not found");
    const token = randomToken(24);
    const id = await ctx.db.insert("signatureRequests", { fileId: a.fileId, signerName: a.signerName.trim(), signerEmail: a.signerEmail.trim().toLowerCase(), token, message: a.message, fields: a.fields, status: "sent", audit: [{ at: Date.now(), event: `Created by ${user.name}` }], matterId: a.matterId ?? file.matterId, createdBy: user._id, createdAt: Date.now(), expiresAt: Date.now() + (a.expiresInDays ?? 30) * 86_400_000 });
    await audit(ctx, { userId: user._id, action: "signature.request", subjectKind: "signatureRequest", subjectId: id, detail: `${file.name} → ${a.signerEmail}` });
    return { id, token };
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("signatureRequests").order("desc").take(200);
    const users = new Map((await ctx.db.query("users").collect()).map((u) => [u._id, firstName(u)]));
    const out = [];
    for (const r of rows) { const f = await ctx.db.get(r.fileId); const m = r.matterId ? await ctx.db.get(r.matterId) : null; out.push({ ...r, fileName: f?.name ?? "(deleted)", matterName: m?.name, createdByName: users.get(r.createdBy) ?? "?" }); }
    return out;
  },
});

export const cancel = mutation({
  args: { id: v.id("signatureRequests") },
  handler: async (ctx, { id }) => { const user = await requireUser(ctx); const r = await ctx.db.get(id); if (!r || r.status === "signed") return; await ctx.db.patch(id, { status: "cancelled", audit: [...r.audit, { at: Date.now(), event: `Cancelled by ${user.name}` }] }); },
});

/* ------------------------------ signer side ------------------------------ */

export const publicByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const r = await ctx.db.query("signatureRequests").withIndex("by_token", (q) => q.eq("token", token)).unique();
    if (!r) return null;
    if (r.expiresAt <= Date.now() || r.status === "cancelled" || r.status === "declined") {
      return { status: r.expiresAt <= Date.now() ? "expired" : r.status, signerName: "", fields: [], fileName: "Document", fileUrl: null, signedUrl: null, practiceName: "Barbara Fraser & Associates", expiresAt: r.expiresAt };
    }
    const f = await ctx.db.get(r.fileId);
    const signed = r.signedFileId ? await ctx.db.get(r.signedFileId) : null;
    const practice = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", "practice.name")).unique();
    return { status: r.expiresAt <= Date.now() && r.status === "sent" ? "expired" : r.status, signerName: r.signerName, message: r.message, fields: r.fields, fileName: f?.name ?? "Document", fileUrl: f ? await ctx.storage.getUrl(f.storageId) : null, signedUrl: signed ? await ctx.storage.getUrl(signed.storageId) : null, practiceName: (practice?.value as string | undefined) ?? "Barbara Fraser & Associates", expiresAt: r.expiresAt };
  },
});

export const publicViewed = mutation({
  args: { token: v.string(), userAgent: v.optional(v.string()) },
  handler: async (ctx, { token, userAgent }) => {
    const r = await ctx.db.query("signatureRequests").withIndex("by_token", (q) => q.eq("token", token)).unique();
    if (!r || r.status !== "sent" || r.expiresAt <= Date.now()) return;
    await ctx.db.patch(r._id, { status: "viewed", audit: [...r.audit, { at: Date.now(), event: "Opened by signer", userAgent: userAgent?.slice(0, 200) }] });
  },
});

export const publicUploadUrl = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const r = await ctx.db.query("signatureRequests").withIndex("by_token", (q) => q.eq("token", token)).unique();
    if (!r || (r.status !== "sent" && r.status !== "viewed") || r.expiresAt <= Date.now()) throw new Error("This signing link is no longer active.");
    return await ctx.storage.generateUploadUrl();
  },
});

/** The browser flattens the signature into the PDF with pdf-lib and uploads the result here. */
export const publicComplete = mutation({
  args: { token: v.string(), storageId: v.id("_storage"), size: v.number(), sha256: v.string(), userAgent: v.optional(v.string()) },
  handler: async (ctx, { token, storageId, size, sha256, userAgent }) => {
    const r = await ctx.db.query("signatureRequests").withIndex("by_token", (q) => q.eq("token", token)).unique();
    if (!r || (r.status !== "sent" && r.status !== "viewed") || r.expiresAt <= Date.now()) throw new Error("This signing link is no longer active.");
    const original = await ctx.db.get(r.fileId);
    if (!original) throw new Error("Original file is missing.");
    const upload = await ctx.db.system.get(storageId);
    if (!upload || upload.contentType !== "application/pdf" || upload.size !== size || size <= 0 || size > 50 * 1024 * 1024 || storageId === original.storageId || upload._creationTime < r.createdAt) throw new Error("Upload a new PDF, no larger than 50 MB.");
    if (upload.sha256.toLowerCase() !== sha256.toLowerCase()) throw new Error("The uploaded PDF does not match its checksum.");
    const signedId = await ctx.db.insert("files", { name: original.name.replace(/\.pdf$/i, "") + " (signed).pdf", mime: "application/pdf", size, storageId, sha256, uploadedBy: r.createdBy, matterId: r.matterId ?? original.matterId, tagIds: original.tagIds, isReport: false, version: 1, createdAt: Date.now() });
    await ctx.db.patch(r._id, { status: "signed", signedFileId: signedId, audit: [...r.audit, { at: Date.now(), event: `Signed by ${r.signerName} (${r.signerEmail})`, userAgent: userAgent?.slice(0, 200) }] });
    if (r.matterId ?? original.matterId) await ctx.db.insert("matterLinks", { matterId: (r.matterId ?? original.matterId)!, kind: "file", refId: signedId, createdAt: Date.now() });
    await notify(ctx, { userId: r.createdBy, kind: "signature.signed", title: `${r.signerName} signed ${original.name}`, href: "/pdf?tab=signatures" });
    await ctx.db.insert("auditLog", { action: "signature.signed", subjectKind: "signatureRequest", subjectId: r._id, detail: r.signerEmail, at: Date.now() });
    return { signedFileId: signedId };
  },
});

export const publicDecline = mutation({
  args: { token: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, { token, reason }) => {
    const r = await ctx.db.query("signatureRequests").withIndex("by_token", (q) => q.eq("token", token)).unique();
    if (!r || (r.status !== "sent" && r.status !== "viewed") || r.expiresAt <= Date.now()) return;
    if (reason && reason.length > 2000) throw new Error("Keep the reason under 2,000 characters.");
    await ctx.db.patch(r._id, { status: "declined", audit: [...r.audit, { at: Date.now(), event: `Declined${reason ? `: ${reason}` : ""}` }] });
    await notify(ctx, { userId: r.createdBy, kind: "signature.declined", title: `${r.signerName} declined to sign`, body: reason, href: "/pdf?tab=signatures" });
  },
});

export const expireRequests = internalMutation({
  args: {},
  handler: async (ctx) => {
    const open = (await ctx.db.query("signatureRequests").withIndex("by_status", (q) => q.eq("status", "sent")).collect()).concat(await ctx.db.query("signatureRequests").withIndex("by_status", (q) => q.eq("status", "viewed")).collect());
    for (const r of open) if (r.expiresAt <= Date.now()) await ctx.db.patch(r._id, { status: "cancelled", audit: [...r.audit, { at: Date.now(), event: "Expired" }] });
  },
});
