/* eslint-disable @next/next/no-img-element -- thumbnails are local renders */
"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { replaceSearch, replaceUrl } from "@/lib/shallow";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { DndContext, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Upload, RotateCw, Trash2, Scissors, Merge, Save, Highlighter, Square, EyeOff, Type, StickyNote, Pen, PenLine, MousePointer2, Undo2, Mail, Send, X, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Empty, Loading, Pill, statusTone, DataTable, Panel } from "@/components/primitives";
import { PdfPage, type Tool, type Field } from "./pdf-viewer";
import { SignaturePad } from "./signature-pad";
import { openPdf, rebuildPages, mergePdfs, extractPages, flatten, dateStamp, renderPage, type LoadedPdf, type Annotation, type PageOp } from "@/lib/pdf";
import { fileToBase64, openCompose, sha256 } from "@/lib/compose-handoff";
import { cn, errorMessage } from "@/lib/utils";
import { siteUrl } from "@/lib/public-url";
import { ago, day } from "@/lib/format";

type Tab = "pages" | "markup" | "requests";

/**
 * PDF tools. Open a file from Files, upload one, or arrive from Mail with an attachment to sign. Pages: reorder,
 * rotate, delete, extract, merge. Markup: highlight, boxes, redaction, text, notes, pen, and your signature.
 * Requests: drop fields and send a signing link. Saving writes a new file (or version) to Files.
 */
