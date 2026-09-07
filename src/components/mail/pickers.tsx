"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Check, Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn, errorMessage } from "@/lib/utils";
import { TONE_DOT } from "@/lib/format";
import type { Label } from "./folder-list";

const Item = ({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button type="button" onClick={onClick} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"><span className={cn("inline-flex size-4 items-center justify-center rounded border border-border", active && "border-foreground bg-foreground text-background")}>{active && <Check className="size-3" />}</span>{children}</button>
);

export function TagPicker({ threadId, current, trigger }: { threadId?: Id<"threads">; current: Id<"tags">[]; trigger: React.ReactNode }) {
  const tags = useQuery(api.tags.list);
  const setTags = useMutation(api.mail.setTags);
  const [q, setQ] = useState("");
  const toggle = async (id: Id<"tags">) => { if (!threadId) return; const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id]; try { await setTags({ threadId, tagIds: next }); } catch (e) { toast.error(errorMessage(e)); } };
  return (
    <Popover>
      <PopoverTrigger render={<button type="button" />}>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1.5">
        {!threadId ? <p className="px-2 py-2 text-xs text-fg-tertiary">Open the conversation first.</p> : (
          <>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter tags" className="mb-1 h-7 w-full rounded-md border border-input bg-card px-2 text-xs" />
            <div className="max-h-64 overflow-y-auto">
              {(tags ?? []).filter((t) => t.name.toLowerCase().includes(q.toLowerCase())).map((t) => <Item key={t._id} active={current.includes(t._id)} onClick={() => void toggle(t._id)}><span className={cn("size-2 rounded-full", TONE_DOT[t.color])} />{t.name}</Item>)}
              {tags && tags.length === 0 && <p className="px-2 py-2 text-xs text-fg-tertiary">No tags yet. Add them in Settings → Tags.</p>}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function AssignPicker({ threadId, subject, assignedTo, trigger, otherMailboxHasIt }: { threadId?: Id<"threads">; subject: string; assignedTo?: Id<"users">; trigger: React.ReactNode; otherMailboxHasIt: boolean }) {
  const users = useQuery(api.users.all);
  const me = useQuery(api.users.me);
  const assign = useMutation(api.mail.assign);
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const pick = async (toUserId?: Id<"users">) => { if (!threadId) return; try { await assign({ threadId, toUserId, note: note || undefined, subject }); toast.success(toUserId ? "Assigned" : "Assignment cleared"); setOpen(false); setNote(""); } catch (e) { toast.error(errorMessage(e)); } };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<button type="button" />}>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-2">
        {!threadId ? <p className="px-1 py-1 text-xs text-fg-tertiary">Open the conversation first.</p> : (
          <>
            <p className="px-1 pb-1 text-xs font-medium">Ask someone to follow up</p>
            {(users ?? []).map((u) => <Item key={u._id} active={assignedTo === u._id} onClick={() => void pick(u._id)}>{u._id === me?._id ? `${u.first} (me)` : u.first}<span className="ml-auto text-xs text-fg-quaternary">{u.email}</span></Item>)}
            {!otherMailboxHasIt && <p className="mt-1 rounded-md bg-warning-soft px-2 py-1 text-[11px] text-fg-secondary">The other mailbox hasn’t seen this thread yet. Forward it or add them on your reply so they can read it.</p>}
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className="mt-2 h-8 w-full rounded-md border border-input bg-card px-2 text-xs" />
            {assignedTo && <Button size="xs" variant="ghost" className="mt-2" onClick={() => void pick(undefined)}>Clear assignment</Button>}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function MatterPicker({ threadId, current, trigger }: { threadId?: Id<"threads">; current?: Id<"matters">; trigger: React.ReactNode }) {
  const matters = useQuery(api.matters.list, {});
  const setMatter = useMutation(api.mail.setMatter);
  const save = useMutation(api.matters.save);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const pick = async (matterId?: Id<"matters">) => { if (!threadId) return; try { await setMatter({ threadId, matterId }); setOpen(false); } catch (e) { toast.error(errorMessage(e)); } };
  const create = async () => { if (!q.trim()) return; try { const id = await save({ name: q.trim(), parties: [], clinikoPatientIds: [] }); await pick(id); toast.success(`Matter “${q.trim()}” created`); } catch (e) { toast.error(errorMessage(e)); } };
  const filtered = (matters ?? []).filter((m) => m.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<button type="button" />}>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1.5">
        {!threadId ? <p className="px-2 py-2 text-xs text-fg-tertiary">Open the conversation first.</p> : (
          <>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find or create a matter" className="mb-1 h-7 w-full rounded-md border border-input bg-card px-2 text-xs" />
            <div className="max-h-64 overflow-y-auto">
              {filtered.map((m) => <Item key={m._id} active={current === m._id} onClick={() => void pick(m._id)}><span className="truncate">{m.name}</span>{m.courtFileNo && <span className="ml-auto text-[10px] text-fg-quaternary">{m.courtFileNo}</span>}</Item>)}
              {q.trim() && !filtered.some((m) => m.name.toLowerCase() === q.trim().toLowerCase()) && <button type="button" onClick={create} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-blue hover:bg-muted"><Plus className="size-3.5" />Create “{q.trim()}”</button>}
            </div>
            {current && <Button size="xs" variant="ghost" className="mt-1" onClick={() => void pick(undefined)}>Unlink matter</Button>}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function LabelPicker({ labels, currentLabelIds, onApply, trigger }: { labels: Label[]; currentLabelIds: string[]; onApply: (add: string[], remove: string[]) => void; trigger: React.ReactNode }) {
  const [q, setQ] = useState("");
  const user = labels.filter((l) => l.type === "user").sort((a, b) => a.name.localeCompare(b.name)).filter((l) => l.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Popover>
      <PopoverTrigger render={<button type="button" />}>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1.5">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter folders" className="mb-1 h-7 w-full rounded-md border border-input bg-card px-2 text-xs" />
        <div className="max-h-64 overflow-y-auto">
          {user.map((l) => { const on = currentLabelIds.includes(l.id); return <Item key={l.id} active={on} onClick={() => onApply(on ? [] : [l.id], on ? [l.id] : [])}><span className="truncate">{l.name}</span></Item>; })}
          {user.length === 0 && <p className="px-2 py-2 text-xs text-fg-tertiary">No folders yet.</p>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
