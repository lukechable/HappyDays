"use client";

import { PDFDocument, degrees, rgb, StandardFonts } from "pdf-lib";

/**
 * Browser-side PDF work. pdf.js renders pages to canvases for the workbench; pdf-lib rewrites the document
 * (reorder, rotate, delete, merge, split, flatten annotations and signatures). Nothing leaves the browser until
 * the user saves, and then only to the practice's own Files.
 */

type PdfJs = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfJs> | null = null;
export function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) pdfjsPromise = import("pdfjs-dist").then((lib) => { lib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString(); return lib; });
  return pdfjsPromise;
}

export type LoadedPdf = { doc: import("pdfjs-dist").PDFDocumentProxy; pageCount: number; bytes: Uint8Array };

export async function openPdf(bytes: Uint8Array): Promise<LoadedPdf> {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  return { doc, pageCount: doc.numPages, bytes };
}

/** Render one page (1-based) at a scale into a fresh canvas. */
export async function renderPage(pdf: LoadedPdf, pageNo: number, scale: number, rotation = 0): Promise<HTMLCanvasElement> {
  const page = await pdf.doc.getPage(pageNo);
  const viewport = page.getViewport({ scale, rotation: (page.rotate + rotation) % 360 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  await page.render({ canvasContext: canvas.getContext("2d")!, viewport, canvas }).promise;
  return canvas;
}

export async function pageSize(pdf: LoadedPdf, pageNo: number): Promise<{ width: number; height: number; rotate: number }> {
  const page = await pdf.doc.getPage(pageNo);
  const vp = page.getViewport({ scale: 1 });
  return { width: vp.width, height: vp.height, rotate: page.rotate };
}

/* ------------------------------ page operations (pdf-lib) ------------------------------ */

export type PageOp = { sourceIndex: number; rotate: number };

/** Rebuild the document from an ordered list of (source page, extra rotation). Deleted pages are simply omitted. */
export async function rebuildPages(bytes: Uint8Array, ops: PageOp[]): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, ops.map((o) => o.sourceIndex));
  pages.forEach((p, i) => { if (ops[i].rotate) p.setRotation(degrees((p.getRotation().angle + ops[i].rotate) % 360)); out.addPage(p); });
  return out.save();
}

export async function mergePdfs(parts: Uint8Array[]): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const bytes of parts) { const src = await PDFDocument.load(bytes, { ignoreEncryption: true }); const pages = await out.copyPages(src, src.getPageIndices()); pages.forEach((p) => out.addPage(p)); }
  return out.save();
}

export async function extractPages(bytes: Uint8Array, indices: number[]): Promise<Uint8Array> {
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  pages.forEach((p) => out.addPage(p));
  return out.save();
}

/* ------------------------------ annotations ------------------------------ */

/** Coordinates are fractions of the page (0..1 from the top-left) so they survive zoom and rotation. */
export type Annotation =
  | { id: string; page: number; kind: "highlight" | "rect" | "redact"; x: number; y: number; w: number; h: number; color: string }
  | { id: string; page: number; kind: "text" | "note"; x: number; y: number; w: number; h: number; text: string; color: string; size: number }
  | { id: string; page: number; kind: "pen"; points: Array<[number, number]>; color: string; width: number }
  | { id: string; page: number; kind: "image"; x: number; y: number; w: number; h: number; dataUrl: string; label?: string };