export function PdfWorkbench() {
  const params = useSearchParams();
  const router = useRouter();
  const tab: Tab = params.get("tab") === "requests" ? "requests" : params.get("tab") === "markup" ? "markup" : "pages";
  const fileId = params.get("file") as Id<"files"> | null;
  const signUrl = params.get("sign");
  const signName = params.get("name") ?? "document.pdf";
  const replyTo = params.get("reply");
  const file = useQuery(api.files.get, fileId ? { id: fileId } : "skip");
  const me = useQuery(api.users.me);
  const updatePrefs = useMutation(api.users.updatePrefs);
  const uploadUrl = useMutation(api.files.uploadUrl);
  const register = useMutation(api.files.register);
  const updateFile = useMutation(api.files.update);
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [name, setName] = useState("document.pdf");
  const [sourceId, setSourceId] = useState<Id<"files"> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const setTab = (t: Tab) => replaceSearch("/pdf", { tab: t });

  const load = async (bytes: Uint8Array, n: string, src: Id<"files"> | null) => { try { setPdf(await openPdf(bytes)); setName(n); setSourceId(src); setError(null); setLoadingSource(false); } catch (e) { setError(errorMessage(e)); } };
  const [loadingSource, setLoadingSource] = useState(false);
  useEffect(() => {
    const url = file?.mime === "application/pdf" ? file.url : !fileId ? signUrl : null;
    if (!url) return;
    const controller = new AbortController();
    // Reset the document while synchronizing with a newly selected external PDF URL.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingSource(true); setError(null); setPdf(null);
    void (async () => {
      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error("Couldn’t load this PDF. Open the file again to retry.");
        const loaded = await openPdf(new Uint8Array(await response.arrayBuffer()));
        if (!controller.signal.aborted) { setPdf(loaded); setName(file?.name ?? signName); setSourceId(file?._id ?? null); }
      } catch (e) { if (!controller.signal.aborted) setError(errorMessage(e)); }
      finally { if (!controller.signal.aborted) setLoadingSource(false); }
    })();
    return () => controller.abort();
  }, [file?.url, file?.mime, file?.name, file?._id, fileId, signUrl, signName]);

  const saveBytes = async (bytes: Uint8Array, fileName: string, opts: { asVersion?: boolean; annotations?: unknown } = {}) => {
    setBusy("Saving");
    try {
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const url = await uploadUrl({});
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: blob });
      if (!res.ok) throw new Error("Couldn’t save the PDF. Please try again.");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      const id = await register({ storageId, name: fileName, mime: "application/pdf", size: bytes.length, sha256: await sha256(blob), replacesFileId: opts.asVersion && sourceId ? sourceId : undefined, matterId: file?.matterId });
      if (opts.annotations !== undefined) await updateFile({ id, annotations: opts.annotations });
      toast.success("Saved to Files", { action: { label: "Open", onClick: () => router.push(`/files/${id}`) } });
      return id;
    } catch (e) { toast.error(errorMessage(e)); return null; }
    finally { setBusy(null); }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:h-[calc(100svh_-_48px)] lg:flex-none">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <div className="flex gap-1 rounded-full bg-muted p-0.5 text-xs">{(["pages", "markup", "requests"] as const).map((t) => <button key={t} type="button" onClick={() => setTab(t)} className={cn("h-7 rounded-full px-3", tab === t ? "bg-card shadow-xs" : "text-fg-tertiary hover:text-foreground")}>{t === "pages" ? "Pages" : t === "markup" ? "Mark up & sign" : "Signature requests"}</button>)}</div>
        {pdf && tab !== "requests" && <span className="truncate text-sm font-medium">{name}<span className="num ml-2 text-xs text-fg-tertiary">{pdf.pageCount} pages</span></span>}
        <span className="ml-auto" />
        {tab !== "requests" && <><Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}><Upload className="size-3.5" />Open PDF</Button><input ref={inputRef} type="file" accept="application/pdf" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) { replaceSearch("/pdf", { file: undefined, sign: undefined, name: undefined, reply: undefined }); await load(new Uint8Array(await f.arrayBuffer()), f.name, null); } e.target.value = ""; }} /><FilePicker onPick={(id) => replaceUrl(`/pdf?file=${id}&tab=${tab}`)} /></>}
        {busy && <span className="text-xs text-fg-tertiary">{busy}…</span>}
      </div>
      {error && <p className="px-4 py-2 text-sm text-error">{error}</p>}
      {(fileId && file === undefined) || loadingSource ? <Loading rows={5} /> : fileId && file === null ? <Empty title="File not found" action={<Button render={<Link href="/files" />}>Open Files</Button>} /> : file && file.mime !== "application/pdf" ? <Empty title="This file is not a PDF" action={<Button render={<Link href={`/files/${file._id}`} />}>Open file</Button>} /> : tab === "requests" ? <RequestsTab pdf={pdf} name={name} sourceId={sourceId} fileMatterId={file?.matterId} onSaveBytes={saveBytes} /> : !pdf ? (
        <div className="p-8"><Empty title="Open a PDF to begin" body="Pick one from Files, upload from your computer, or click Sign on a PDF attachment in Mail." action={<div className="flex gap-2"><Button variant="outline" onClick={() => inputRef.current?.click()}>Upload</Button><Button variant="outline" render={<Link href="/files" />}>Files</Button></div>} /></div>
      ) : tab === "pages" ? <PagesTab pdf={pdf} name={name} onReplace={(bytes, n) => load(bytes, n, sourceId)} onSave={(bytes, n, asVersion) => saveBytes(bytes, n, { asVersion })} /> : (
        <MarkupTab pdf={pdf} name={name} me={me} savedSignature={me?.prefs.signatureImage} savedInitials={me?.prefs.initialsImage} onSaveSignature={(kind, url) => updatePrefs({ prefs: kind === "signature" ? { signatureImage: url } : { initialsImage: url } })} initialAnnotations={(file?.annotations as Annotation[] | undefined) ?? []} onSave={async (bytes, n, annotations, asVersion) => saveBytes(bytes, n, { asVersion, annotations })} replyTo={replyTo} />
      )}
    </div>
  );
}

function FilePicker({ onPick }: { onPick: (id: Id<"files">) => void }) {
  const files = useQuery(api.files.list, {});
  const pdfs = (files ?? []).filter((f) => f.mime === "application/pdf");
  return <select className="h-8 max-w-[220px] rounded-lg border border-input bg-card px-2 text-xs" defaultValue="" onChange={(e) => { if (e.target.value) onPick(e.target.value as Id<"files">); e.target.value = ""; }}><option value="">From Files…</option>{pdfs.map((f) => <option key={f._id} value={f._id}>{f.name}</option>)}</select>;
}

