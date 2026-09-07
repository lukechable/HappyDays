"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { Inbox, MailOpen, Sparkles, AlarmClock, UserCheck, Star, Send, FileText, Archive, ShieldAlert, Trash2, Tag, Plus, Pencil, X, Check } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { cn, errorMessage } from "@/lib/utils";

export type Label = { id: string; name: string; type: "system" | "user"; unread: number; total: number; color?: { textColor?: string; backgroundColor?: string }; hidden: boolean };
export type ViewKey = "inbox" | "unread" | "smart:primary" | "smart:newsletter" | "smart:notification" | "smart:social" | "overdue" | "assigned" | "starred" | "sent" | "drafts" | "archive" | "spam" | "trash" | "label" | "search" | "matter" | "all";

const VIEWS: Array<{ key: ViewKey; label: string; icon: React.ComponentType<{ className?: string }>; badge?: "overdue" | "assigned" | "inboxUnread" | "drafts" | "spam" }> = [
  { key: "inbox", label: "Inbox", icon: Inbox, badge: "inboxUnread" },
  { key: "unread", label: "Unread", icon: MailOpen },
  { key: "smart:primary", label: "Smart", icon: Sparkles },
  { key: "overdue", label: "Overdue", icon: AlarmClock, badge: "overdue" },
  { key: "assigned", label: "Assigned to me", icon: UserCheck, badge: "assigned" },
  { key: "starred", label: "Starred", icon: Star },
  { key: "sent", label: "Sent", icon: Send },
  { key: "drafts", label: "Drafts", icon: FileText, badge: "drafts" },
  { key: "archive", label: "Archive", icon: Archive },
  { key: "spam", label: "Spam", icon: ShieldAlert, badge: "spam" },
  { key: "trash", label: "Trash", icon: Trash2 },
];

