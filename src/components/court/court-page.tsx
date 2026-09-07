"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { Plus, Pencil, Trash2, Gavel, FileSignature } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { STATUSES, type CourtKind } from "../../../convex/court";
import { PageHeader, Panel, Kpi, Empty, Loading, DataTable, type Tone } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ExportMenu } from "@/components/export/export-menu";
import { useNow } from "@/lib/hooks";
import { day, when, weekday, time } from "@/lib/format";
import { cn, errorMessage } from "@/lib/utils";

type Row = NonNullable<ReturnType<typeof useQuery<typeof api.court.list>>>[number];
type Draft = { id?: Id<"courtItems">; title: string; matterId: string; party: string; at: string; status: string; notes: string };

const COPY: Record<CourtKind, { title: string; blurb: string; party: string; at: string; empty: string; new: string; icon: typeof Gavel }> = {
  affidavit: { title: "Affidavit requests", blurb: "Affidavits solicitors have asked the practice for. Who wants each one, when it is due, and where it is up to.", party: "Requested by", at: "Due", empty: "When a solicitor asks for an affidavit, add it here so the due date is not lost in the mail.", new: "New request", icon: FileSignature },
  appearance: { title: "Court appearances", blurb: "Hearings, mentions and trials to attend. The court, the matter and when to be there.", party: "Court", at: "When", empty: "Add a hearing, mention or trial and it shows here, soonest first.", new: "New appearance", icon: Gavel },
};
const PILL: Record<Tone, string> = { neutral: "bg-muted text-fg-secondary", good: "bg-success-soft text-success", warn: "bg-warning-soft text-warning", bad: "bg-error-soft text-error", info: "bg-blue-soft text-blue" };
const TONE: Record<string, Tone> = { requested: "warn", drafting: "info", sworn: "info", sent: "good", withdrawn: "neutral", scheduled: "info", attended: "good", adjourned: "warn", vacated: "neutral" };

const toLocalInput = (t: number | undefined, withTime: boolean) => { if (!t) return ""; const d = new Date(t); const pad = (n: number) => String(n).padStart(2, "0"); const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; return withTime ? `${date}T${pad(d.getHours())}:${pad(d.getMinutes())}` : date; };
const fromLocalInput = (s: string, withTime: boolean) => (s ? new Date(withTime ? s : `${s}T09:00`).getTime() : undefined);