/* ------------------------------ pages ------------------------------ */

function PagesTab({ pdf, name, onReplace, onSave }: { pdf: LoadedPdf; name: string; onReplace: (bytes: Uint8Array, name: string) => void; onSave: (bytes: Uint8Array, name: string, asVersion: boolean) => Promise<unknown> }) {
  const [ops, setOps] = useState<PageOp[]>(() => Array.from({ length: pdf.pageCount }, (_, i) => ({ sourceIndex: i, rotate: 0 })));
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [history, setHistory] = useState<PageOp[][]>([]);
  const [thumbs, setThumbs] = useState<Record<number, string>>({});
  const mergeInput = useRef<HTMLInputElement>(null);
  useEffect(() => { setOps(Array.from({ length: pdf.pageCount }, (_, i) => ({ sourceIndex: i, rotate: 0 }))); setSelected(new Set()); setHistory([]); setThumbs({}); }, [pdf]); // eslint-disable-line react-hooks/set-state-in-effect
  useEffect(() => {
    let live = true;
    (async () => { for (let i = 1; i <= pdf.pageCount; i++) { if (!live) return; const c = await renderPage(pdf, i, 0.25); if (live) setThumbs((t) => ({ ...t, [i - 1]: c.toDataURL("image/jpeg", 0.7) })); } })();
    return () => { live = false; };
  }, [pdf]);
  const apply = (next: PageOp[]) => { setHistory((h) => [...h.slice(-20), ops]); setOps(next); };
  const undo = () => { const prev = history.at(-1); if (prev) { setHistory((h) => h.slice(0, -1)); setOps(prev); } };
  const changed = history.length > 0;
  const onDragEnd = (e: DragEndEvent) => { if (!e.over || e.active.id === e.over.id) return; const from = ops.findIndex((_, i) => String(i) === e.active.id); const to = ops.findIndex((_, i) => String(i) === e.over!.id); apply(arrayMove(ops, from, to)); };
  const rotateSel = () => apply(ops.map((o, i) => (selected.has(i) ? { ...o, rotate: (o.rotate + 90) % 360 } : o)));
  const deleteSel = () => { if (!selected.size) return; apply(ops.filter((_, i) => !selected.has(i))); setSelected(new Set()); };
  const extract = async () => { if (!selected.size) return; const bytes = await extractPages(pdf.bytes, Array.from(selected).sort((a, b) => a - b).map((i) => ops[i].sourceIndex)); await onSave(bytes, name.replace(/\.pdf$/i, "") + ` (pages ${Array.from(selected).sort((a, b) => a - b).map((i) => i + 1).join(",")}).pdf`, false); };
  const build = () => rebuildPages(pdf.bytes, ops);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-3 py-1.5 text-xs">
        <span className="num text-fg-tertiary">{selected.size} selected</span>
        <Button size="xs" variant="ghost" onClick={() => setSelected(selected.size === ops.length ? new Set() : new Set(ops.map((_, i) => i)))}>{selected.size === ops.length ? "None" : "All"}</Button>
        <div className="mx-1 h-4 w-px bg-border" />
        <Button size="xs" variant="ghost" disabled={!selected.size} onClick={rotateSel}><RotateCw className="size-3.5" />Rotate</Button>
        <Button size="xs" variant="ghost" disabled={!selected.size} onClick={deleteSel}><Trash2 className="size-3.5" />Delete</Button>
        <Button size="xs" variant="ghost" disabled={!selected.size} onClick={extract}><Scissors className="size-3.5" />Extract to new file</Button>
        <Button size="xs" variant="ghost" onClick={() => mergeInput.current?.click()}><Merge className="size-3.5" />Append PDF…</Button>
        <input ref={mergeInput} type="file" accept="application/pdf" multiple hidden onChange={async (e) => { const files = Array.from(e.target.files ?? []); if (!files.length) return; const current = await build(); const merged = await mergePdfs([current, ...(await Promise.all(files.map(async (f) => new Uint8Array(await f.arrayBuffer()))))]); onReplace(merged, name); e.target.value = ""; toast.success(`Appended ${files.length} file${files.length === 1 ? "" : "s"}`); }} />
        <Button size="xs" variant="ghost" disabled={!history.length} onClick={undo}><Undo2 className="size-3.5" />Undo</Button>
        <span className="ml-auto" />
        <Button size="sm" variant="outline" disabled={!changed} onClick={async () => onSave(await build(), name, true)}><Save className="size-3.5" />Save as new version</Button>
        <Button size="sm" disabled={!changed} onClick={async () => onSave(await build(), name.replace(/\.pdf$/i, "") + " (edited).pdf", false)}><Save className="size-3.5" />Save as new file</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={ops.map((_, i) => String(i))} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
              {ops.map((o, i) => <Thumb key={`${o.sourceIndex}-${i}`} id={String(i)} index={i} src={thumbs[o.sourceIndex]} rotate={o.rotate} selected={selected.has(i)} onToggle={(shift) => setSelected((s) => { const n = new Set(shift ? s : []); if (!shift && s.has(i) && s.size === 1) return new Set(); if (n.has(i)) n.delete(i); else n.add(i); return n; })} />)}
            </div>
          </SortableContext>
        </DndContext>
        <p className="mt-4 text-xs text-fg-quaternary">Drag pages to reorder. Click to select, shift-click for several. Changes are applied when you save.</p>
      </div>
    </div>
  );
}

