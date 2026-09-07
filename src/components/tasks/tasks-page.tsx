"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { Inbox, Sun, CalendarDays, AlarmClock, UserCheck, Send, CheckCircle2, List as ListIcon, Plus, LayoutGrid, Calendar, Rows3, Circle, CheckCircle, Flag, MessageSquare, Paperclip, GitBranch } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { TaskView } from "../../../convex/tasks";
import { TaskDetail } from "./task-detail";
import { parseQuickAdd } from "@/lib/quick-add";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/primitives";
import { cn, errorMessage } from "@/lib/utils";
import { dueLabel, time, TONE_CLASS, TONE_DOT, TONES, initials } from "@/lib/format";
import { useNow } from "@/lib/hooks";

type View = "inbox" | "today" | "week" | "overdue" | "mine" | "assignedByMe" | "done" | "all" | "list";
type Mode = "list" | "board" | "calendar";
const SMART: Array<{ key: View; label: string; icon: React.ComponentType<{ className?: string }>; count: keyof NonNullable<ReturnType<typeof useQuery<typeof api.tasks.lists>>>["smart"] }> = [
  { key: "inbox", label: "Inbox", icon: Inbox, count: "inbox" },
  { key: "today", label: "Today", icon: Sun, count: "today" },
  { key: "week", label: "Next 7 days", icon: CalendarDays, count: "week" },
  { key: "overdue", label: "Overdue", icon: AlarmClock, count: "overdue" },
  { key: "mine", label: "Assigned to me", icon: UserCheck, count: "mine" },
  { key: "assignedByMe", label: "Assigned by me", icon: Send, count: "assignedByMe" },
  { key: "all", label: "All open", icon: ListIcon, count: "all" },
];

const PRI_COLOR: Record<string, string> = { high: "text-error", medium: "text-warning", low: "text-blue", none: "text-fg-quaternary" };

