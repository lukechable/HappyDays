"use client";

import { useState } from "react";
import Link from "next/link";
import { PrefetchLink } from "@/components/prefetch-link";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { X, Trash2, Plus, Circle, CheckCircle, Mail, Briefcase, Repeat } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn, errorMessage } from "@/lib/utils";
import { ago, TONE_CLASS, TONE_DOT } from "@/lib/format";

const toLocalInput = (t?: number, allDay?: boolean) => { if (!t) return ""; const d = new Date(t); const pad = (n: number) => String(n).padStart(2, "0"); const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; return allDay ? date : `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };

/** Right-hand panel: every field editable in place, subtasks, comments, and links back to the email or matter. */
export function TaskDetail({ id, onClose }: { id: Id<"tasks">; onClose: () => void }) {
  const task = useQuery(api.tasks.get, { id });
  const lists = useQuery(api.tasks.lists);
  const users = useQuery(api.users.all);
  const tags = useQuery(api.tags.list);
  const me = useQuery(api.users.me);
  const save = useMutation(api.tasks.save);
  const setStatus = useMutation(api.tasks.setStatus);
  const remove = useMutation(api.tasks.remove);
  const comment = useMutation(api.tasks.comment);
  const thread = useQuery(api.mail.threadDetail, task?.sourceThreadId ? { threadId: task.sourceThreadId } : "skip");
  const [title, setTitle] = useState<string | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [sub, setSub] = useState("");
  const [body, setBody] = useState("");
  if (task === undefined) return <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <div key={i} className="h-8 animate-pulse rounded-lg bg-muted" />)}</div>;
  if (task === null) return <div className="p-6 text-sm text-fg-tertiary">This task was deleted.</div>;

  const patch = async (fields: Partial<{ title: string; notes: string; listId: Id<"taskLists">; assigneeId: Id<"users">; dueAt: number; allDay: boolean; priority: "none" | "low" | "medium" | "high"; tagIds: Id<"tags">[]; recurrence: { freq: "daily" | "weekly" | "monthly" | "yearly"; interval: number } | undefined; matterId: Id<"matters"> }>) => {
    try { await save({ id, title: fields.title ?? task.title, notes: fields.notes ?? task.notes, listId: "listId" in fields ? fields.listId : task.listId, assigneeId: "assigneeId" in fields ? fields.assigneeId : task.assigneeId, dueAt: "dueAt" in fields ? fields.dueAt : task.dueAt, allDay: fields.allDay ?? task.allDay, priority: fields.priority ?? task.priority, tagIds: fields.tagIds ?? task.tagIds, recurrence: "recurrence" in fields ? fields.recurrence : task.recurrence, matterId: fields.matterId ?? task.matterId }); }
    catch (e) { toast.error(errorMessage(e)); }
  };
  const gmailThreadId = thread && me?.google ? thread.mailboxes.find((m) => m.accountId === me.google?._id)?.gmailThreadId : undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border px-3 py-2">
        <button type="button" onClick={() => setStatus({ id, status: task.status === "done" ? "open" : "done" })} className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium", task.status === "done" ? "bg-success-soft text-success" : "bg-muted text-fg-secondary hover:text-foreground")}>{task.status === "done" ? <CheckCircle className="size-3.5" /> : <Circle className="size-3.5" />}{task.status === "done" ? "Completed" : "Mark complete"}</button>
        {task.status !== "done" && <button type="button" onClick={() => setStatus({ id, status: task.status === "doing" ? "open" : "doing" })} className={cn("rounded-full px-2 py-1 text-xs", task.status === "doing" ? "bg-blue-soft text-blue" : "text-fg-tertiary hover:bg-muted")}>{task.status === "doing" ? "In progress" : "Start"}</button>}
        <span className="ml-auto" />
        <button type="button" onClick={async () => { if (confirm("Delete this task?")) { await remove({ id }); onClose(); } }} className="rounded p-1.5 text-fg-tertiary hover:bg-muted hover:text-error" aria-label="Delete"><Trash2 className="size-4" /></button>
        <button type="button" onClick={onClose} className="rounded p-1.5 text-fg-tertiary hover:bg-muted hover:text-foreground" aria-label="Close"><X className="size-4" /></button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 [scrollbar-width:thin]">
        <input value={title ?? task.title} onChange={(e) => setTitle(e.target.value)} onBlur={() => { if (title !== null && title.trim() && title !== task.title) void patch({ title: title.trim() }); }} className={cn("w-full bg-transparent font-display text-lg leading-snug outline-none", task.status === "done" && "text-fg-tertiary line-through")} />

        <div className="mt-3 grid grid-cols-[88px_1fr] items-center gap-x-2 gap-y-2 text-sm">
          <span className="text-xs text-fg-tertiary">Due</span>
          <div className="flex flex-wrap items-center gap-1.5">
            <input type={task.allDay ? "date" : "datetime-local"} value={toLocalInput(task.dueAt, task.allDay)} onChange={(e) => { if (!e.target.value) { void patch({ dueAt: undefined }); return; } const d = new Date(e.target.value); if (task.allDay) d.setHours(23, 59, 59, 999); void patch({ dueAt: d.getTime() }); }} className="h-7 rounded-md border border-input bg-card px-2 text-xs" />
            <label className="flex items-center gap-1 text-[11px] text-fg-tertiary"><input type="checkbox" className="size-3 accent-foreground" checked={!task.allDay} onChange={(e) => { const d = task.dueAt ? new Date(task.dueAt) : new Date(); if (e.target.checked) d.setHours(9, 0, 0, 0); else d.setHours(23, 59, 59, 999); void patch({ allDay: !e.target.checked, dueAt: d.getTime() }); }} />time</label>
            {task.dueAt && <button type="button" onClick={() => patch({ dueAt: undefined })} className="text-[11px] text-fg-tertiary hover:text-foreground">clear</button>}
          </div>
          <span className="text-xs text-fg-tertiary">Repeat</span>
          <div className="flex items-center gap-1.5"><Repeat className="size-3.5 text-fg-quaternary" /><select value={task.recurrence?.freq ?? ""} onChange={(e) => patch({ recurrence: e.target.value ? { freq: e.target.value as "daily" | "weekly" | "monthly" | "yearly", interval: task.recurrence?.interval ?? 1 } : undefined })} className="h-7 rounded-md border border-input bg-card px-2 text-xs"><option value="">Never</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select>{task.recurrence && <>every<input type="number" min={1} className="num h-7 w-14 rounded-md border border-input bg-card px-2 text-xs" value={task.recurrence.interval} onChange={(e) => patch({ recurrence: { freq: task.recurrence!.freq, interval: Math.max(1, Number(e.target.value) || 1) } })} /></>}</div>
          <span className="text-xs text-fg-tertiary">Priority</span>
          <div className="flex gap-1">{(["none", "low", "medium", "high"] as const).map((p) => <button key={p} type="button" onClick={() => patch({ priority: p })} className={cn("rounded-full px-2 py-0.5 text-[11px] capitalize", task.priority === p ? "bg-foreground text-background" : "bg-muted text-fg-secondary hover:text-foreground")}>{p}</button>)}</div>
          <span className="text-xs text-fg-tertiary">List</span>
          <select value={task.listId ?? ""} onChange={(e) => patch({ listId: (e.target.value || undefined) as Id<"taskLists"> | undefined })} className="h-7 w-fit rounded-md border border-input bg-card px-2 text-xs"><option value="">Inbox</option>{(lists?.lists ?? []).map((l) => <option key={l._id} value={l._id}>{l.name}</option>)}</select>
          <span className="text-xs text-fg-tertiary">Assignee</span>
          <div className="flex gap-1">{(users ?? []).map((u) => <button key={u._id} type="button" onClick={() => patch({ assigneeId: task.assigneeId === u._id ? undefined : u._id })} className={cn("rounded-full px-2 py-0.5 text-[11px]", task.assigneeId === u._id ? "bg-foreground text-background" : "bg-muted text-fg-secondary hover:text-foreground")}>{u.first}</button>)}</div>
          <span className="text-xs text-fg-tertiary">Tags</span>
          <div className="flex flex-wrap gap-1">{(tags ?? []).map((t) => { const on = task.tagIds.includes(t._id); return <button key={t._id} type="button" onClick={() => patch({ tagIds: on ? task.tagIds.filter((x) => x !== t._id) : [...task.tagIds, t._id] })} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]", on ? TONE_CLASS[t.color] : "bg-muted text-fg-tertiary hover:text-foreground")}><span className={cn("size-1.5 rounded-full", TONE_DOT[t.color])} />{t.name}</button>; })}{tags && tags.length === 0 && <span className="text-[11px] text-fg-quaternary">No tags yet.</span>}</div>
        </div>

        {(task.sourceThreadId || task.matterId) && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {task.sourceThreadId && (gmailThreadId ? <Link href={`/mail?thread=${gmailThreadId}`} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-fg-secondary hover:text-foreground"><Mail className="size-3" />{thread?.subject ?? "Open email"}</Link> : <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-fg-tertiary"><Mail className="size-3" />{thread?.subject ?? "Email"} (not in your mailbox)</span>)}
            {task.matterId && <PrefetchLink href={`/matters/${task.matterId}`} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-fg-secondary hover:text-foreground"><Briefcase className="size-3" />Matter</PrefetchLink>}
          </div>
        )}

        <div className="mt-4">
          <Textarea value={notes ?? task.notes ?? ""} onChange={(e) => setNotes(e.target.value)} onBlur={() => { if (notes !== null && notes !== (task.notes ?? "")) void patch({ notes }); }} placeholder="Notes" rows={4} className="text-sm" />
        </div>

        <div className="mt-4">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg-tertiary">Subtasks</div>
          <ul className="mt-1 space-y-0.5">
            {task.subtasks.map((s) => <li key={s._id} className="flex items-center gap-2 text-sm"><button type="button" onClick={() => setStatus({ id: s._id, status: s.status === "done" ? "open" : "done" })} className={s.status === "done" ? "text-success" : "text-fg-quaternary"}>{s.status === "done" ? <CheckCircle className="size-4" /> : <Circle className="size-4" />}</button><span className={cn("flex-1", s.status === "done" && "text-fg-tertiary line-through")}>{s.title}</span><button type="button" onClick={() => remove({ id: s._id })} className="text-fg-quaternary hover:text-error" aria-label="Delete subtask"><X className="size-3.5" /></button></li>)}
          </ul>
          <form className="mt-1 flex items-center gap-1" onSubmit={async (e) => { e.preventDefault(); if (!sub.trim()) return; try { await save({ title: sub, parentId: id, allDay: true }); setSub(""); } catch (err) { toast.error(errorMessage(err)); } }}><Plus className="size-3.5 text-fg-quaternary" /><input value={sub} onChange={(e) => setSub(e.target.value)} placeholder="Add a subtask" className="h-7 flex-1 bg-transparent text-sm outline-none" /></form>
        </div>

        <div className="mt-4">
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg-tertiary">Comments</div>
          <ul className="mt-1 space-y-2">
            {task.comments.map((c) => <li key={c._id} className="rounded-lg bg-muted/60 px-2.5 py-1.5 text-sm"><div className="flex items-baseline gap-2 text-[11px] text-fg-tertiary"><span className="font-medium text-foreground">{c.who}</span>{ago(c.createdAt)}</div><p className="whitespace-pre-wrap">{c.body}</p></li>)}
          </ul>
          <form className="mt-2 flex gap-1" onSubmit={async (e) => { e.preventDefault(); if (!body.trim()) return; await comment({ taskId: id, body }); setBody(""); }}><input value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a comment" className="h-8 flex-1 rounded-md border border-input bg-card px-2 text-sm" /><Button size="sm" type="submit" variant="outline">Post</Button></form>
        </div>
        <p className="mt-6 text-[11px] text-fg-quaternary">Created by {task.creatorId === me?._id ? "you" : users?.find((u) => u._id === task.creatorId)?.first ?? "?"} · updated {ago(task.updatedAt)}</p>
      </div>
    </div>
  );
}
