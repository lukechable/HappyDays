"use node";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import JSZip from "jszip";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { accessTokenFor } from "./google";
import * as gmail from "./lib/gmail";
import { sha256Hex } from "./lib/crypto";

/**
 * Subpoena export. Step 1 (preview) lists every message that matches the matter or the filter so the user can
 * untick anything privileged or irrelevant. Step 2 (export) fetches only the ticked messages from Gmail, lays
 * them out chronologically in one PDF with full headers, appends PDF and image attachments, lists the rest, and
 * also produces a ZIP with the originals and an index CSV. Both land in Files against the matter.
 */

export type PreviewMessage = { gmailMessageId: string; gmailThreadId: string; from: string; to: string; cc: string; date: number; subject: string; snippet: string; attachments: Array<{ attachmentId: string; filename: string; mime: string; size: number }>; direction: "in" | "out" };

export const preview = action({
  args: { matterId: v.optional(v.id("matters")), labelIds: v.optional(v.array(v.string())), q: v.optional(v.string()), participants: v.optional(v.array(v.string())), from: v.optional(v.string()), to: v.optional(v.string()), tagIds: v.optional(v.array(v.id("tags"))) },
  handler: async (ctx, a): Promise<{ messages: PreviewMessage[]; truncated: boolean }> => {
    const me = await ctx.runQuery(internal.googleData.meForAction, {});
    if (!me) throw new Error("Sign in first.");
    const account = await ctx.runQuery(internal.googleData.accountForUser, { userId: me._id });
    if (!account || account.status !== "connected") throw new Error("Connect Gmail first.");
    const token = await accessTokenFor(ctx, account._id);
    const orgEmails = new Set([account.email, me.email.toLowerCase()]);

    const threadIds = new Set<string>();
    const fromConvex = await ctx.runQuery(internal.subpoenaData.candidateThreads, { accountId: account._id, matterId: a.matterId, tagIds: a.tagIds });
    fromConvex.forEach((id) => threadIds.add(id));
    const parts: string[] = [];
    if (a.q) parts.push(a.q);
    if (a.participants?.length) parts.push(`(${a.participants.map((p) => `from:${p} OR to:${p} OR cc:${p}`).join(" OR ")})`);
    if (a.from) parts.push(`after:${a.from.replace(/-/g, "/")}`);
    if (a.to) parts.push(`before:${a.to.replace(/-/g, "/")}`);
    let truncated = false;
    // A Gmail folder (label) as the source: every thread carrying it, narrowed by whatever filters are set.
    if (parts.length || a.labelIds?.length) {
      let pageToken: string | undefined; let pages = 0;
      do { const r = await gmail.listThreadIds(token, { q: `${parts.join(" ")} -in:spam -in:trash`.trim(), labelIds: a.labelIds?.length ? a.labelIds : undefined, pageToken, maxResults: 100 }); r.ids.forEach((id) => threadIds.add(id)); pageToken = r.nextPageToken; pages++; } while (pageToken && pages < 5);
      if (pageToken) truncated = true;
    }
    const ids = Array.from(threadIds).slice(0, 500);
    const messages: PreviewMessage[] = [];
    for (let i = 0; i < ids.length; i += 50) {
      const threads = await gmail.batchGetThreads(token, ids.slice(i, i + 50), "full");
      for (const t of threads) for (const m of t.messages ?? []) {
        if ((m.labelIds ?? []).includes("DRAFT")) continue;
        const body = gmail.parseBody(m.payload);
        const from = gmail.header(m, "From");
        messages.push({ gmailMessageId: m.id, gmailThreadId: t.id, from, to: gmail.header(m, "To"), cc: gmail.header(m, "Cc"), date: Number(m.internalDate ?? 0), subject: gmail.header(m, "Subject") || "(no subject)", snippet: m.snippet ?? "", attachments: body.attachments.filter((x) => x.attachmentId && !x.inline).map((x) => ({ attachmentId: x.attachmentId, filename: x.filename, mime: x.mime, size: x.size })), direction: orgEmails.has(gmail.parseAddresses(from)[0]?.email ?? "") ? "out" : "in" });
      }
    }
    const dateFilter = (m: PreviewMessage) => (!a.from || m.date >= Date.parse(a.from)) && (!a.to || m.date <= Date.parse(a.to) + 86_400_000);
    return { messages: messages.filter(dateFilter).sort((x, y) => x.date - y.date), truncated };
  },
});