const hex = (c: string): [number, number, number] => { const m = c.replace("#", ""); const n = parseInt(m.length === 3 ? m.split("").map((x) => x + x).join("") : m, 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

/** Burn annotations into the PDF. Redactions are drawn as opaque black boxes over the content. */
export async function flatten(bytes: Uint8Array, annotations: Annotation[]): Promise<Uint8Array> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  for (const a of annotations) {
    const page = pages[a.page];
    if (!page) continue;
    const { width: W, height: H } = page.getSize();
    const toPdf = (fx: number, fy: number) => ({ x: fx * W, y: H - fy * H });
    if (a.kind === "highlight" || a.kind === "rect" || a.kind === "redact") {
      const p = toPdf(a.x, a.y); const w = a.w * W; const h = a.h * H;
      if (a.kind === "highlight") page.drawRectangle({ x: p.x, y: p.y - h, width: w, height: h, color: rgb(...hex(a.color)), opacity: 0.35 });
      else if (a.kind === "redact") page.drawRectangle({ x: p.x, y: p.y - h, width: w, height: h, color: rgb(0, 0, 0) });
      else page.drawRectangle({ x: p.x, y: p.y - h, width: w, height: h, borderColor: rgb(...hex(a.color)), borderWidth: 1.5 });
    } else if (a.kind === "text" || a.kind === "note") {
      const p = toPdf(a.x, a.y); const w = a.w * W;
      if (a.kind === "note") page.drawRectangle({ x: p.x, y: p.y - a.h * H, width: w, height: a.h * H, color: rgb(1, 0.95, 0.6), borderColor: rgb(0.85, 0.75, 0.2), borderWidth: 0.5 });
      const size = a.size; const lines: string[] = [];
      for (const para of a.text.split("\n")) { let line = ""; for (const word of para.split(" ")) { const t = line ? `${line} ${word}` : word; if (font.widthOfTextAtSize(t, size) <= w - 6) line = t; else { lines.push(line); line = word; } } lines.push(line); }
      lines.forEach((l, i) => page.drawText(l, { x: p.x + 3, y: p.y - size - 3 - i * (size + 2), size, font, color: rgb(...hex(a.color)) }));
    } else if (a.kind === "pen") {
      if (a.points.length < 2) continue;
      const pts = a.points.map(([x, y]) => toPdf(x, y));
      const path = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
      page.drawSvgPath(path, { borderColor: rgb(...hex(a.color)), borderWidth: a.width, x: 0, y: H });
    } else if (a.kind === "image") {
      const p = toPdf(a.x, a.y);
      const bin = Uint8Array.from(atob(a.dataUrl.split(",")[1] ?? ""), (c) => c.charCodeAt(0));
      const img = a.dataUrl.startsWith("data:image/jpeg") ? await doc.embedJpg(bin) : await doc.embedPng(bin);
      page.drawImage(img, { x: p.x, y: p.y - a.h * H, width: a.w * W, height: a.h * H });
    }
  }
  return doc.save();
}

/** Signature pad output → tight-cropped transparent PNG data URL. */
export function trimCanvas(canvas: HTMLCanvasElement): string {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (data[(y * width + x) * 4 + 3] > 10) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  if (maxX <= minX || maxY <= minY) return canvas.toDataURL("image/png");
  const out = document.createElement("canvas");
  const pad = 6; out.width = maxX - minX + pad * 2; out.height = maxY - minY + pad * 2;
  out.getContext("2d")!.drawImage(canvas, minX - pad, minY - pad, out.width, out.height, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

/** Typed signature → PNG data URL in a script face. */
export function typedSignature(text: string, initials = false): string {
  const c = document.createElement("canvas");
  const size = initials ? 64 : 56;
  const ctx = c.getContext("2d")!;
  ctx.font = `italic ${size}px "Snell Roundhand", "Brush Script MT", "Segoe Script", "URW Chancery L", cursive`;
  c.width = Math.ceil(ctx.measureText(text).width) + 40; c.height = size * 1.6;
  const ctx2 = c.getContext("2d")!;
  ctx2.font = `italic ${size}px "Snell Roundhand", "Brush Script MT", "Segoe Script", "URW Chancery L", cursive`;
  ctx2.fillStyle = "#14213d"; ctx2.textBaseline = "middle"; ctx2.fillText(text, 20, c.height / 2);
  return trimCanvas(c);
}

export const dateStamp = () => new Date().toLocaleDateString("en-AU", { day: "2-digit", month: "2-digit", year: "numeric" });
