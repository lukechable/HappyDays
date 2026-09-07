"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import { Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, Link2, Paperclip, Sparkles, Trash2, X, Minus, Maximize2, Minimize2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { cn, errorMessage } from "@/lib/utils";
import { bytes } from "@/lib/format";
import type { Address } from "../../../convex/lib/gmail";

export type ComposeDraft = {
  mode: "new" | "reply" | "replyAll" | "forward" | "draft";
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  html: string;
  gmailThreadId?: string;
  inReplyTo?: string;
  references?: string[];
  draftId?: string;
  forwardAttachments?: Array<{ gmailMessageId: string; attachmentId: string; filename: string; mime: string; size: number }>;
  /** Files attached before the window opens (signed PDFs from the PDF tools). */
  initialAttachments?: Array<{ filename: string; mime: string; base64: string; size: number }>;
  /** Source message text, for "Suggest a reply". */
  sourceText?: string;
  sourceFrom?: string;
  matterId?: string;
};

type LocalFile = { file: File; base64?: string };
const MAX_TOTAL = 20 * 1024 * 1024;

const AddressChips = ({ label, value, onChange, autoFocus }: { label: string; value: Address[]; onChange: (v: Address[]) => void; autoFocus?: boolean }) => {
  const [text, setText] = useState("");
  const suggestions = useQuery(api.mail.contacts, text.trim().length >= 2 ? { q: text } : "skip") ?? [];
  const add = (raw: string) => {
    const parts = raw.split(/[,;\s]+/).filter(Boolean);
    const next = [...value];
    for (const p of parts) { const email = p.replace(/^<|>$/g, "").toLowerCase(); if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) && !next.some((a) => a.email === email)) next.push({ name: email.split("@")[0], email }); }
    onChange(next); setText("");
  };
  return (
    <div className="flex min-h-9 flex-wrap items-center gap-1 border-b border-border px-1 py-1 text-sm">
      <span className="w-10 shrink-0 text-xs text-fg-tertiary">{label}</span>
      {value.map((a) => <span key={a.email} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs" title={a.email}>{a.name && a.name !== a.email ? a.name : a.email}<button type="button" aria-label={`Remove ${a.email}`} onClick={() => onChange(value.filter((x) => x.email !== a.email))} className="text-fg-tertiary hover:text-foreground"><X className="size-3" /></button></span>)}
      <div className="relative min-w-[160px] flex-1">
        <input autoFocus={autoFocus} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if ((e.key === "Enter" || e.key === "," || e.key === "Tab") && text.trim()) { e.preventDefault(); add(text); } if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1)); }} onBlur={() => text.trim() && add(text)} className="w-full bg-transparent px-1 py-0.5 outline-none" placeholder={value.length ? "" : "name@example.com"} />
        {suggestions.length > 0 && text && (
          <ul className="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg bg-popover p-1 shadow-md ring-1 ring-border">
            {suggestions.map((s) => <li key={s.email}><button type="button" onMouseDown={(e) => { e.preventDefault(); onChange([...value, { name: s.name, email: s.email }]); setText(""); }} className="block w-full truncate rounded-md px-2 py-1 text-left text-sm hover:bg-muted">{s.email}</button></li>)}
          </ul>
        )}
      </div>
    </div>
  );
};

