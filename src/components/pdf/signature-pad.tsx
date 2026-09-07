/* eslint-disable @next/next/no-img-element -- signature previews are local data URLs */
"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { trimCanvas, typedSignature } from "@/lib/pdf";
import { cn } from "@/lib/utils";

/** Draw, type or reuse a saved signature. Returns a transparent PNG data URL. */
export function SignaturePad({ label, saved, defaultName, initials, onDone, onCancel, onSave }: { label: string; saved?: string; defaultName: string; initials?: boolean; onDone: (dataUrl: string) => void; onCancel: () => void; onSave?: (dataUrl: string) => void }) {
  const [mode, setMode] = useState<"draw" | "type" | "saved">(saved ? "saved" : "draw");
  const [typed, setTyped] = useState(initials ? defaultName.split(/\s+/).map((s) => s[0]).join("").toUpperCase() : defaultName);
  const [remember, setRemember] = useState(true);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);
  useEffect(() => { const c = canvas.current; if (!c) return; const ctx = c.getContext("2d")!; ctx.lineWidth = 2.4; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#14213d"; }, [mode]);
  const pos = (e: React.PointerEvent) => { const r = canvas.current!.getBoundingClientRect(); return { x: (e.clientX - r.left) * (canvas.current!.width / r.width), y: (e.clientY - r.top) * (canvas.current!.height / r.height) }; };
  const finish = () => {
    let url: string;
    if (mode === "saved" && saved) url = saved;
    else if (mode === "type") url = typedSignature(typed, initials);
    else { if (!hasInk.current) return; url = trimCanvas(canvas.current!); }
    if (remember && mode !== "saved") onSave?.(url);
    onDone(url);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-2xl bg-card p-5 shadow-float" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={label}>
        <h2 className="font-display text-xl">{label}</h2>
        <div className="mt-3 flex gap-1 rounded-full bg-muted p-0.5 text-xs">{(["draw", "type", ...(saved ? ["saved"] : [])] as const).map((m) => <button key={m} type="button" onClick={() => setMode(m as "draw" | "type" | "saved")} className={cn("h-7 flex-1 rounded-full capitalize", mode === m ? "bg-card shadow-xs" : "text-fg-tertiary")}>{m === "saved" ? "Use saved" : m}</button>)}</div>
        <div className="mt-3 rounded-xl border border-dashed border-border bg-white p-2">
          {mode === "draw" && <canvas ref={canvas} width={560} height={initials ? 160 : 200} className="h-auto w-full touch-none" onPointerDown={(e) => { drawing.current = true; hasInk.current = true; const ctx = canvas.current!.getContext("2d")!; const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); canvas.current!.setPointerCapture(e.pointerId); }} onPointerMove={(e) => { if (!drawing.current) return; const ctx = canvas.current!.getContext("2d")!; const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); }} onPointerUp={() => { drawing.current = false; }} />}
          {mode === "type" && <div className="flex flex-col items-center gap-2 py-4"><input value={typed} onChange={(e) => setTyped(e.target.value)} className="w-full border-b border-border bg-transparent text-center text-sm text-[#14213d] outline-none" /><span className="text-4xl italic text-[#14213d]" style={{ fontFamily: '"Snell Roundhand", "Brush Script MT", "Segoe Script", cursive' }}>{typed}</span></div>}
          {mode === "saved" && saved && <div className="flex justify-center py-3"><img src={saved} alt="Saved signature" className="max-h-24" /></div>}
        </div>
        <div className="mt-3 flex items-center gap-3">
          {mode === "draw" && <button type="button" onClick={() => { const c = canvas.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); hasInk.current = false; }} className="text-xs text-fg-tertiary hover:text-foreground">Clear</button>}
          {mode !== "saved" && onSave && <label className="flex items-center gap-1.5 text-xs text-fg-tertiary"><input type="checkbox" className="size-3.5 accent-foreground" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Save for next time</label>}
          <span className="ml-auto" />
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button onClick={finish}>Use this</Button>
        </div>
      </div>
    </div>
  );
}