function Thumb({ id, index, src, rotate, selected, onToggle }: { id: string; index: number; src?: string; rotate: number; selected: boolean; onToggle: (shift: boolean) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} {...attributes} {...listeners} onClick={(e) => onToggle(e.shiftKey)} className={cn("cursor-grab rounded-lg bg-card p-2 ring-1 ring-black/[0.06] dark:ring-white/10", selected && "ring-2 ring-blue", isDragging && "opacity-60")}>
      <div className="flex aspect-[3/4] items-center justify-center overflow-hidden rounded bg-muted">{src ? <img src={src} alt={`Page ${index + 1}`} className="max-h-full max-w-full" style={{ transform: `rotate(${rotate}deg)` }} draggable={false} /> : <span className="text-xs text-fg-quaternary">…</span>}</div>
      <div className="num mt-1 text-center text-[11px] text-fg-tertiary">{index + 1}{rotate ? ` · ${rotate}°` : ""}</div>
    </div>
  );
}

/* ------------------------------ markup & sign ------------------------------ */

const COLORS = ["#fb494f", "#0081f2", "#25ba3b", "#efa201", "#1a1a1a"];

function MarkupTab({ pdf, name, me, savedSignature, savedInitials, onSaveSignature, initialAnnotations, onSave, replyTo }: { pdf: LoadedPdf; name: string; me: { name: string; email: string } | null | undefined; savedSignature?: string; savedInitials?: string; onSaveSignature: (kind: "signature" | "initials", url: string) => void; initialAnnotations: Annotation[]; onSave: (bytes: Uint8Array, name: string, annotations: Annotation[], asVersion: boolean) => Promise<unknown>; replyTo: string | null }) {
  const router = useRouter();
  const [tool, setTool] = useState<Tool>("select");
  const [color, setColor] = useState(COLORS[1]);
  const [scale, setScale] = useState(1.1);
  const [annotations, setAnnotations] = useState<Annotation[]>(initialAnnotations);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pad, setPad] = useState<"signature" | "initials" | null>(null);
  const [pending, setPending] = useState<{ kind: "image"; dataUrl: string; aspect: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const place = (dataUrl: string) => { const img = new Image(); img.onload = () => { setPending({ kind: "image", dataUrl, aspect: img.width / img.height }); setTool("image"); toast.message("Click on the page to place it"); }; img.src = dataUrl; };
  const addDate = () => { setTool("text"); toast.message("Click where the date should go"); setPendingText(dateStamp()); };
  const [pendingText, setPendingText] = useState<string | null>(null);
  const onAdd = (a: Annotation) => { if (a.kind === "text" && pendingText) { a = { ...a, text: pendingText, size: 11, color: "#14213d" }; setPendingText(null); } setAnnotations((x) => [...x, a]); if (pending) { setPending(null); setTool("select"); } setSelectedId(a.id); };
  const exportBytes = () => flatten(pdf.bytes, annotations);
  const signAndReply = async () => {
    setBusy(true);
    try {
      const bytes = await exportBytes();
      const signed = name.replace(/\.pdf$/i, "") + " (signed).pdf";
      const base64 = await fileToBase64(new Blob([bytes as BlobPart]));
      openCompose(router, { mode: "new", subject: `Signed: ${name}`, html: `<p>Please find the signed document attached.</p>`, initialAttachments: [{ filename: signed, mime: "application/pdf", base64, size: bytes.length }] });
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const tools: Array<[Tool, React.ReactNode, string]> = [["select", <MousePointer2 key="s" className="size-4" />, "Select / move"], ["highlight", <Highlighter key="h" className="size-4" />, "Highlight"], ["rect", <Square key="r" className="size-4" />, "Box"], ["redact", <EyeOff key="x" className="size-4" />, "Redact (black out)"], ["text", <Type key="t" className="size-4" />, "Text"], ["note", <StickyNote key="n" className="size-4" />, "Sticky note"], ["pen", <Pen key="p" className="size-4" />, "Pen"]];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-3 py-1.5">
        {tools.map(([t, icon, label]) => <button key={t} type="button" title={label} aria-label={label} onClick={() => { setTool(t); setPending(null); }} className={cn("inline-flex size-8 items-center justify-center rounded-lg", tool === t ? "bg-foreground text-background" : "text-fg-secondary hover:bg-muted")}>{icon}</button>)}
        <div className="mx-1 flex items-center gap-1">{COLORS.map((c) => <button key={c} type="button" aria-label={c} onClick={() => setColor(c)} className={cn("size-5 rounded-full ring-offset-2 ring-offset-background", color === c && "ring-2 ring-foreground")} style={{ background: c }} />)}</div>
        <div className="mx-1 h-5 w-px bg-border" />
        <Button size="xs" variant="outline" onClick={() => setPad("signature")}><PenLine className="size-3.5" />Signature</Button>
        <Button size="xs" variant="outline" onClick={() => setPad("initials")}>Initials</Button>
        <Button size="xs" variant="outline" onClick={addDate}><CalendarDays className="size-3.5" />Date</Button>
        <Button size="xs" variant="ghost" disabled={!annotations.length} onClick={() => { setAnnotations((a) => a.slice(0, -1)); }}><Undo2 className="size-3.5" />Undo</Button>
        <span className="ml-auto" />
        <div className="flex items-center gap-1 text-xs"><button type="button" onClick={() => setScale((s) => Math.max(0.5, s - 0.15))} className="rounded px-1.5 hover:bg-muted">−</button><span className="num w-10 text-center">{Math.round(scale * 100)}%</span><button type="button" onClick={() => setScale((s) => Math.min(2.5, s + 0.15))} className="rounded px-1.5 hover:bg-muted">+</button></div>
        {replyTo && <Button size="sm" disabled={busy || !annotations.length} onClick={signAndReply}><Mail className="size-3.5" />Sign and email</Button>}
        <Button size="sm" variant="outline" disabled={!annotations.length || busy} onClick={async () => onSave(await exportBytes(), name, annotations, true)}><Save className="size-3.5" />Save version</Button>
        <Button size="sm" disabled={!annotations.length || busy} onClick={async () => onSave(await exportBytes(), name.replace(/\.pdf$/i, "") + (annotations.some((a) => a.kind === "image") ? " (signed).pdf" : " (marked up).pdf"), annotations, false)}><Save className="size-3.5" />Save as new file</Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-surface-2/60 p-4">
        <div className="space-y-4">{Array.from({ length: pdf.pageCount }, (_, i) => <PdfPage key={i} pdf={pdf} pageNo={i + 1} scale={scale} tool={tool} color={color} annotations={annotations} selectedId={selectedId} onSelect={setSelectedId} onAdd={onAdd} onChange={(a) => setAnnotations((x) => x.map((y) => (y.id === a.id ? a : y)))} onRemove={(id) => setAnnotations((x) => x.filter((y) => y.id !== id))} pending={pending} />)}</div>
        <p className="mt-4 text-xs text-fg-quaternary">Double-click a mark to remove it. Redactions are burned in as solid black when you save. Nothing is uploaded until you save.</p>
      </div>
      {pad && <SignaturePad label={pad === "signature" ? "Your signature" : "Your initials"} initials={pad === "initials"} saved={pad === "signature" ? savedSignature : savedInitials} defaultName={me?.name ?? ""} onCancel={() => setPad(null)} onSave={(url) => onSaveSignature(pad, url)} onDone={(url) => { setPad(null); place(url); }} />}
    </div>
  );
}

/* ------------------------------ signature requests ------------------------------ */

function RequestsTab({ pdf, name, sourceId, fileMatterId, onSaveBytes }: { pdf: LoadedPdf | null; name: string; sourceId: Id<"files"> | null; fileMatterId?: Id<"matters">; onSaveBytes: (bytes: Uint8Array, name: string) => Promise<Id<"files"> | null> }) {
  const params = useSearchParams();
  const matterId = params.get("matter") as Id<"matters"> | null;
  const requests = useQuery(api.signatures.list, { matterId: matterId ?? undefined });
  const create = useMutation(api.signatures.create);
  const cancel = useMutation(api.signatures.cancel);
  const router = useRouter();
  const [building, setBuilding] = useState(false);
  const [fields, setFields] = useState<Field[]>([]);
  const [fieldKind, setFieldKind] = useState<Field["kind"]>("signature");
  const [signer, setSigner] = useState({ name: "", email: "", message: "" });
  const [scale] = useState(0.9);
  const site = siteUrl();
  const send = async () => {
    if (!pdf) return;
    if (!signer.name.trim() || !signer.email.trim()) { toast.error("Who is signing?"); return; }
    let fileId = sourceId;
    if (!fileId) { fileId = await onSaveBytes(pdf.bytes, name); if (!fileId) return; }
    try {
      const r = await create({ fileId, signerName: signer.name, signerEmail: signer.email, message: signer.message || undefined, fields: fields.map(({ id, kind, page, x, y, w, h, label }) => ({ id, kind, page, x, y, w, h, label })), matterId: fileMatterId });
      setBuilding(false); setFields([]);
      const link = `${site}/sign/${r.token}`;
      toast.success("Signature request created");
      openCompose(router, { mode: "new", to: [{ name: signer.name, email: signer.email }], subject: `Please sign: ${name}`, html: `<p>Hello ${signer.name.split(" ")[0]},</p><p>${signer.message ? signer.message + "</p><p>" : ""}Please review and sign <b>${name}</b> using this link:</p><p><a href="${link}">${link}</a></p><p>The link is personal to you and expires in 30 days. No account is needed.</p>` });
    } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
      {building && pdf ? (
        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <Panel title="Signer" dense>
            <div className="space-y-2 text-sm">
              <input value={signer.name} onChange={(e) => setSigner({ ...signer, name: e.target.value })} placeholder="Full name" className="h-9 w-full rounded-lg border border-input bg-card px-2" />
              <input value={signer.email} onChange={(e) => setSigner({ ...signer, email: e.target.value })} placeholder="Email" type="email" className="h-9 w-full rounded-lg border border-input bg-card px-2" />
              <textarea value={signer.message} onChange={(e) => setSigner({ ...signer, message: e.target.value })} placeholder="Message (optional)" rows={3} className="w-full rounded-lg border border-input bg-card px-2 py-1" />
              <div><div className="text-xs text-fg-tertiary">Click a page to place a field</div><div className="mt-1 flex flex-wrap gap-1">{(["signature", "initials", "date", "text"] as const).map((k) => <button key={k} type="button" onClick={() => setFieldKind(k)} className={cn("rounded-full px-2.5 py-1 text-xs capitalize", fieldKind === k ? "bg-foreground text-background" : "bg-muted text-fg-secondary")}>{k}</button>)}</div></div>
              <ul className="space-y-1 text-xs">{fields.map((f, i) => <li key={f.id} className="flex items-center gap-2"><span className="capitalize">{f.kind}</span><span className="text-fg-tertiary">page {f.page + 1}</span><button type="button" onClick={() => setFields((x) => x.filter((y) => y.id !== f.id))} className="ml-auto text-fg-quaternary hover:text-error" aria-label="Remove field"><X className="size-3.5" /></button><span className="sr-only">{i}</span></li>)}</ul>
              <div className="flex gap-2 pt-1"><Button size="sm" disabled={!fields.some((f) => f.kind === "signature")} onClick={send}><Send className="size-3.5" />Create email draft</Button><Button size="sm" variant="ghost" onClick={() => { setBuilding(false); setFields([]); }}>Cancel</Button></div>
            </div>
          </Panel>
          <div className="min-h-0 overflow-auto rounded-2xl bg-surface-2/60 p-4"><div className="space-y-4">{Array.from({ length: pdf.pageCount }, (_, i) => <div key={i} onClickCapture={(e) => { const host = (e.currentTarget.firstElementChild as HTMLElement | null); if (!host || (e.target as HTMLElement).closest("[data-field]")) return; const r = host.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width; const y = (e.clientY - r.top) / r.height; const w = fieldKind === "initials" ? 0.1 : fieldKind === "date" ? 0.16 : 0.28; const h = fieldKind === "initials" ? 0.05 : 0.06; setFields((f) => [...f, { id: crypto.randomUUID(), kind: fieldKind, page: i, x: Math.max(0, x - w / 2), y: Math.max(0, y - h / 2), w, h }]); }}><PdfPage pdf={pdf} pageNo={i + 1} scale={scale} tool="select" color="#0081f2" annotations={[]} fields={fields} readOnly onFieldClick={(f) => setFields((x) => x.filter((y) => y.id !== f.id))} /></div>)}</div></div>
        </div>
      ) : (
        <Panel title={<>Signature requests{matterId && <Button size="xs" variant="ghost" onClick={() => replaceSearch("/pdf", { matter: undefined })}>Clear matter filter</Button>}</>} blurb="The signer gets a private link, signs in the browser, and you both receive the completed PDF with an audit page." actions={<Button size="sm" disabled={!pdf} onClick={() => setBuilding(true)}><Send className="size-3.5" />{pdf ? `Request a signature on ${name}` : "Open a PDF first"}</Button>}>
          {requests === undefined ? <Loading rows={3} /> : requests.length === 0 ? <Empty title="No signature requests yet" body="Open a PDF, place the fields, and send the link." /> : (
            <DataTable head={<><th>Document</th><th>Signer</th><th>Status</th><th>Sent</th><th></th></>} minWidth={620}>
              {requests.map((r) => <tr key={r._id}><td className="font-medium">{r.fileName}{r.matterName && <div className="text-xs text-fg-tertiary">{r.matterName}</div>}</td><td>{r.signerName}<div className="text-xs text-fg-tertiary">{r.signerEmail}</div></td><td><Pill tone={statusTone(r.status)}>{r.status}</Pill>{r.status === "signed" && r.audit.at(-1) && <div className="text-[11px] text-fg-tertiary">{day(r.audit.at(-1)!.at)}</div>}</td><td className="text-xs text-fg-tertiary">{ago(r.createdAt)} by {r.createdByName}</td><td><div className="flex justify-end gap-1">{r.signedFileId && <Button size="xs" variant="outline" render={<Link href={`/files/${r.signedFileId}`} />}>Signed PDF</Button>}{(r.status === "sent" || r.status === "viewed") && <><Button size="xs" variant="ghost" onClick={() => { void navigator.clipboard.writeText(`${site}/sign/${r.token}`); toast.success("Link copied"); }}>Copy link</Button><Button size="xs" variant="ghost" onClick={() => cancel({ id: r._id })}>Cancel</Button></>}</div></td></tr>)}
            </DataTable>
          )}
        </Panel>
      )}
    </div>
  );
}