/** The compose window: docked bottom-right like Gmail, expandable, autosaves to a Gmail draft every 20s. */
export function Compose({ draft, onClose, onSent, signatureHtml, signatureAbove }: { draft: ComposeDraft; onClose: () => void; onSent: (r: { gmailThreadId: string }) => void; signatureHtml?: string; signatureAbove: boolean }) {
  const send = useAction(api.mail.send);
  const saveDraft = useAction(api.mail.saveDraft);
  const discardDraft = useAction(api.mail.discardDraft);
  const suggest = useAction(api.mail.suggestReply);
  const [to, setTo] = useState(draft.to);
  const [cc, setCc] = useState(draft.cc);
  const [bcc, setBcc] = useState(draft.bcc);
  const [showCc, setShowCc] = useState(draft.cc.length > 0 || draft.bcc.length > 0);
  const [subject, setSubject] = useState(draft.subject);
  const [files, setFiles] = useState<LocalFile[]>(() => (draft.initialAttachments ?? []).map((a) => ({ file: new File([Uint8Array.from(atob(a.base64), (c) => c.charCodeAt(0))], a.filename, { type: a.mime }), base64: a.base64 })));
  const [forwardAtt, setForwardAtt] = useState(draft.forwardAttachments ?? []);
  const [draftId, setDraftId] = useState(draft.draftId);
  const [busy, setBusy] = useState<"send" | "save" | "ai" | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [minimised, setMinimised] = useState(false);
  const dirty = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const initialHtml = useMemo(() => {
    if (draft.mode === "draft" || !signatureHtml) return draft.html;
    const sig = `<div class="hd-sig">${signatureHtml}</div>`;
    if (draft.mode === "new") return `<p></p>${sig}`;
    return signatureAbove ? `<p></p>${sig}${draft.html}` : `<p></p>${draft.html}${sig}`;
  }, [draft, signatureHtml, signatureAbove]);

  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: false }), Underline, Link.configure({ openOnClick: false, autolink: true }), Image.configure({ inline: true, allowBase64: true }), Placeholder.configure({ placeholder: "Write your message…" })],
    content: initialHtml,
    immediatelyRender: false,
    editorProps: { attributes: { class: "prose prose-sm max-w-none min-h-[180px] px-3 py-2 text-sm outline-none [&_.hd-quote]:text-fg-tertiary [&_.hd-sig]:text-fg-secondary" } },
    onUpdate: () => { dirty.current = true; },
  });

  const totalSize = files.reduce((s, f) => s + f.file.size, 0) + forwardAtt.reduce((s, f) => s + f.size, 0);

  const addFiles = async (list: FileList | File[]) => {
    const next: LocalFile[] = [];
    for (const file of Array.from(list)) {
      if (totalSize + next.reduce((s, f) => s + f.file.size, 0) + file.size > MAX_TOTAL) { toast.error(`Attachments are limited to ${bytes(MAX_TOTAL)} in total.`); break; }
      const base64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res((r.result as string).split(",")[1] ?? ""); r.onerror = rej; r.readAsDataURL(file); });
      next.push({ file, base64 });
    }
    setFiles((f) => [...f, ...next]); dirty.current = true;
  };

  const payload = () => ({ to, cc: cc.length ? cc : undefined, bcc: bcc.length ? bcc : undefined, subject: subject || "(no subject)", html: editor?.getHTML() ?? "", gmailThreadId: draft.gmailThreadId, inReplyTo: draft.inReplyTo, references: draft.references, attachments: files.map((f) => ({ filename: f.file.name, mime: f.file.type || "application/octet-stream", base64: f.base64 ?? "" })), forwardAttachments: forwardAtt.map(({ gmailMessageId, attachmentId, filename, mime }) => ({ gmailMessageId, attachmentId, filename, mime })), draftId });

  const doSave = async (quiet = false) => {
    if (!editor) return;
    setBusy("save");
    try { const r = await saveDraft(payload()); setDraftId(r.draftId); dirty.current = false; if (!quiet) toast.success("Draft saved to Gmail"); }
    catch (e) { if (!quiet) toast.error(errorMessage(e)); }
    finally { setBusy(null); }
  };

  // Autosave to Gmail Drafts every 20 seconds while dirty.
  useEffect(() => {
    const t = setInterval(() => { if (dirty.current && !busy) void doSave(true); }, 20_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, to, cc, bcc, subject, files, draftId]);

  const doSend = async () => {
    if (!editor) return;
    if (!to.length && !cc.length && !bcc.length) { toast.error("Add at least one recipient."); return; }
    if (!subject.trim() && !confirm("Send without a subject?")) return;
    setBusy("send");
    try { const r = await send(payload()); toast.success("Sent"); onSent(r); }
    catch (e) { toast.error(errorMessage(e)); }
    finally { setBusy(null); }
  };

  const doDiscard = async () => { if (draftId) { try { await discardDraft({ draftId }); } catch { /* fine */ } } onClose(); };

  const doSuggest = async () => {
    if (!editor || !draft.sourceText) return;
    setBusy("ai");
    try {
      const html = await suggest({ subject: draft.subject, from: draft.sourceFrom ?? "", text: draft.sourceText });
      if (!html) { toast.error("Claude declined to draft this one."); return; }
      editor.chain().focus("start").insertContent(html).run(); dirty.current = true;
    } catch (e) { toast.error(errorMessage(e)); }
    finally { setBusy(null); }
  };

  const title = draft.mode === "new" ? "New message" : draft.mode === "forward" ? "Forward" : draft.mode === "draft" ? "Draft" : "Reply";

  return (
    <div className={cn("fixed z-40 flex flex-col overflow-hidden rounded-t-xl bg-card shadow-float ring-1 ring-black/10 dark:ring-white/10", expanded ? "inset-x-4 bottom-0 top-16 sm:inset-x-[10%]" : minimised ? "bottom-0 right-4 h-11 w-[360px]" : "bottom-0 right-4 h-[min(640px,85svh)] w-[min(680px,calc(100vw-2rem))]")} role="dialog" aria-label={title} onDrop={(e) => { e.preventDefault(); void addFiles(e.dataTransfer.files); }} onDragOver={(e) => e.preventDefault()}>
      <div className="flex h-11 shrink-0 items-center gap-1 bg-[#1a1a19] px-3 text-white">
        <span className="min-w-0 flex-1 truncate text-sm">{subject || title}</span>
        <button type="button" onClick={() => setMinimised((m) => !m)} className="rounded p-1 hover:bg-white/10" aria-label="Minimise"><Minus className="size-4" /></button>
        <button type="button" onClick={() => { setExpanded((x) => !x); setMinimised(false); }} className="rounded p-1 hover:bg-white/10" aria-label="Expand">{expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}</button>
        <button type="button" onClick={() => { if (dirty.current || draftId) void doSave(true); onClose(); }} className="rounded p-1 hover:bg-white/10" aria-label="Close"><X className="size-4" /></button>
      </div>
      {!minimised && (
        <>
          <div className="shrink-0 px-2 pt-1">
            <div className="relative"><AddressChips label="To" value={to} onChange={(v) => { setTo(v); dirty.current = true; }} autoFocus={draft.mode === "new" || draft.mode === "forward"} />{!showCc && <button type="button" onClick={() => setShowCc(true)} className="absolute right-1 top-2 text-xs text-fg-tertiary hover:text-foreground">Cc / Bcc</button>}</div>
            {showCc && <><AddressChips label="Cc" value={cc} onChange={(v) => { setCc(v); dirty.current = true; }} /><AddressChips label="Bcc" value={bcc} onChange={(v) => { setBcc(v); dirty.current = true; }} /></>}
            <input value={subject} onChange={(e) => { setSubject(e.target.value); dirty.current = true; }} placeholder="Subject" className="h-9 w-full border-b border-border bg-transparent px-1 text-sm outline-none" autoFocus={draft.mode === "new" ? false : draft.mode === "forward"} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto" onClick={() => editor?.commands.focus()}>
            <EditorContent editor={editor} />
          </div>
          {(files.length > 0 || forwardAtt.length > 0) && (
            <div className="flex shrink-0 flex-wrap gap-1.5 border-t border-border px-3 py-2">
              {forwardAtt.map((f) => <span key={f.attachmentId} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs"><Paperclip className="size-3" />{f.filename}<span className="text-fg-tertiary">{bytes(f.size)}</span><button type="button" onClick={() => setForwardAtt((a) => a.filter((x) => x.attachmentId !== f.attachmentId))} aria-label="Remove"><X className="size-3" /></button></span>)}
              {files.map((f, i) => <span key={i} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs"><Paperclip className="size-3" />{f.file.name}<span className="text-fg-tertiary">{bytes(f.file.size)}</span><button type="button" onClick={() => setFiles((a) => a.filter((_, j) => j !== i))} aria-label="Remove"><X className="size-3" /></button></span>)}
            </div>
          )}
          <div className="flex shrink-0 items-center gap-1 border-t border-border px-2 py-1.5">
            <Button size="sm" onClick={doSend} disabled={busy !== null}>{busy === "send" ? "Sending…" : "Send"}</Button>
            <div className="mx-1 h-5 w-px bg-border" />
            <Tool onClick={() => editor?.chain().focus().toggleBold().run()} active={editor?.isActive("bold")} label="Bold"><Bold className="size-4" /></Tool>
            <Tool onClick={() => editor?.chain().focus().toggleItalic().run()} active={editor?.isActive("italic")} label="Italic"><Italic className="size-4" /></Tool>
            <Tool onClick={() => editor?.chain().focus().toggleUnderline().run()} active={editor?.isActive("underline")} label="Underline"><UnderlineIcon className="size-4" /></Tool>
            <Tool onClick={() => editor?.chain().focus().toggleBulletList().run()} active={editor?.isActive("bulletList")} label="Bullets"><List className="size-4" /></Tool>
            <Tool onClick={() => editor?.chain().focus().toggleOrderedList().run()} active={editor?.isActive("orderedList")} label="Numbered"><ListOrdered className="size-4" /></Tool>
            <Tool onClick={() => { const url = prompt("Link URL"); if (url) editor?.chain().focus().extendMarkRange("link").setLink({ href: url }).run(); }} active={editor?.isActive("link")} label="Link"><Link2 className="size-4" /></Tool>
            <Tool onClick={() => fileInput.current?.click()} label="Attach files"><Paperclip className="size-4" /></Tool>
            <input ref={fileInput} type="file" multiple hidden onChange={(e) => e.target.files && void addFiles(e.target.files)} />
            {draft.sourceText && <Tool onClick={doSuggest} label="Suggest a reply with Claude" disabled={busy !== null}><Sparkles className={cn("size-4", busy === "ai" && "animate-pulse")} /></Tool>}
            <span className="ml-auto text-[11px] text-fg-quaternary">{busy === "save" ? "Saving…" : draftId ? "Draft in Gmail" : ""}{totalSize > 0 && ` · ${bytes(totalSize)}`}</span>
            <Tool onClick={doDiscard} label="Discard"><Trash2 className="size-4" /></Tool>
          </div>
        </>
      )}
    </div>
  );
}

function Tool({ children, onClick, active, label, disabled }: { children: React.ReactNode; onClick: () => void; active?: boolean; label: string; disabled?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label} className={cn("inline-flex size-8 items-center justify-center rounded-md text-fg-secondary hover:bg-muted hover:text-foreground disabled:opacity-50", active && "bg-muted text-foreground")}>{children}</button>;
}