/** One page per kind of court item, sharing the table, the form and the status flow. */
export function CourtPage({ kind }: { kind: CourtKind }) {
  const copy = COPY[kind];
  const withTime = kind === "appearance";
  const rows = useQuery(api.court.list, { kind });
  const matters = useQuery(api.matters.list, { includeClosed: true });
  const save = useMutation(api.court.save);
  const setStatus = useMutation(api.court.setStatus);
  const remove = useMutation(api.court.remove);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showDone, setShowDone] = useState(false);
  const [q, setQ] = useState("");

  const now = useNow();
  const week = now + 7 * 86_400_000;
  const open = (rows ?? []).filter((r) => !r.done);
  const soon = open.filter((r) => r.at && r.at >= now && r.at <= week).length;
  const overdue = open.filter((r) => r.at && r.at < now).length;
  const visible = useMemo(() => (rows ?? []).filter((r) => (showDone || !r.done) && (!q.trim() || [r.title, r.party, r.matter?.name, r.notes].some((v) => v?.toLowerCase().includes(q.trim().toLowerCase())))), [rows, showDone, q]);
  const exportTable = () => ({ title: copy.title, subtitle: `${visible.length} items${showDone ? " including finished" : ""}`, filename: `${kind}s-${new Date().toISOString().slice(0, 10)}`, columns: [{ key: "title", label: "Title" }, { key: "matter", label: "Matter" }, { key: "party", label: copy.party }, { key: "at", label: copy.at }, { key: "status", label: "Status" }, { key: "notes", label: "Notes" }], rows: visible.map((r) => ({ title: r.title, matter: r.matter?.name ?? "", party: r.party ?? "", at: r.at ? (withTime ? when(r.at) : day(r.at)) : "", status: r.status, notes: r.notes ?? "" })) });

  const edit = (r?: Row) => setDraft(r ? { id: r._id, title: r.title, matterId: r.matterId ?? "", party: r.party ?? "", at: toLocalInput(r.at, withTime), status: r.status, notes: r.notes ?? "" } : { title: "", matterId: "", party: "", at: "", status: STATUSES[kind][0], notes: "" });
  const submit = async () => {
    if (!draft) return;
    try { await save({ id: draft.id, kind, title: draft.title, matterId: (draft.matterId || undefined) as Id<"matters"> | undefined, party: draft.party || undefined, at: fromLocalInput(draft.at, withTime), status: draft.status, notes: draft.notes || undefined }); toast.success(draft.id ? "Saved" : "Added"); setDraft(null); }
    catch (e) { toast.error(errorMessage(e)); }
  };
  const Icon = copy.icon;

  return (
    <div className="space-y-5">
      <PageHeader title={copy.title} blurb={copy.blurb} actions={<><ExportMenu table={exportTable} disabled={!visible.length} /><Button onClick={() => edit()}><Plus className="size-3.5" />{copy.new}</Button></>} />
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Kpi label="Open" value={rows ? open.length : "…"} sub={kind === "affidavit" ? "not yet sent" : "still to attend"} />
        <Kpi label="Next 7 days" value={rows ? soon : "…"} tone={soon ? "warn" : undefined} sub={kind === "affidavit" ? "due this week" : "in court this week"} />
        <Kpi label={kind === "affidavit" ? "Overdue" : "Date passed"} value={rows ? overdue : "…"} tone={overdue ? "bad" : undefined} sub={kind === "affidavit" ? "past their due date" : "not marked attended"} />
        <Kpi label="Finished" value={rows ? rows.length - open.length : "…"} sub={kind === "affidavit" ? "sent or withdrawn" : "attended, adjourned, vacated"} />
      </div>
      <Panel>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setShowDone(false)} className={cn("rounded-full px-2.5 py-1 text-xs", !showDone ? "bg-foreground text-background" : "bg-muted text-fg-secondary hover:text-foreground")}>Open</button>
          <button type="button" onClick={() => setShowDone(true)} className={cn("rounded-full px-2.5 py-1 text-xs", showDone ? "bg-foreground text-background" : "bg-muted text-fg-secondary hover:text-foreground")}>Everything</button>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search title, ${copy.party.toLowerCase()}, matter`} className="ml-auto h-8 w-60" />
        </div>
        {rows === undefined ? <Loading rows={4} /> : visible.length === 0 ? <Empty title={rows.length ? (showDone ? "Nothing matches" : "Nothing open") : `No ${copy.title.toLowerCase()} yet`} body={rows.length ? "Try another filter." : copy.empty} action={!rows.length ? <Button size="sm" onClick={() => edit()}><Plus className="size-3.5" />{copy.new}</Button> : undefined} /> : (
          <DataTable head={<><th>{kind === "affidavit" ? "Affidavit" : "Appearance"}</th><th>Matter</th><th>{copy.party}</th><th>{copy.at}</th><th>Status</th><th></th></>} minWidth={760}>
            {visible.map((r) => {
              const late = !r.done && r.at && r.at < now;
              return (
                <tr key={r._id} className={cn("group hover:bg-muted/50", late && "bg-error-soft/30")}>
                  <td><div className="flex items-start gap-2"><Icon className="mt-0.5 size-4 shrink-0 text-fg-tertiary" /><div className="min-w-0"><div className="truncate font-medium">{r.title}</div>{r.notes && <div className="truncate text-xs text-fg-tertiary" title={r.notes}>{r.notes}</div>}</div></div></td>
                  <td className="text-xs">{r.matter ? <Link href={`/matters/${r.matter._id}`} className="hover:underline">{r.matter.name}</Link> : <span className="text-fg-quaternary">—</span>}{r.matter?.courtFileNo && <div className="text-fg-tertiary">{r.matter.courtFileNo}</div>}</td>
                  <td className="text-xs">{r.party ?? (r.matter?.court && kind === "appearance" ? r.matter.court : "—")}</td>
                  <td className={cn("text-xs", late ? "text-error" : "text-fg-secondary")}>{r.at ? <>{weekday(r.at)}{withTime && <div className="text-fg-tertiary">{time(r.at)}</div>}</> : "—"}</td>
                  <td><select value={r.status} onChange={(e) => setStatus({ id: r._id, status: e.target.value }).catch((err) => toast.error(errorMessage(err)))} className={cn("h-6 cursor-pointer appearance-none rounded-full border-0 px-2.5 text-[11px] font-medium outline-none ring-1 ring-transparent hover:ring-border", PILL[TONE[r.status] ?? "neutral"])} aria-label="Status" title="Change status">{STATUSES[kind].map((s) => <option key={s} value={s}>{s}</option>)}</select></td>
                  <td><div className="flex justify-end gap-0.5 opacity-60 group-hover:opacity-100"><button type="button" onClick={() => edit(r)} className="inline-flex size-7 items-center justify-center rounded-md text-fg-secondary hover:bg-muted hover:text-foreground" title="Edit" aria-label="Edit"><Pencil className="size-3.5" /></button><button type="button" onClick={() => { if (confirm(`Delete “${r.title}”?`)) void remove({ id: r._id }); }} className="inline-flex size-7 items-center justify-center rounded-md text-fg-secondary hover:bg-muted hover:text-foreground" title="Delete" aria-label="Delete"><Trash2 className="size-3.5" /></button></div></td>
                </tr>
              );
            })}
          </DataTable>
        )}
      </Panel>
      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setDraft(null)}>
          <form className="hd-pop w-full max-w-md space-y-3 rounded-2xl bg-card p-5 shadow-float" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); void submit(); }} role="dialog" aria-label={copy.new}>
            <h2 className="font-display text-xl">{draft.id ? "Edit" : copy.new}</h2>
            <div><Label htmlFor="c-title">{kind === "affidavit" ? "Affidavit" : "Appearance"}</Label><Input id="c-title" required autoFocus value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder={kind === "affidavit" ? "Affidavit of Dr Fraser re Smith" : "Interim hearing, Smith & Smith"} /></div>
            <div><Label htmlFor="c-matter">Matter</Label><select id="c-matter" value={draft.matterId} onChange={(e) => { const m = (matters ?? []).find((x) => x._id === e.target.value); setDraft({ ...draft, matterId: e.target.value, party: draft.party || (kind === "appearance" && m?.court ? m.court : draft.party) }); }} className="mt-1 h-9 w-full rounded-lg border border-input bg-card px-2 text-sm"><option value="">No matter</option>{(matters ?? []).map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}</select></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor="c-party">{copy.party}</Label><Input id="c-party" value={draft.party} onChange={(e) => setDraft({ ...draft, party: e.target.value })} placeholder={kind === "affidavit" ? "Solicitor or firm" : "Federal Circuit and Family Court"} /></div>
              <div><Label htmlFor="c-at">{copy.at}</Label><Input id="c-at" type={withTime ? "datetime-local" : "date"} className="num" value={draft.at} onChange={(e) => setDraft({ ...draft, at: e.target.value })} /></div>
            </div>
            <div><Label htmlFor="c-status">Status</Label><select id="c-status" value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })} className="mt-1 h-9 w-full rounded-lg border border-input bg-card px-2 text-sm">{STATUSES[kind].map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
            <div><Label htmlFor="c-notes">Notes</Label><textarea id="c-notes" rows={3} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus:border-foreground" /></div>
            <div className="flex gap-2"><Button type="submit">{draft.id ? "Save" : "Add"}</Button><Button type="button" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button></div>
          </form>
        </div>
      )}
    </div>
  );
}
