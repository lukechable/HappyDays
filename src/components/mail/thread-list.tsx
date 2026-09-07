"use client";

import { Paperclip, Star, Reply, UserCheck, AlarmClock, Bot, CalendarCheck2, CalendarClock } from "lucide-react";
import type { ListItem, ThreadMeta } from "../../../convex/mail";
import { cn } from "@/lib/utils";
import { mailDate, TONE_CLASS } from "@/lib/format";

/** The middle column: one row per conversation with the pills that make it a shared inbox. */
export function ThreadList({ items, meta, selectedId, focusedIndex, checked, onOpen, onToggleCheck, onStar, loading, error, hasMore, onMore, emptyText, myFirst }: {
  items: ListItem[]; meta: Record<string, ThreadMeta>; selectedId?: string; focusedIndex: number; checked: Set<string>;
  onOpen: (id: string) => void; onToggleCheck: (id: string, shift: boolean) => void; onStar: (item: ListItem) => void;
  loading: boolean; error?: string; hasMore: boolean; onMore: () => void; emptyText: string; myFirst?: string;
}) {
  if (error) return <div className="p-4 text-sm text-error">{error}</div>;
  if (!loading && items.length === 0) return <div className="px-4 py-12 text-center text-sm text-fg-tertiary">{emptyText}</div>;
  return (
    <div className="flex h-full flex-col">
      <ul className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]" role="listbox" aria-label="Conversations">
        {items.map((t, i) => {
          const m = meta[t.gmailThreadId];
          const active = t.gmailThreadId === selectedId;
          const focused = i === focusedIndex;
          const others = m?.repliedBy.filter((r) => r.first !== myFirst) ?? [];
          const mine = m?.repliedBy.some((r) => r.first === myFirst) ?? false;
          return (
            <li key={t.gmailThreadId} role="option" aria-selected={active} data-index={i} className={cn("hd-row group relative flex cursor-pointer gap-2 border-b border-border/70 px-3 py-2 text-[13px]", active ? "bg-blue-soft shadow-[inset_2px_0_0_var(--blue)]" : focused ? "bg-muted/70" : "hover:bg-muted/60", t.unread && !active && "bg-card")} onClick={() => onOpen(t.gmailThreadId)}>
              <div className="flex shrink-0 flex-col items-center gap-1 pt-0.5">
                <input type="checkbox" aria-label="Select conversation" checked={checked.has(t.gmailThreadId)} onClick={(e) => { e.stopPropagation(); onToggleCheck(t.gmailThreadId, e.shiftKey); }} onChange={() => undefined} className="size-3.5 accent-foreground" />
                <button type="button" onClick={(e) => { e.stopPropagation(); onStar(t); }} aria-label={t.starred ? "Unstar" : "Star"} className={cn("hd-press rounded p-0.5 transition-opacity", t.starred ? "text-gold" : "text-fg-quaternary opacity-0 hover:text-gold group-hover:opacity-100")}><Star className="size-3.5" fill={t.starred ? "currentColor" : "none"} /></button>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-2">
                  <span className={cn("min-w-0 flex-1 truncate", t.unread ? "font-semibold" : "text-fg-secondary")}>{t.senders.map((s) => s.name).join(", ") || "(unknown)"}{t.count > 1 && <span className="num ml-1 text-[11px] font-normal text-fg-tertiary">{t.count}</span>}</span>
                  <span className={cn("num shrink-0 text-[11px]", t.unread ? "font-semibold text-foreground" : "text-fg-tertiary")}>{mailDate(t.lastAt)}</span>
                </div>
                <div className={cn("truncate", t.unread ? "font-medium" : "")}>{t.latestIsDraft && <span className="mr-1 text-error">Draft</span>}{t.subject}</div>
                <div className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-xs text-fg-tertiary">{t.snippet}</span>
                  {t.hasAttachment && <Paperclip className="size-3 shrink-0 text-fg-quaternary" />}
                </div>
                {(m?.tags.length || others.length || mine || m?.assignedTo || m?.overdue || m?.matter || m?.autoReplied || m?.rescheduled || m?.rescheduleRequested) ? (
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    {m?.overdue && <span className="inline-flex items-center gap-0.5 rounded-full bg-error-soft px-1.5 text-[10.5px] font-medium leading-4 text-error"><AlarmClock className="size-2.5" />overdue</span>}
                    {others.map((r) => <span key={r.email} className="inline-flex items-center gap-0.5 rounded-full bg-success-soft px-1.5 text-[10.5px] font-medium leading-4 text-success"><Reply className="size-2.5" />{r.first} replied</span>)}
                    {mine && <span className="inline-flex items-center gap-0.5 rounded-full bg-success-soft px-1.5 text-[10.5px] font-medium leading-4 text-success"><Reply className="size-2.5" />You replied</span>}
                    {m?.autoReplied && <span className="inline-flex items-center gap-0.5 rounded-full bg-success-soft px-1.5 text-[10.5px] font-medium leading-4 text-success"><Bot className="size-2.5" />Auto replied</span>}
                    {m?.rescheduled && <span className="inline-flex items-center gap-0.5 rounded-full bg-success-soft px-1.5 text-[10.5px] font-medium leading-4 text-success"><CalendarCheck2 className="size-2.5" />Already rescheduled</span>}
                    {m?.rescheduleRequested && <span className="inline-flex items-center gap-0.5 rounded-full bg-warning-soft px-1.5 text-[10.5px] font-medium leading-4 text-warning"><CalendarClock className="size-2.5" />Reschedule requested</span>}
                    {m?.assignedTo && <span className="inline-flex items-center gap-0.5 rounded-full bg-warning-soft px-1.5 text-[10.5px] font-medium leading-4 text-warning"><UserCheck className="size-2.5" />{m.assignedTo.first}</span>}
                    {m?.matter && <span className="truncate rounded-full bg-muted px-1.5 text-[10.5px] leading-4 text-fg-secondary">{m.matter.name}</span>}
                    {m?.tags.map((tag) => <span key={tag._id} className={cn("rounded-full px-1.5 text-[10.5px] font-medium leading-4", TONE_CLASS[tag.color])}>{tag.name}</span>)}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
        {loading && <li className="p-3"><div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-muted" />)}</div></li>}
        {!loading && hasMore && <li className="p-3 text-center"><button type="button" onClick={onMore} className="rounded-full border border-border px-3 py-1 text-xs text-fg-secondary hover:bg-muted">Load more</button></li>}
      </ul>
    </div>
  );
}
