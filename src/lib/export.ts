"use client";

/** Tabular export for any table in the app: CSV, Excel, PDF and print, all built in the browser. */
export type ExportColumn = { key: string; label: string; align?: "left" | "right"; width?: number };
export type ExportRow = Record<string, string | number | null | undefined>;
export type ExportTable = { title: string; subtitle?: string; filename: string; columns: ExportColumn[]; rows: ExportRow[] };

const cell = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v));

export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function exportCsv(t: ExportTable) {
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = [t.columns.map((c) => esc(c.label)).join(","), ...t.rows.map((r) => t.columns.map((c) => esc(cell(r[c.key]))).join(","))];
  downloadBlob(new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" }), `${t.filename}.csv`);
}

export async function exportXlsx(t: ExportTable) {
  const XLSX = await import("xlsx");
  const data = [t.columns.map((c) => c.label), ...t.rows.map((r) => t.columns.map((c) => { const v = r[c.key]; return v === null || v === undefined ? "" : v; }))];
  const ws = XLSX.utils.aoa_to_sheet(data);
  ws["!cols"] = t.columns.map((c) => ({ wch: c.width ?? Math.min(48, Math.max(c.label.length + 2, ...t.rows.slice(0, 200).map((r) => cell(r[c.key]).length + 2))) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, t.title.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
  const out = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  downloadBlob(new Blob([out], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${t.filename}.xlsx`);
}

/** Landscape A4, repeating header row, page numbers; the same table you see on screen. */
export async function exportPdf(t: ExportTable, open = false) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib"); // ~170 KB, loaded only when someone exports a PDF
  const doc = await PDFDocument.create();
  doc.setTitle(t.title); doc.setProducer("Happy Days");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 841.89, H = 595.28, M = 36, size = 8.5, lh = 14;
  const clean = (s: string) => s.replace(/[^\x09\x20-\x7e -ɏ‐-‧‰-⁞€]/g, "?");
  // Column widths proportional to content, bounded.
  const weights = t.columns.map((c) => Math.min(40, Math.max(c.label.length, ...t.rows.slice(0, 300).map((r) => cell(r[c.key]).length), 6)));
  const total = weights.reduce((a, b) => a + b, 0);
  const widths = weights.map((w) => ((W - 2 * M) * w) / total);
  const fit = (s: string, w: number) => { let out = clean(s); while (out.length > 1 && font.widthOfTextAtSize(out, size) > w - 6) out = out.slice(0, -2) + "…"; return out; };
  let page = doc.addPage([W, H]); let y = H - M; let pageNo = 1;
  const pages: import("pdf-lib").PDFPage[] = [page];
  const header = () => {
    page.drawText(clean(t.title), { x: M, y: y - 14, size: 14, font: bold });
    if (t.subtitle) page.drawText(clean(t.subtitle), { x: M, y: y - 28, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
    y -= t.subtitle ? 44 : 30;
    let x = M;
    t.columns.forEach((c, i) => { page.drawText(clean(c.label).toUpperCase(), { x: c.align === "right" ? x + widths[i] - 3 - bold.widthOfTextAtSize(clean(c.label).toUpperCase(), 7.5) : x + 3, y: y - 10, size: 7.5, font: bold, color: rgb(0.35, 0.35, 0.35) }); x += widths[i]; });
    y -= 14; page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: rgb(0.75, 0.75, 0.75) }); y -= 4;
  };
  header();
  for (const r of t.rows) {
    if (y - lh < M + 16) { page = doc.addPage([W, H]); pages.push(page); pageNo++; y = H - M; header(); }
    let x = M;
    t.columns.forEach((c, i) => { const s = fit(cell(r[c.key]), widths[i]); page.drawText(s, { x: c.align === "right" ? x + widths[i] - 3 - font.widthOfTextAtSize(s, size) : x + 3, y: y - 10, size, font }); x += widths[i]; });
    y -= lh; page.drawLine({ start: { x: M, y: y + 2 }, end: { x: W - M, y: y + 2 }, thickness: 0.3, color: rgb(0.9, 0.9, 0.9) });
  }
  pages.forEach((p, i) => p.drawText(`${clean(t.title)} · ${t.rows.length} rows · page ${i + 1} of ${pages.length} · ${new Date().toLocaleDateString("en-AU")}`, { x: M, y: 18, size: 7.5, font, color: rgb(0.45, 0.45, 0.45) }));
  void pageNo;
  const bytes = await doc.save();
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  if (open) window.open(URL.createObjectURL(blob), "_blank"); else downloadBlob(blob, `${t.filename}.pdf`);
}

/** Opens a clean print view of the table in a new window and triggers the print dialog. */
export function printTable(t: ExportTable) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(t.title)}</title><style>
    body{font:12px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;color:#1a1a1a;margin:24px}
    h1{font:400 20px Georgia,"Times New Roman",serif;margin:0 0 2px} p{margin:0 0 14px;color:#555}
    table{border-collapse:collapse;width:100%} th{text-align:left;font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:#666;border-bottom:1px solid #999;padding:4px 6px}
    td{padding:4px 6px;border-bottom:1px solid #e5e5e5;vertical-align:top} .r{text-align:right;font-variant-numeric:tabular-nums}
    @page{size:A4 landscape;margin:14mm} thead{display:table-header-group} tr{page-break-inside:avoid}
    footer{margin-top:12px;font-size:10px;color:#777}
  </style></head><body><h1>${esc(t.title)}</h1><p>${esc(t.subtitle ?? "")}</p><table><thead><tr>${t.columns.map((c) => `<th class="${c.align === "right" ? "r" : ""}">${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${t.rows.map((r) => `<tr>${t.columns.map((c) => `<td class="${c.align === "right" ? "r" : ""}">${esc(cell(r[c.key]))}</td>`).join("")}</tr>`).join("")}</tbody></table><footer>${t.rows.length} rows · Happy Days · ${new Date().toLocaleString("en-AU")}</footer><script>window.onload=function(){window.print()}</script></body></html>`;
  const w = window.open("", "_blank", "width=1100,height=800");
  if (!w) return;
  w.document.open(); w.document.write(html); w.document.close();
}