/* ------------------------------ PDF layout helpers ------------------------------ */

const A4 = { w: 595.28, h: 841.89 };
const M = 48;
type Writer = { doc: PDFDocument; page: PDFPage; y: number; font: PDFFont; bold: PDFFont; pageNo: number; title: string };

async function newWriter(title: string): Promise<Writer> {
  const doc = await PDFDocument.create();
  doc.setTitle(title); doc.setProducer("Happy Days"); doc.setCreator("Happy Days");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const w: Writer = { doc, page: doc.addPage([A4.w, A4.h]), y: A4.h - M, font, bold, pageNo: 1, title };
  footer(w);
  return w;
}
function footer(w: Writer) { w.page.drawText(`${w.title} — page ${w.pageNo}`, { x: M, y: 24, size: 8, font: w.font, color: rgb(0.45, 0.45, 0.45) }); }
function ensure(w: Writer, needed: number) { if (w.y - needed < M) { w.page = w.doc.addPage([A4.w, A4.h]); w.pageNo++; w.y = A4.h - M; footer(w); } }
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.replace(/\r/g, "").split("\n")) {
    const words = para.split(/\s+/); let line = "";
    for (const word of words) {
      const test = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(test, size) <= width) line = test;
      else { if (line) lines.push(line); if (font.widthOfTextAtSize(word, size) > width) { let chunk = ""; for (const ch of word) { if (font.widthOfTextAtSize(chunk + ch, size) > width) { lines.push(chunk); chunk = ch; } else chunk += ch; } line = chunk; } else line = word; }
    }
    lines.push(line);
  }
  return lines;
}
const clean = (s: string) => s.replace(/[^\x09\x0a\x0d\x20-\x7e -ɏ‐-‧‰-⁞€]/g, "?");
function text(w: Writer, s: string, opts: { size?: number; bold?: boolean; color?: [number, number, number]; gap?: number; indent?: number } = {}) {
  const size = opts.size ?? 10; const font = opts.bold ? w.bold : w.font; const indent = opts.indent ?? 0;
  for (const line of wrap(clean(s), font, size, A4.w - 2 * M - indent)) { ensure(w, size + 3); w.page.drawText(line, { x: M + indent, y: w.y - size, size, font, color: opts.color ? rgb(...opts.color) : rgb(0.1, 0.1, 0.1) }); w.y -= size + 3; }
  w.y -= opts.gap ?? 0;
}
function rule(w: Writer) { ensure(w, 10); w.page.drawLine({ start: { x: M, y: w.y - 4 }, end: { x: A4.w - M, y: w.y - 4 }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) }); w.y -= 12; }
const fmt = (t: number) => new Date(t).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", dateStyle: "full", timeStyle: "short" });

/* ------------------------------ export ------------------------------ */

