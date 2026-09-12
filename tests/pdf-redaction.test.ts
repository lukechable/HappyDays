// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { PDFDocument, StandardFonts } from "pdf-lib";
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", async importOriginal => {
  Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
  const actual = await importOriginal<typeof import("pdfjs-dist/legacy/build/pdf.mjs")>();
  return { ...actual, GlobalWorkerOptions: { set workerSrc(_value: string) { actual.GlobalWorkerOptions.workerSrc = import.meta.resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs"); } } };
});
import { flatten, openPdf } from "../src/lib/pdf";

test("saved redactions remove extractable text while preserving other pages", async () => {
  const originalCreate = document.createElement.bind(document);
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) => tag === "canvas" ? createCanvas(1, 1) : originalCreate(tag)) as typeof document.createElement);
  const source = await PDFDocument.create();
  const font = await source.embedFont(StandardFonts.Helvetica);
  source.addPage([300, 200]).drawText("SECRET-PATIENT", { x: 20, y: 120, size: 16, font });
  source.addPage([300, 200]).drawText("Keep this page", { x: 20, y: 120, size: 16, font });
  const output = await flatten(await source.save(), [{ id: "redact", kind: "redact", page: 0, x: 0, y: 0, w: 1, h: 1, color: "#000000" }]);
  const pdf = await openPdf(output);
  try {
    expect(pdf.pageCount).toBe(2);
    const redacted = await (await pdf.doc.getPage(1)).getTextContent();
    const retained = await (await pdf.doc.getPage(2)).getTextContent();
    expect(redacted.items).toEqual([]);
    expect(retained.items.map(i => "str" in i ? i.str : "").join("")).toContain("Keep this page");
  } finally { await pdf.doc.loadingTask.destroy(); vi.restoreAllMocks(); }
});
