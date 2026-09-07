/* eslint-disable @next/next/no-img-element -- overlays are local data URLs */
"use client";

import { useEffect, useRef, useState } from "react";
import type { Annotation, LoadedPdf } from "@/lib/pdf";
import { renderPage } from "@/lib/pdf";
import { cn } from "@/lib/utils";

export type Tool = "select" | "highlight" | "rect" | "redact" | "text" | "note" | "pen" | "image";
export type Field = { id: string; kind: "signature" | "initials" | "date" | "text"; page: number; x: number; y: number; w: number; h: number; label?: string; value?: string };

/**
 * One rendered page with an interactive overlay. Annotations and signature fields live in page fractions (0..1).
 * Dragging with a shape tool creates a box; the pen tool records points; select moves or deletes.
 */
export function PdfPage({ pdf, pageNo, rotation = 0, scale, tool, color, annotations, fields, selectedId, onSelect, onAdd, onChange, onRemove, onFieldClick, pending, readOnly }: {
  pdf: LoadedPdf; pageNo: number; rotation?: number; scale: number; tool: Tool; color: string; annotations: Annotation[]; fields?: Field[]; selectedId?: string | null;
  onSelect?: (id: string | null) => void; onAdd?: (a: Annotation) => void; onChange?: (a: Annotation) => void; onRemove?: (id: string) => void; onFieldClick?: (f: Field) => void; pending?: { kind: "image"; dataUrl: string; aspect: number } | null; readOnly?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [draft, setDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [penPts, setPenPts] = useState<Array<[number, number]> | null>(null);
  const dragging = useRef<{ id: string; dx: number; dy: number } | null>(null);
  useEffect(() => {
    let live = true;
    renderPage(pdf, pageNo, scale, rotation).then((c) => { if (!live || !host.current) return; host.current.querySelector("canvas")?.remove(); c.className = "block"; host.current.prepend(c); setSize({ w: c.width, h: c.height }); });
    return () => { live = false; };
  }, [pdf, pageNo, scale, rotation]);
  const frac = (e: React.PointerEvent) => { const r = host.current!.getBoundingClientRect(); return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }; };
  const idx = pageNo - 1;
  const onDown = (e: React.PointerEvent) => {
    if (readOnly || !onAdd) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-ann]") || target.closest("[data-field]")) return;
    const p = frac(e);
    if (tool === "select") { onSelect?.(null); return; }
    if (pending?.kind === "image") { const w = 0.28; const h = (w * (size?.w ?? 1)) / (size?.h ?? 1) / pending.aspect; onAdd({ id: crypto.randomUUID(), page: idx, kind: "image", x: p.x - w / 2, y: p.y - h / 2, w, h, dataUrl: pending.dataUrl }); return; }
    if (tool === "text" || tool === "note") { const text = prompt(tool === "note" ? "Note" : "Text"); if (text) onAdd({ id: crypto.randomUUID(), page: idx, kind: tool, x: p.x, y: p.y, w: 0.3, h: tool === "note" ? 0.08 : 0.04, text, color: tool === "note" ? "#6b5300" : color, size: 11 }); return; }
    if (tool === "pen") { setPenPts([[p.x, p.y]]); (e.target as HTMLElement).setPointerCapture(e.pointerId); return; }
    setDraft({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    const p = frac(e);
    if (dragging.current && onChange) { const a = annotations.find((x) => x.id === dragging.current!.id); if (a && "x" in a) onChange({ ...a, x: p.x - dragging.current.dx, y: p.y - dragging.current.dy }); return; }
    if (penPts) setPenPts([...penPts, [p.x, p.y]]);
    else if (draft) setDraft({ ...draft, x1: p.x, y1: p.y });
  };
  const onUp = () => {
    if (dragging.current) { dragging.current = null; return; }
    if (penPts && onAdd) { if (penPts.length > 2) onAdd({ id: crypto.randomUUID(), page: idx, kind: "pen", points: penPts, color, width: 2 }); setPenPts(null); return; }
    if (draft && onAdd) { const x = Math.min(draft.x0, draft.x1), y = Math.min(draft.y0, draft.y1), w = Math.abs(draft.x1 - draft.x0), h = Math.abs(draft.y1 - draft.y0); if (w > 0.01 && h > 0.005 && (tool === "highlight" || tool === "rect" || tool === "redact")) onAdd({ id: crypto.randomUUID(), page: idx, kind: tool, x, y, w, h, color: tool === "highlight" ? "#ffe066" : tool === "redact" ? "#000000" : color }); setDraft(null); }
  };
  const box = (a: { x: number; y: number; w: number; h: number }) => ({ left: `${a.x * 100}%`, top: `${a.y * 100}%`, width: `${a.w * 100}%`, height: `${a.h * 100}%` });
  return (
    <div ref={host} className={cn("relative mx-auto select-none bg-white shadow-md", tool !== "select" && !readOnly && "cursor-crosshair")} style={size ? { width: size.w, height: size.h } : { width: 600 * scale, height: 800 * scale }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}>
      <svg className="pointer-events-none absolute inset-0 h-full w-full">
        {annotations.filter((a) => a.page === idx && a.kind === "pen").map((a) => a.kind === "pen" && <polyline key={a.id} points={a.points.map(([x, y]) => `${x * (size?.w ?? 1)},${y * (size?.h ?? 1)}`).join(" ")} fill="none" stroke={a.color} strokeWidth={a.width * scale} strokeLinecap="round" strokeLinejoin="round" />)}
        {penPts && <polyline points={penPts.map(([x, y]) => `${x * (size?.w ?? 1)},${y * (size?.h ?? 1)}`).join(" ")} fill="none" stroke={color} strokeWidth={2 * scale} strokeLinecap="round" />}
        {draft && <rect x={Math.min(draft.x0, draft.x1) * (size?.w ?? 1)} y={Math.min(draft.y0, draft.y1) * (size?.h ?? 1)} width={Math.abs(draft.x1 - draft.x0) * (size?.w ?? 1)} height={Math.abs(draft.y1 - draft.y0) * (size?.h ?? 1)} fill={tool === "highlight" ? "#ffe06666" : tool === "redact" ? "#000a" : "none"} stroke={color} strokeDasharray="4 3" />}
      </svg>
      {annotations.filter((a) => a.page === idx && a.kind !== "pen").map((a) => {
        if (!("x" in a)) return null;
        const sel = selectedId === a.id;
        return (
          <div key={a.id} data-ann className={cn("absolute", !readOnly && "cursor-move", sel && "ring-2 ring-blue")} style={{ ...box(a), background: a.kind === "highlight" ? `${a.color}66` : a.kind === "redact" ? "#000" : a.kind === "note" ? "#fff3a0" : undefined, border: a.kind === "rect" ? `2px solid ${a.color}` : a.kind === "note" ? "1px solid #d9c34a" : undefined }} onPointerDown={(e) => { if (readOnly) return; e.stopPropagation(); onSelect?.(a.id); const p = frac(e); dragging.current = { id: a.id, dx: p.x - a.x, dy: p.y - a.y }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }} onPointerMove={onMove} onPointerUp={onUp} onDoubleClick={() => { if (!readOnly && onRemove && confirm("Remove this?")) onRemove(a.id); }}>
            {(a.kind === "text" || a.kind === "note") && <div className="overflow-hidden whitespace-pre-wrap px-[3px] leading-tight" style={{ color: a.color, fontSize: a.size * scale * 1.33 }}>{a.text}</div>}
            {a.kind === "image" && <img src={a.dataUrl} alt={a.label ?? "Signature"} className="h-full w-full object-contain" draggable={false} />}
            {sel && !readOnly && onRemove && <button type="button" onClick={(e) => { e.stopPropagation(); onRemove(a.id); }} className="absolute -right-2 -top-2 size-5 rounded-full bg-error text-[11px] leading-5 text-white" aria-label="Remove">×</button>}
          </div>
        );
      })}
      {(fields ?? []).filter((f) => f.page === idx).map((f) => (
        <button key={f.id} type="button" data-field onClick={(e) => { e.stopPropagation(); onFieldClick?.(f); }} className={cn("absolute flex items-center justify-center rounded border-2 border-dashed text-[11px] font-medium", f.value ? "border-success bg-success-soft" : "border-blue bg-blue-soft text-blue")} style={box(f)}>
          {f.value ? (f.kind === "signature" || f.kind === "initials" ? <img src={f.value} alt="" className="h-full w-full object-contain" /> : f.value) : (f.label ?? (f.kind === "signature" ? "Sign here" : f.kind === "initials" ? "Initials" : f.kind === "date" ? "Date" : "Text"))}
        </button>
      ))}
    </div>
  );
}