export const run = action({
  args: { matterId: v.optional(v.id("matters")), title: v.string(), note: v.optional(v.string()), messages: v.array(v.object({ gmailMessageId: v.string(), attachmentIds: v.array(v.string()) })), excludedCount: v.number() },
  handler: async (ctx, a): Promise<{ pdfFileId: Id<"files">; zipFileId: Id<"files">; pdfUrl: string | null; zipUrl: string | null; pages: number; messages: number }> => {
    const me = await ctx.runQuery(internal.googleData.meForAction, {});
    if (!me) throw new Error("Sign in first.");
    const account = await ctx.runQuery(internal.googleData.accountForUser, { userId: me._id });
    if (!account || account.status !== "connected") throw new Error("Connect Gmail first.");
    const token = await accessTokenFor(ctx, account._id);
    const matter = a.matterId ? await ctx.runQuery(internal.subpoenaData.matter, { id: a.matterId }) : null;
    const title = a.title.trim() || matter?.name || "Email export";

    // Fetch in the order asked; sort by date for the document.
    const fetched: Array<{ m: gmail.GmailMessage; body: gmail.ParsedBody; wanted: Set<string> }> = [];
    for (const item of a.messages) { const m = await gmail.getMessage(token, item.gmailMessageId, "full"); fetched.push({ m, body: gmail.parseBody(m.payload), wanted: new Set(item.attachmentIds) }); }
    fetched.sort((x, y) => Number(x.m.internalDate ?? 0) - Number(y.m.internalDate ?? 0));

    const w = await newWriter(title);
    const zip = new JSZip();
    const index: string[] = ["No,Date,From,To,Cc,Subject,Attachments,GmailMessageId"];
    const appendix: Array<{ n: number; filename: string; mime: string; bytes: Uint8Array; size: number }> = [];

    // Cover page
    text(w, title, { size: 22, bold: true, gap: 6 });
    text(w, "Email export prepared by Happy Days for Barbara Fraser & Associates", { size: 10, color: [0.35, 0.35, 0.35], gap: 14 });
    if (matter) { text(w, "Matter", { bold: true }); text(w, [matter.name, matter.courtFileNo ? `File no. ${matter.courtFileNo}` : "", matter.court ?? "", matter.parties.length ? `Parties: ${matter.parties.join("; ")}` : ""].filter(Boolean).join("\n"), { gap: 10 }); }
    text(w, "Export details", { bold: true });
    const first = fetched[0] ? Number(fetched[0].m.internalDate) : 0; const last = fetched.at(-1) ? Number(fetched.at(-1)!.m.internalDate) : 0;
    text(w, [`Prepared by: ${me.name} <${account.email}>`, `Prepared on: ${fmt(Date.now())}`, `Messages included: ${fetched.length}`, `Messages reviewed and excluded: ${a.excludedCount}`, first ? `Date range: ${fmt(first)} to ${fmt(last)}` : "", a.note ? `Note: ${a.note}` : ""].filter(Boolean).join("\n"), { gap: 10 });
    text(w, "Contents", { bold: true });
    fetched.forEach((f, i) => text(w, `${i + 1}. ${fmt(Number(f.m.internalDate))} — ${gmail.header(f.m, "Subject") || "(no subject)"} — ${gmail.parseAddresses(gmail.header(f.m, "From"))[0]?.email ?? ""}`, { size: 9, indent: 8 }));
    text(w, "Bodies are reproduced as plain text from the original messages. Attachments in PDF or image form are appended; other attachments are listed and supplied in the accompanying archive.", { size: 8.5, color: [0.4, 0.4, 0.4], gap: 4 });

    // Messages
    for (let i = 0; i < fetched.length; i++) {
      const { m, body, wanted } = fetched[i];
      const n = i + 1;
      w.page = w.doc.addPage([A4.w, A4.h]); w.pageNo++; w.y = A4.h - M; footer(w);
      text(w, `Message ${n} of ${fetched.length}`, { size: 9, color: [0.4, 0.4, 0.4] });
      text(w, gmail.header(m, "Subject") || "(no subject)", { size: 14, bold: true, gap: 4 });
      const hdr: Array<[string, string]> = [["From", gmail.header(m, "From")], ["To", gmail.header(m, "To")], ["Cc", gmail.header(m, "Cc")], ["Date", fmt(Number(m.internalDate))], ["Message-ID", gmail.header(m, "Message-ID")]];
      for (const [k, val] of hdr) if (val) text(w, `${k}: ${val}`, { size: 9 });
      const atts = body.attachments.filter((x) => x.attachmentId && !x.inline);
      if (atts.length) text(w, `Attachments: ${atts.map((x) => `${x.filename} (${Math.round(x.size / 1024)} KB${wanted.has(x.attachmentId) ? "" : ", not included"})`).join("; ")}`, { size: 9 });
      rule(w);
      text(w, body.text ?? gmail.htmlToText(body.html ?? "") ?? "", { size: 10 });
      const raw = await gmail.getMessage(token, m.id, "raw");
      if (raw.raw) zip.file(`messages/${String(n).padStart(3, "0")}-${safe(gmail.header(m, "Subject") || "no-subject")}.eml`, gmail.decodeBase64Url(raw.raw));
      for (const x of atts) {
        if (!wanted.has(x.attachmentId)) continue;
        const data = await gmail.getAttachment(token, m.id, x.attachmentId);
        const bytes = gmail.decodeBase64Url(data.data);
        zip.file(`attachments/${String(n).padStart(3, "0")}-${safe(x.filename)}`, bytes);
        appendix.push({ n, filename: x.filename, mime: x.mime, bytes, size: bytes.length });
      }
      index.push([n, fmt(Number(m.internalDate)), gmail.header(m, "From"), gmail.header(m, "To"), gmail.header(m, "Cc"), gmail.header(m, "Subject"), atts.filter((x) => wanted.has(x.attachmentId)).map((x) => x.filename).join("; "), m.id].map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","));
    }

    // Appendix: merge PDFs and images; list the rest.
    if (appendix.length) {
      w.page = w.doc.addPage([A4.w, A4.h]); w.pageNo++; w.y = A4.h - M; footer(w);
      text(w, "Appendix: attachments", { size: 16, bold: true, gap: 6 });
      for (const ap of appendix) text(w, `Message ${ap.n} — ${ap.filename} (${ap.mime}, ${Math.round(ap.size / 1024)} KB) — SHA-256 ${await sha256Hex(ap.bytes)}`, { size: 9 });
      for (const ap of appendix) {
        try {
          if (ap.mime === "application/pdf") {
            const src = await PDFDocument.load(ap.bytes, { ignoreEncryption: true });
            const pages = await w.doc.copyPages(src, src.getPageIndices());
            let firstPage = true;
            for (const p of pages) { w.doc.addPage(p); w.pageNo++; if (firstPage) { p.drawText(`Attachment to message ${ap.n}: ${clean(ap.filename)}`, { x: 24, y: p.getHeight() - 20, size: 8, font: w.font, color: rgb(0.4, 0.4, 0.4) }); firstPage = false; } }
          } else if (ap.mime === "image/png" || ap.mime === "image/jpeg" || ap.mime === "image/jpg") {
            const img = ap.mime === "image/png" ? await w.doc.embedPng(ap.bytes) : await w.doc.embedJpg(ap.bytes);
            const page = w.doc.addPage([A4.w, A4.h]); w.pageNo++;
            const scale = Math.min((A4.w - 2 * M) / img.width, (A4.h - 2 * M - 20) / img.height, 1);
            page.drawText(`Attachment to message ${ap.n}: ${clean(ap.filename)}`, { x: M, y: A4.h - M, size: 9, font: w.font, color: rgb(0.4, 0.4, 0.4) });
            page.drawImage(img, { x: M, y: A4.h - M - 16 - img.height * scale, width: img.width * scale, height: img.height * scale });
          }
        } catch (e) { text(w, `Could not embed ${ap.filename}: ${e instanceof Error ? e.message : String(e)}. It is included in the archive.`, { size: 9, color: [0.6, 0.2, 0.2] }); }
      }
    }

    const pdfBytes = await w.doc.save();
    zip.file(`${safe(title)}.pdf`, pdfBytes);
    zip.file("index.csv", index.join("\n"));
    const zipBytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
    const pdfStorage = await ctx.storage.store(toBlob(pdfBytes, "application/pdf"));
    const zipStorage = await ctx.storage.store(toBlob(zipBytes, "application/zip"));
    const stamp = new Date().toISOString().slice(0, 10);
    const saved = await ctx.runMutation(internal.subpoenaData.saveOutputs, { userId: me._id, matterId: a.matterId, pdf: { name: `${title} — email export ${stamp}.pdf`, storageId: pdfStorage, size: pdfBytes.length, sha256: await sha256Hex(pdfBytes) }, zip: { name: `${title} — email export ${stamp}.zip`, storageId: zipStorage, size: zipBytes.length, sha256: await sha256Hex(zipBytes) }, detail: `${fetched.length} messages, ${a.excludedCount} excluded, ${appendix.length} attachments` });
    return { ...saved, pages: w.doc.getPageCount(), messages: fetched.length };
  },
});

const toBlob = (u8: Uint8Array, type: string) => { const ab = new ArrayBuffer(u8.byteLength); new Uint8Array(ab).set(u8); return new Blob([ab], { type }); };
const safe = (s: string) => clean(s).replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);

