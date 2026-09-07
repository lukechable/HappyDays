"use client";

import { useState } from "react";
import Link from "next/link";
import { useAction } from "convex/react";
import { Inbox, MailOpen, Sparkles, AlarmClock, UserCheck, Star, Send, FileText, Archive, ShieldAlert, Trash2, Folder, Plus, Pencil, X, Check, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { GMAIL_SWATCHES, textOn } from "@/lib/gmail-palette";
import { cn, errorMessage } from "@/lib/utils";

export type Label = { id: string; name: string; type: "system" | "user"; unread: number; total: number; color?: { textColor?: string; backgroundColor?: string }; hidden: boolean };
export type ViewKey = "inbox" | "unread" | "smart:primary" | "smart:newsletter" | "smart:notification" | "smart:social" | "overdue" | "assigned" | "starred" | "sent" | "drafts" | "archive" | "spam" | "trash" | "label" | "search" | "matter" | "all";

/** Drag payload type for conversations being moved between folders. */
export const DRAG_MIME = "application/x-happydays-threads";
export type DropTarget = { view?: ViewKey; labelId?: string };

const VIEWS: Array<{ key: ViewKey; label: string; icon: React.ComponentType<{ className?: string }>; badge?: "overdue" | "assigned" | "inboxUnread" | "drafts" | "spam"; droppable?: boolean }> = [
  { key: "inbox", label: "Inbox", icon: Inbox, badge: "inboxUnread", droppable: true },
  { key: "unread", label: "Unread", icon: MailOpen },
  { key: "smart:primary", label: "Smart", icon: Sparkles },
  { key: "overdue", label: "Overdue", icon: AlarmClock, badge: "overdue" },
  { key: "assigned", label: "Assigned to me", icon: UserCheck, badge: "assigned" },
  { key: "starred", label: "Starred", icon: Star, droppable: true },
  { key: "sent", label: "Sent", icon: Send },
  { key: "drafts", label: "Drafts", icon: FileText, badge: "drafts" },
  { key: "archive", label: "Archive", icon: Archive, droppable: true },
  { key: "spam", label: "Spam", icon: ShieldAlert, badge: "spam", droppable: true },
  { key: "trash", label: "Trash", icon: Trash2, droppable: true },
];

const hasDrag = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes(DRAG_MIME);
const readDrag = (e: React.DragEvent): string[] => { try { const ids = JSON.parse(e.dataTransfer.getData(DRAG_MIME)); return Array.isArray(ids) ? ids.filter((x) => typeof x === "string") : []; } catch { return []; } };

/** Left column of the mail page: fixed views, then Gmail labels as folders (create, edit, delete, drop targets). */
export function FolderList({ view, labelId, labels, badges, onSelect, onLabelsChanged, onDropThreads }: { view: ViewKey; labelId?: string; labels: Label[] | undefined; badges: { overdue: number; assigned: number }; onSelect: (view: ViewKey, labelId?: string) => void; onLabelsChanged: () => void; onDropThreads?: (target: DropTarget, ids: string[]) => void }) {
  const createLabel = useAction(api.mail.createLabel);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [over, setOver] = useState<string | null>(null);
  const sys = Object.fromEntries((labels ?? []).map((l) => [l.id, l]));
  const counts: Record<string, number> = { inboxUnread: sys.INBOX?.unread ?? 0, drafts: sys.DRAFT?.total ?? 0, spam: sys.SPAM?.unread ?? 0, overdue: badges.overdue, assigned: badges.assigned };
  const userLabels = (labels ?? []).filter((l) => l.type === "user" && !l.hidden).sort((a, b) => a.name.localeCompare(b.name));
  const isSmart = view.startsWith("smart:");

  const dropProps = (key: string, target: DropTarget) => onDropThreads ? {
    onDragOver: (e: React.DragEvent) => { if (!hasDrag(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (over !== key) setOver(key); },
    onDragLeave: (e: React.DragEvent) => { if (over === key && !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setOver(null); },
    onDrop: (e: React.DragEvent) => { if (!hasDrag(e)) return; e.preventDefault(); setOver(null); const ids = readDrag(e); if (ids.length) onDropThreads(target, ids); },
  } : {};

  return (
    <nav className="flex h-full flex-col gap-4 overflow-y-auto px-2 py-3 [scrollbar-width:thin]" aria-label="Mail folders">
      <ul className="space-y-px">
        {VIEWS.map((v) => {
          const active = v.key === "smart:primary" ? isSmart : view === v.key;
          const n = v.badge ? counts[v.badge] ?? 0 : 0;
          const alert = v.badge === "overdue";
          const isOver = over === v.key;
          return (
            <li key={v.key} {...(v.droppable ? dropProps(v.key, { view: v.key }) : {})}>
              <button type="button" onClick={() => onSelect(v.key)} className={cn("hd-press flex w-full items-center gap-2 rounded-lg px-2 py-[6px] text-[13px] leading-tight", active ? "bg-foreground text-background" : "text-fg-secondary hover:bg-muted hover:text-foreground", isOver && "ring-2 ring-blue ring-offset-1 ring-offset-surface-2 bg-blue-soft text-foreground")}><v.icon className="size-4 shrink-0 opacity-80" /><span className="min-w-0 flex-1 truncate text-left">{v.label}</span>{n > 0 && <span className={cn("hd-pop num rounded-full px-1.5 text-[10.5px] font-semibold leading-4", active ? "bg-background/20 text-background" : alert ? "bg-error/90 text-white" : "bg-muted text-fg-secondary")}>{n > 99 ? "99+" : n}</span>}</button>
            </li>
          );
        })}
      </ul>
      <div>
        <div className="flex items-center justify-between px-2 pb-1">
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg-tertiary">Folders</span>
          <span className="flex items-center gap-0.5">
            <Link href="/settings?tab=folders" className="rounded p-0.5 text-fg-tertiary hover:bg-muted hover:text-foreground" aria-label="Folder rules" title="Folder rules"><SlidersHorizontal className="size-3.5" /></Link>
            <button type="button" onClick={() => setCreating(true)} className="rounded p-0.5 text-fg-tertiary hover:bg-muted hover:text-foreground" aria-label="New folder" title="New folder"><Plus className="size-3.5" /></button>
          </span>
        </div>
        {creating && (
          <form className="flex items-center gap-1 px-1 pb-1" onSubmit={async (e) => { e.preventDefault(); if (!newName.trim()) return; try { await createLabel({ name: newName }); setNewName(""); setCreating(false); onLabelsChanged(); toast.success("Folder created"); } catch (err) { toast.error(errorMessage(err)); } }}>
            <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Folder name (Parent/Child for nesting)" className="h-7 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-xs" />
            <button type="submit" className="rounded p-1 hover:bg-muted" aria-label="Create"><Check className="size-3.5" /></button>
            <button type="button" onClick={() => setCreating(false)} className="rounded p-1 hover:bg-muted" aria-label="Cancel"><X className="size-3.5" /></button>
          </form>
        )}
        {labels === undefined ? <p className="px-2 text-xs text-fg-quaternary">Loading folders…</p> : userLabels.length === 0 ? <p className="px-2 text-xs text-fg-quaternary">No folders yet. Drag a conversation here once you make one.</p> : (
          <ul className="space-y-px">
            {userLabels.map((l) => {
              const depth = l.name.split("/").length - 1;
              const short = l.name.split("/").pop() ?? l.name;
              const active = view === "label" && labelId === l.id;
              const isOver = over === l.id;
              return (
                <li key={l.id} className="group" {...dropProps(l.id, { labelId: l.id })}>
                  <div className={cn("hd-row flex items-center gap-1 rounded-lg pr-1", active ? "bg-foreground text-background" : "text-fg-secondary hover:bg-muted hover:text-foreground", isOver && "ring-2 ring-blue ring-offset-1 ring-offset-surface-2 bg-blue-soft text-foreground")} style={{ paddingLeft: depth * 10 }}>
                    <button type="button" onClick={() => onSelect("label", l.id)} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-[6px] text-[13px] leading-tight"><Folder className="size-3.5 shrink-0" style={{ color: active ? undefined : l.color?.backgroundColor }} /><span className="min-w-0 flex-1 truncate text-left">{short}</span>{l.unread > 0 && <span className={cn("num text-[10.5px] font-semibold", active ? "text-background/80" : "text-fg-tertiary")}>{l.unread}</span>}</button>
                    <FolderEditor label={l} onChanged={() => { onLabelsChanged(); }} onDeleted={() => { onLabelsChanged(); if (active) onSelect("inbox"); }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </nav>
  );
}

/** Rename, recolour or delete a folder. Colours come from Gmail's own palette so they show the same way in Gmail. */
function FolderEditor({ label, onChanged, onDeleted }: { label: Label; onChanged: () => void; onDeleted: () => void }) {
  const updateLabel = useAction(api.mail.updateLabel);
  const deleteLabel = useAction(api.mail.deleteLabel);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState<string | null>(label.color?.backgroundColor ?? null);
  const [busy, setBusy] = useState(false);
  const dirty = name.trim() !== label.name || (color ?? null) !== (label.color?.backgroundColor ?? null);
  const save = async () => {
    if (!dirty) { setOpen(false); return; }
    setBusy(true);
    try {
      await updateLabel({ id: label.id, name: name.trim() !== label.name ? name : undefined, color: (color ?? null) === (label.color?.backgroundColor ?? null) ? undefined : color ? { backgroundColor: color, textColor: textOn(color) } : null });
      setOpen(false); onChanged(); toast.success("Folder updated");
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) { setName(label.name); setColor(label.color?.backgroundColor ?? null); } }}>
      <PopoverTrigger render={<button type="button" className={cn("rounded p-1 opacity-70 hover:opacity-100 group-hover:inline-flex", open ? "inline-flex" : "hidden")} aria-label={`Edit ${label.name}`} title="Edit folder" />}><Pencil className="size-3" /></PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-3">
        <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-fg-secondary">Name</label>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} className="h-8 w-full rounded-md border border-input bg-card px-2 text-sm" placeholder="Parent/Child for nesting" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-fg-secondary">Colour</label>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setColor(null)} className={cn("hd-press inline-flex size-6 items-center justify-center rounded-full border border-dashed border-border text-fg-tertiary", color === null && "ring-2 ring-foreground ring-offset-1")} aria-label="No colour" title="No colour"><X className="size-3" /></button>
              {GMAIL_SWATCHES.map((c) => <button key={c} type="button" onClick={() => setColor(c)} style={{ background: c }} className={cn("hd-press size-6 rounded-full ring-offset-1", color === c && "ring-2 ring-foreground")} aria-label={c} />)}
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 pt-1">
            <button type="button" disabled={busy} onClick={async () => { if (!confirm(`Delete folder “${label.name}”? Mail in it stays in All mail.`)) return; setBusy(true); try { await deleteLabel({ id: label.id }); setOpen(false); onDeleted(); toast.success("Folder deleted"); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } }} className="text-xs text-error hover:underline">Delete folder</button>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => setOpen(false)} className="hd-press rounded-md px-2.5 py-1 text-xs text-fg-secondary hover:bg-muted">Cancel</button>
              <button type="submit" disabled={busy || !dirty} className="hd-press rounded-md bg-foreground px-2.5 py-1 text-xs font-medium text-background disabled:opacity-50">{busy ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

export const SMART_TABS: Array<{ key: ViewKey; label: string }> = [
  { key: "smart:primary", label: "Primary" },
  { key: "smart:newsletter", label: "Newsletters" },
  { key: "smart:notification", label: "Notifications" },
  { key: "smart:social", label: "Social & forums" },
];