/** Tasks: TickTick-style lists on the left, quick add and grouped rows in the middle, detail on the right. */
export function TasksPage() {
  const params = useSearchParams();
  const router = useRouter();
  const view = (params.get("view") as View | null) ?? "all";
  const listId = params.get("list") as Id<"taskLists"> | null;
  const mode = (params.get("mode") as Mode | null) ?? "list";
  const selected = params.get("task") as Id<"tasks"> | null;
  const setParams = (next: Record<string, string | undefined>) => { const p = new URLSearchParams(params.toString()); for (const [k, v] of Object.entries(next)) { if (!v) p.delete(k); else p.set(k, v); } router.replace(`/tasks${p.size ? `?${p}` : ""}`, { scroll: false }); };

  const me = useQuery(api.users.me);
  const users = useQuery(api.users.all);
  const lists = useQuery(api.tasks.lists);
  const tagsAll = useQuery(api.tags.list);
  const tasks = useQuery(api.tasks.list, { view: view === "list" ? "list" : view, listId: listId ?? undefined, includeDone: view === "done" || mode === "board" });
  const save = useMutation(api.tasks.save);
  const setStatus = useMutation(api.tasks.setStatus);
  const saveList = useMutation(api.tasks.saveList);
  const removeList = useMutation(api.tasks.removeList);
  const now = useNow();
  const [quick, setQuick] = useState("");
  const [newList, setNewList] = useState<string | null>(null);
  const [showDone, setShowDone] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { const t = e.target as HTMLElement; if (t.closest("input, textarea, [contenteditable=true]")) return; if (e.key === "n") { e.preventDefault(); document.getElementById("quick-add")?.focus(); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);

  const preview = useMemo(() => (quick.trim() ? parseQuickAdd(quick, new Date(now)) : null), [quick, now]);

  const addQuick = async () => {
    if (!preview || !preview.title) return;
    const list = preview.listName ? lists?.lists.find((l) => l.name.toLowerCase() === preview.listName!.toLowerCase()) : listId ? lists?.lists.find((l) => l._id === listId) : undefined;
    const assignee = preview.assigneeFirst ? users?.find((u) => u.first.toLowerCase() === preview.assigneeFirst!.toLowerCase()) : view === "mine" ? me : undefined;
    const tagIds = preview.tags.map((t) => tagsAll?.find((x) => x.name.toLowerCase() === t.toLowerCase())?._id).filter((x): x is Id<"tags"> => !!x);
    try { await save({ title: preview.title, dueAt: preview.dueAt ?? (view === "today" ? endOfToday(now) : undefined), allDay: preview.allDay, priority: preview.priority, listId: list?._id, assigneeId: assignee?._id, tagIds }); setQuick(""); }
    catch (e) { toast.error(errorMessage(e)); }
  };

  const grouped = useMemo(() => {
    const rows = (tasks ?? []).filter((t) => showDone || view === "done" || t.status !== "done");
    const end = endOfToday(now);
    const week = end + 7 * 86_400_000;
    const g: Array<{ key: string; label: string; rows: TaskView[] }> = [
      { key: "overdue", label: "Overdue", rows: rows.filter((t) => t.status !== "done" && t.dueAt !== undefined && t.dueAt < now && !(t.allDay && t.dueAt >= end - 86_400_000)) },
      { key: "today", label: "Today", rows: rows.filter((t) => t.status !== "done" && t.dueAt !== undefined && t.dueAt <= end && !(t.dueAt < now && !(t.allDay && t.dueAt >= end - 86_400_000))) },
      { key: "week", label: "Next 7 days", rows: rows.filter((t) => t.status !== "done" && t.dueAt !== undefined && t.dueAt > end && t.dueAt <= week) },
      { key: "later", label: "Later", rows: rows.filter((t) => t.status !== "done" && t.dueAt !== undefined && t.dueAt > week) },
      { key: "nodate", label: "No date", rows: rows.filter((t) => t.status !== "done" && t.dueAt === undefined) },
      { key: "done", label: "Completed", rows: rows.filter((t) => t.status === "done") },
    ];
    return g.filter((x) => x.rows.length);
  }, [tasks, now, showDone, view]);

  const title = view === "list" ? lists?.lists.find((l) => l._id === listId)?.name ?? "List" : SMART.find((s) => s.key === view)?.label ?? (view === "done" ? "Completed" : "Tasks");

  return (
    <div className="grid min-h-0 flex-1 grid-cols-1 lg:h-[calc(100svh-56px)] lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="hidden min-h-0 overflow-y-auto border-r border-border bg-surface-2/60 px-2 py-3 lg:block [scrollbar-width:thin]">
        <ul className="space-y-px">
          {SMART.map((s) => { const n = lists?.smart[s.count] ?? 0; const active = view === s.key; return <li key={s.key}><button type="button" onClick={() => setParams({ view: s.key, list: undefined })} className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-[6px] text-[13px]", active ? "bg-foreground text-background" : "text-fg-secondary hover:bg-muted hover:text-foreground")}><s.icon className="size-4 opacity-80" /><span className="flex-1 text-left">{s.label}</span>{n > 0 && <span className={cn("num text-[10.5px] font-semibold", active ? "text-background/80" : s.key === "overdue" ? "text-error" : "text-fg-tertiary")}>{n}</span>}</button></li>; })}
          <li><button type="button" onClick={() => setParams({ view: "done", list: undefined })} className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-[6px] text-[13px]", view === "done" ? "bg-foreground text-background" : "text-fg-secondary hover:bg-muted hover:text-foreground")}><CheckCircle2 className="size-4 opacity-80" /><span className="flex-1 text-left">Completed</span></button></li>
        </ul>
        <div className="mt-4">
          <div className="flex items-center justify-between px-2 pb-1"><span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg-tertiary">Lists</span><button type="button" onClick={() => setNewList("")} className="rounded p-0.5 text-fg-tertiary hover:bg-muted hover:text-foreground" aria-label="New list"><Plus className="size-3.5" /></button></div>
          {newList !== null && <form className="px-1 pb-1" onSubmit={async (e) => { e.preventDefault(); if (!newList.trim()) return; try { const id = await saveList({ name: newList, color: TONES[(lists?.lists.length ?? 0) % TONES.length] }); setNewList(null); setParams({ view: "list", list: id }); } catch (err) { toast.error(errorMessage(err)); } }}><input autoFocus value={newList} onChange={(e) => setNewList(e.target.value)} onBlur={() => !newList && setNewList(null)} placeholder="List name" className="h-7 w-full rounded-md border border-input bg-card px-2 text-xs" /></form>}
          <ul className="space-y-px">
            {(lists?.lists ?? []).map((l) => { const active = view === "list" && listId === l._id; return <li key={l._id} className="group flex items-center"><button type="button" onClick={() => setParams({ view: "list", list: l._id })} className={cn("flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-[6px] text-[13px]", active ? "bg-foreground text-background" : "text-fg-secondary hover:bg-muted hover:text-foreground")}><span className={cn("size-2 shrink-0 rounded-full", TONE_DOT[l.color])} /><span className="min-w-0 flex-1 truncate text-left">{l.name}</span>{l.count > 0 && <span className={cn("num text-[10.5px]", active ? "text-background/80" : "text-fg-tertiary")}>{l.count}</span>}</button><button type="button" onClick={() => { if (confirm(`Delete list “${l.name}”? Its tasks move to Inbox.`)) { void removeList({ id: l._id }); if (active) setParams({ view: "all", list: undefined }); } }} className="hidden rounded p-1 text-fg-quaternary hover:text-foreground group-hover:inline-flex" aria-label="Delete list">×</button></li>; })}
            {lists && lists.lists.length === 0 && <li className="px-2 text-xs text-fg-quaternary">No lists yet.</li>}
          </ul>
        </div>
      </aside>

      <div className="grid min-h-0 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px]">
        <section className="flex min-h-0 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
            <h1 className="font-display text-xl">{title}</h1>
            <div className="ml-auto flex items-center gap-1 rounded-full bg-muted p-0.5">
              {([["list", Rows3, "List"], ["board", LayoutGrid, "Board"], ["calendar", Calendar, "Calendar"]] as const).map(([m, Icon, label]) => <button key={m} type="button" onClick={() => setParams({ mode: m === "list" ? undefined : m })} className={cn("inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs", mode === m ? "bg-card shadow-xs" : "text-fg-tertiary hover:text-foreground")} aria-label={label}><Icon className="size-3.5" /><span className="hidden sm:inline">{label}</span></button>)}
            </div>
            {view !== "done" && mode === "list" && <label className="flex items-center gap-1 text-xs text-fg-tertiary"><input type="checkbox" className="size-3.5 accent-foreground" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />show done</label>}
          </div>
          <div className="shrink-0 px-4 pt-3">
            <form onSubmit={(e) => { e.preventDefault(); void addQuick(); }} className="relative">
              <Plus className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-quaternary" />
              <input id="quick-add" value={quick} onChange={(e) => setQuick(e.target.value)} placeholder='Add a task… try "Call Smith re report Friday 2pm !high #Reports @Barbara" (n)' className="h-10 w-full rounded-xl border border-border bg-card pl-9 pr-3 text-sm outline-none focus:border-input" />
              {preview && preview.title && (
                <div className="mt-1 flex flex-wrap items-center gap-1.5 px-1 text-[11px] text-fg-tertiary">
                  <span className="font-medium text-foreground">{preview.title}</span>
                  {preview.dueAt && <span className="rounded-full bg-blue-soft px-1.5 text-blue">{dueLabel(preview.dueAt)}{!preview.allDay && ` ${time(preview.dueAt)}`}</span>}
                  {preview.priority !== "none" && <span className={cn("rounded-full bg-muted px-1.5", PRI_COLOR[preview.priority])}>{preview.priority}</span>}
                  {preview.listName && <span className="rounded-full bg-muted px-1.5">#{preview.listName}</span>}
                  {preview.assigneeFirst && <span className="rounded-full bg-muted px-1.5">@{preview.assigneeFirst}</span>}
                  <span className="ml-auto">Enter to add</span>
                </div>
              )}
            </form>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-2 [scrollbar-width:thin]">
            {tasks === undefined ? <div className="space-y-2 pt-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-muted" />)}</div>
              : mode === "board" ? <Board tasks={tasks} selected={selected} onOpen={(id) => setParams({ task: id })} onStatus={(id, s) => setStatus({ id, status: s })} />
              : mode === "calendar" ? <MonthCalendar tasks={tasks} now={now} onOpen={(id) => setParams({ task: id })} onDrop={(id, dueAt) => save({ id, title: tasks.find((t) => t._id === id)?.title ?? "", dueAt })} />
              : grouped.length === 0 ? <Empty title={view === "done" ? "Nothing completed yet" : "All clear"} body={view === "inbox" ? "Tasks without a list land here." : "Add a task above, or turn an email into one from Mail."} className="mt-6" />
              : grouped.map((g) => (
                <div key={g.key} className="mb-4">
                  <div className={cn("flex items-baseline gap-2 px-1 pb-1 text-[11px] font-semibold uppercase tracking-[0.12em]", g.key === "overdue" ? "text-error" : "text-fg-tertiary")}>{g.label}<span className="num font-normal">{g.rows.length}</span></div>
                  <ul className="overflow-hidden rounded-xl bg-card ring-1 ring-black/[0.06] dark:ring-white/10">
                    {g.rows.map((t) => <Row key={t._id} t={t} active={selected === t._id} now={now} onOpen={() => setParams({ task: t._id })} onToggle={() => setStatus({ id: t._id, status: t.status === "done" ? "open" : "done" })} />)}
                  </ul>
                </div>
              ))}
          </div>
        </section>
        <aside className={cn("min-h-0 border-l border-border bg-surface/60", !selected && "hidden xl:block")}>
          {selected ? <TaskDetail key={selected} id={selected} onClose={() => setParams({ task: undefined })} /> : <div className="flex h-full items-center justify-center p-6 text-center text-sm text-fg-tertiary">Select a task to see its details, subtasks and comments.</div>}
        </aside>
      </div>
    </div>
  );
}

const endOfToday = (now: number) => { const d = new Date(now); d.setHours(23, 59, 59, 999); return d.getTime(); };

function Row({ t, active, now, onOpen, onToggle }: { t: TaskView; active: boolean; now: number; onOpen: () => void; onToggle: () => void }) {
  const overdue = t.dueAt !== undefined && t.dueAt < now && t.status !== "done" && !(t.allDay && new Date(t.dueAt).toDateString() === new Date(now).toDateString());
  const doneSubs = t.subtasks.filter((s) => s.status === "done").length;
  return (
    <li className={cn("flex items-start gap-2.5 border-b border-border/70 px-3 py-2 last:border-0", active ? "bg-blue-soft" : "hover:bg-muted/60")}>
      <button type="button" onClick={onToggle} aria-label={t.status === "done" ? "Mark open" : "Mark done"} className={cn("mt-0.5 shrink-0", t.status === "done" ? "text-success" : PRI_COLOR[t.priority])}>{t.status === "done" ? <CheckCircle className="size-4" /> : <Circle className="size-4" />}</button>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <div className={cn("truncate text-sm", t.status === "done" && "text-fg-tertiary line-through")}>{t.title}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-tertiary">
          {t.dueAt !== undefined && <span className={cn(overdue ? "font-medium text-error" : "")}>{dueLabel(t.dueAt)}{!t.allDay && ` ${time(t.dueAt)}`}</span>}
          {t.priority !== "none" && <Flag className={cn("size-3", PRI_COLOR[t.priority])} />}
          {t.listName && <span className="inline-flex items-center gap-1"><span className={cn("size-1.5 rounded-full", TONE_DOT[t.listColor ?? "neutral"])} />{t.listName}</span>}
          {t.subtasks.length > 0 && <span className="inline-flex items-center gap-0.5"><GitBranch className="size-3" />{doneSubs}/{t.subtasks.length}</span>}
          {t.commentCount > 0 && <span className="inline-flex items-center gap-0.5"><MessageSquare className="size-3" />{t.commentCount}</span>}
          {t.gmailThreadId && <span className="inline-flex items-center gap-0.5"><Paperclip className="size-3" />email</span>}
          {t.matterName && <span className="truncate">· {t.matterName}</span>}
          {t.recurrence && <span>↻</span>}
        </div>
      </button>
      {t.assignee && <span className="mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-fg-secondary" title={`Assigned to ${t.assignee}`}>{initials(t.assignee)}</span>}
    </li>
  );
}

function Board({ tasks, selected, onOpen, onStatus }: { tasks: TaskView[]; selected: string | null; onOpen: (id: Id<"tasks">) => void; onStatus: (id: Id<"tasks">, s: "open" | "doing" | "done") => void }) {
  const cols: Array<{ key: "open" | "doing" | "done"; label: string }> = [{ key: "open", label: "To do" }, { key: "doing", label: "Doing" }, { key: "done", label: "Done" }];
  return (
    <div className="grid gap-3 pt-2 md:grid-cols-3">
      {cols.map((c) => (
        <div key={c.key} className="min-h-[200px] rounded-xl bg-surface-2/60 p-2" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const id = e.dataTransfer.getData("task") as Id<"tasks">; if (id) onStatus(id, c.key); }}>
          <div className="flex items-baseline gap-2 px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-fg-tertiary">{c.label}<span className="num font-normal">{tasks.filter((t) => t.status === c.key).length}</span></div>
          <ul className="space-y-1.5">
            {tasks.filter((t) => t.status === c.key).map((t) => (
              <li key={t._id} draggable onDragStart={(e) => e.dataTransfer.setData("task", t._id)} onClick={() => onOpen(t._id)} className={cn("cursor-grab rounded-lg bg-card p-2.5 text-sm ring-1 ring-black/[0.06] hover:shadow-sm dark:ring-white/10", selected === t._id && "ring-2 ring-blue")}>
                <div className={cn(t.status === "done" && "text-fg-tertiary line-through")}>{t.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-fg-tertiary">{t.dueAt !== undefined && <span>{dueLabel(t.dueAt)}</span>}{t.priority !== "none" && <Flag className={cn("size-3", PRI_COLOR[t.priority])} />}{t.assignee && <span className="ml-auto">{t.assignee}</span>}{t.tagIds.length > 0 && <span className={cn("rounded-full px-1.5", TONE_CLASS.neutral)}>{t.tagIds.length} tag{t.tagIds.length === 1 ? "" : "s"}</span>}</div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function MonthCalendar({ tasks, now, onOpen, onDrop }: { tasks: TaskView[]; now: number; onOpen: (id: Id<"tasks">) => void; onDrop: (id: Id<"tasks">, dueAt: number) => void }) {
  const [offset, setOffset] = useState(0);
  const base = new Date(now); base.setDate(1); base.setMonth(base.getMonth() + offset); base.setHours(0, 0, 0, 0);
  const first = new Date(base); first.setDate(1 - ((first.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(first); d.setDate(first.getDate() + i); return d; });
  const byDay = new Map<string, TaskView[]>();
  for (const t of tasks) if (t.dueAt !== undefined) { const k = new Date(t.dueAt).toDateString(); byDay.set(k, [...(byDay.get(k) ?? []), t]); }
  const todayKey = new Date(now).toDateString();
  return (
    <div className="pt-2">
      <div className="flex items-center gap-2 pb-2"><Button size="xs" variant="outline" onClick={() => setOffset((o) => o - 1)}>‹</Button><span className="font-display text-lg">{base.toLocaleDateString("en-AU", { month: "long", year: "numeric" })}</span><Button size="xs" variant="outline" onClick={() => setOffset((o) => o + 1)}>›</Button>{offset !== 0 && <Button size="xs" variant="ghost" onClick={() => setOffset(0)}>Today</Button>}</div>
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl bg-border text-xs">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="bg-surface-2 px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-fg-tertiary">{d}</div>)}
        {days.map((d) => { const k = d.toDateString(); const rows = byDay.get(k) ?? []; const inMonth = d.getMonth() === base.getMonth(); return (
          <div key={k} className={cn("min-h-[84px] bg-card p-1", !inMonth && "bg-surface-2/60 text-fg-quaternary")} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { const id = e.dataTransfer.getData("task") as Id<"tasks">; if (id) { const t = tasks.find((x) => x._id === id); const nd = new Date(d); if (t?.dueAt !== undefined && !t.allDay) { const od = new Date(t.dueAt); nd.setHours(od.getHours(), od.getMinutes()); } else nd.setHours(23, 59, 59, 999); onDrop(id, nd.getTime()); } }}>
            <div className={cn("num mb-0.5 inline-flex size-5 items-center justify-center rounded-full", k === todayKey && "bg-foreground text-background")}>{d.getDate()}</div>
            {rows.slice(0, 4).map((t) => <button key={t._id} type="button" draggable onDragStart={(e) => e.dataTransfer.setData("task", t._id)} onClick={() => onOpen(t._id)} className={cn("block w-full truncate rounded px-1 text-left leading-5 hover:bg-muted", t.status === "done" ? "text-fg-quaternary line-through" : t.priority === "high" ? "text-error" : "")}>{!t.allDay && <span className="num mr-1 text-fg-tertiary">{time(t.dueAt)}</span>}{t.title}</button>)}
            {rows.length > 4 && <div className="px-1 text-fg-quaternary">+{rows.length - 4} more</div>}
          </div>); })}
      </div>
    </div>
  );
}