/** Left column of the mail page: fixed views, then Gmail labels as folders (create, rename, delete). */
export function FolderList({ view, labelId, labels, badges, onSelect, onLabelsChanged }: { view: ViewKey; labelId?: string; labels: Label[] | undefined; badges: { overdue: number; assigned: number }; onSelect: (view: ViewKey, labelId?: string) => void; onLabelsChanged: () => void }) {
  const createLabel = useAction(api.mail.createLabel);
  const renameLabel = useAction(api.mail.renameLabel);
  const deleteLabel = useAction(api.mail.deleteLabel);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const sys = Object.fromEntries((labels ?? []).map((l) => [l.id, l]));
  const counts: Record<string, number> = { inboxUnread: sys.INBOX?.unread ?? 0, drafts: sys.DRAFT?.total ?? 0, spam: sys.SPAM?.unread ?? 0, overdue: badges.overdue, assigned: badges.assigned };
  const userLabels = (labels ?? []).filter((l) => l.type === "user" && !l.hidden).sort((a, b) => a.name.localeCompare(b.name));
  const isSmart = view.startsWith("smart:");
  return (
    <nav className="flex h-full flex-col gap-4 overflow-y-auto px-2 py-3 [scrollbar-width:thin]" aria-label="Mail folders">
      <ul className="space-y-px">
        {VIEWS.map((v) => {
          const active = v.key === "smart:primary" ? isSmart : view === v.key;
          const n = v.badge ? counts[v.badge] ?? 0 : 0;
          const alert = v.badge === "overdue";
          return (
            <li key={v.key}><button type="button" onClick={() => onSelect(v.key)} className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-[6px] text-[13px] leading-tight", active ? "bg-foreground text-background" : "text-fg-secondary hover:bg-muted hover:text-foreground")}><v.icon className="size-4 shrink-0 opacity-80" /><span className="min-w-0 flex-1 truncate text-left">{v.label}</span>{n > 0 && <span className={cn("num rounded-full px-1.5 text-[10.5px] font-semibold leading-4", active ? "bg-background/20 text-background" : alert ? "bg-error/90 text-white" : "bg-muted text-fg-secondary")}>{n > 99 ? "99+" : n}</span>}</button></li>
          );
        })}
      </ul>
      <div>
        <div className="flex items-center justify-between px-2 pb-1"><span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg-tertiary">Folders</span><button type="button" onClick={() => setCreating(true)} className="rounded p-0.5 text-fg-tertiary hover:bg-muted hover:text-foreground" aria-label="New folder"><Plus className="size-3.5" /></button></div>
        {creating && (
          <form className="flex items-center gap-1 px-1 pb-1" onSubmit={async (e) => { e.preventDefault(); if (!newName.trim()) return; try { await createLabel({ name: newName }); setNewName(""); setCreating(false); onLabelsChanged(); } catch (err) { toast.error(errorMessage(err)); } }}>
            <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Folder name (Parent/Child for nesting)" className="h-7 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-xs" />
            <button type="submit" className="rounded p-1 hover:bg-muted" aria-label="Create"><Check className="size-3.5" /></button>
            <button type="button" onClick={() => setCreating(false)} className="rounded p-1 hover:bg-muted" aria-label="Cancel"><X className="size-3.5" /></button>
          </form>
        )}
        {labels === undefined ? <p className="px-2 text-xs text-fg-quaternary">Loading folders…</p> : userLabels.length === 0 ? <p className="px-2 text-xs text-fg-quaternary">No folders yet. Gmail labels appear here.</p> : (
          <ul className="space-y-px">
            {userLabels.map((l) => {
              const depth = l.name.split("/").length - 1;
              const short = l.name.split("/").pop() ?? l.name;
              const active = view === "label" && labelId === l.id;
              return (
                <li key={l.id} className="group">
                  {renaming?.id === l.id ? (
                    <form className="flex items-center gap-1 px-1" onSubmit={async (e) => { e.preventDefault(); try { await renameLabel({ id: l.id, name: renaming.name }); setRenaming(null); onLabelsChanged(); } catch (err) { toast.error(errorMessage(err)); } }}>
                      <input autoFocus value={renaming.name} onChange={(e) => setRenaming({ id: l.id, name: e.target.value })} className="h-7 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-xs" />
                      <button type="submit" className="rounded p-1 hover:bg-muted" aria-label="Save"><Check className="size-3.5" /></button>
                      <button type="button" onClick={() => setRenaming(null)} className="rounded p-1 hover:bg-muted" aria-label="Cancel"><X className="size-3.5" /></button>
                    </form>
                  ) : (
                    <div className={cn("flex items-center gap-1 rounded-lg pr-1", active ? "bg-foreground text-background" : "text-fg-secondary hover:bg-muted hover:text-foreground")} style={{ paddingLeft: depth * 10 }}>
                      <button type="button" onClick={() => onSelect("label", l.id)} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-[6px] text-[13px] leading-tight"><Tag className="size-3.5 shrink-0" style={{ color: active ? undefined : l.color?.backgroundColor }} /><span className="min-w-0 flex-1 truncate text-left">{short}</span>{l.unread > 0 && <span className={cn("num text-[10.5px] font-semibold", active ? "text-background/80" : "text-fg-tertiary")}>{l.unread}</span>}</button>
                      <button type="button" onClick={() => setRenaming({ id: l.id, name: l.name })} className="hidden rounded p-1 opacity-70 hover:opacity-100 group-hover:inline-flex" aria-label={`Rename ${l.name}`}><Pencil className="size-3" /></button>
                      <button type="button" onClick={async () => { if (!confirm(`Delete folder “${l.name}”? Mail in it stays in All mail.`)) return; try { await deleteLabel({ id: l.id }); onLabelsChanged(); if (active) onSelect("inbox"); } catch (err) { toast.error(errorMessage(err)); } }} className="hidden rounded p-1 opacity-70 hover:opacity-100 group-hover:inline-flex" aria-label={`Delete ${l.name}`}><X className="size-3" /></button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </nav>
  );
}

export const SMART_TABS: Array<{ key: ViewKey; label: string }> = [
  { key: "smart:primary", label: "Primary" },
  { key: "smart:newsletter", label: "Newsletters" },
  { key: "smart:notification", label: "Notifications" },
  { key: "smart:social", label: "Social & forums" },
];
