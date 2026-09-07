"use client";

import Link from "next/link";
import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { ExternalLink, AlertTriangle, FileText, Briefcase, Plus, NotebookPen, FolderOpen, ClipboardList, Send } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { PageHeader, Panel, Pill, statusTone, Facts, Loading, ErrorBox, DataTable } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { useLive, useNow } from "@/lib/hooks";
import { day, time, ago } from "@/lib/format";
import { errorMessage } from "@/lib/utils";

/**
 * A patient, read live from Cliniko: contact, alerts, appointments, Cliniko attachments (opened there, never
 * copied), Cliniko invoices, and the Happy Days matters that reference this patient.
 */
export function PatientPanel({ patientId }: { patientId: string }) {
  const now = useNow();
  const live = useLive(api.bookings.patient, patientId ? { patientId } : "skip");
  const matters = useQuery(api.matters.list, {});
  const save = useMutation(api.matters.save);
  const createCase = useAction(api.bookings.createCase);
  const sendForm = useAction(api.bookings.sendForm);
  const formTemplates = useLive(api.bookings.formTemplates, {});
  const [newCase, setNewCase] = useState<string | null>(null);
  const [formTemplate, setFormTemplate] = useState("");
  const [busy, setBusy] = useState(false);
  const p = live.data;
  if (live.error) return <ErrorBox title="Couldn’t load this patient from Cliniko" message={live.error} retry={live.reload} />;
  if (!p) return <Loading rows={6} />;
  const linkable = (matters ?? []).filter((m) => !m.clinikoPatientIds.includes(patientId));
  const link = async (id: (typeof linkable)[number]) => { try { await save({ id: id._id, name: id.name, courtFileNo: id.courtFileNo, court: id.court, parties: id.parties, clinikoPatientIds: [...id.clinikoPatientIds, patientId], notes: id.notes, status: id.status }); toast.success(`Linked to ${id.name}`); live.reload(); } catch (e) { toast.error(errorMessage(e)); } };
  return (
    <div className="space-y-6">
      <PageHeader title={p.name} blurb={[p.dob ? `DOB ${day(p.dob)}` : "", p.email, p.phone].filter(Boolean).join(" · ")} meta={<span>Cliniko record updated {ago(Date.parse(p.updatedAt))}. Nothing here is stored by Happy Days.</span>} actions={<><Button variant="outline" render={<a href={p.clinikoUrl} target="_blank" rel="noreferrer" />}><ExternalLink className="size-3.5" />Open in Cliniko</Button><Button render={<Link href={`/bookings?d=${now}`} />}><Plus className="size-3.5" />Book</Button></>} />
      {(p.alerts.length > 0 || p.medicalAlerts) && <div className="flex items-start gap-2 rounded-2xl bg-warning-soft px-4 py-3 text-sm"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" /><div><b className="font-semibold">Alerts:</b> {[...p.alerts, p.medicalAlerts].filter(Boolean).join("; ")}</div></div>}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Contact" dense><Facts items={[["Email", p.email ? <a href={`mailto:${p.email}`} className="underline">{p.email}</a> : "—"], ["Phones", p.phones.length ? p.phones.map((x) => `${x.number} (${x.phone_type})`).join(", ") : "—"], ["Address", p.address || "—"], ["Preferred name", p.preferredName || "—"]]} />{p.notes && <p className="mt-3 whitespace-pre-wrap rounded-lg bg-muted px-2.5 py-1.5 text-xs">{p.notes}</p>}</Panel>
        <Panel title="Matters" dense blurb="Happy Days matters that reference this patient.">
          {p.matters.length === 0 ? <p className="text-sm text-fg-tertiary">None yet.</p> : <ul className="space-y-1">{p.matters.map((m) => <li key={m._id}><Link href={`/matters/${m._id}`} className="inline-flex items-center gap-1.5 text-sm hover:underline"><Briefcase className="size-3.5" />{m.name}<Pill tone={statusTone(m.status)}>{m.status.replace("_", " ")}</Pill></Link></li>)}</ul>}
          {linkable.length > 0 && <select className="mt-2 h-8 w-full rounded-lg border border-input bg-card px-2 text-xs" defaultValue="" onChange={(e) => { const m = linkable.find((x) => x._id === e.target.value); if (m) void link(m); e.target.value = ""; }}><option value="">Link to a matter…</option>{linkable.map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}</select>}
        </Panel>
        <Panel title="Files in Cliniko" dense blurb="Stored in Cliniko. Links open there.">
          {p.attachments.length === 0 ? <p className="text-sm text-fg-tertiary">No attachments.</p> : <ul className="space-y-1 text-sm">{p.attachments.map((a) => <li key={a.id} className="flex items-center gap-2"><FileText className="size-3.5 text-fg-tertiary" />{a.url ? <a href={a.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">{a.filename}</a> : <a href={p.clinikoUrl} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">{a.filename}</a>}<span className="text-xs text-fg-tertiary">{day(a.createdAt)}</span></li>)}</ul>}
        </Panel>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Treatment notes" dense blurb="Titles and dates only. Notes open in Cliniko.">
          {p.treatmentNotes.length === 0 ? <p className="text-sm text-fg-tertiary">No notes.</p> : <ul className="space-y-1 text-sm">{p.treatmentNotes.slice(0, 8).map((n) => <li key={n.id} className="flex items-center gap-2"><NotebookPen className="size-3.5 shrink-0 text-fg-tertiary" /><a href={n.clinikoUrl} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">{n.title}</a>{n.draft && <Pill tone="warn">draft</Pill>}<span className="shrink-0 text-xs text-fg-tertiary">{day(n.createdAt)}{n.author ? ` · ${n.author}` : ""}</span></li>)}</ul>}
        </Panel>
        <Panel title="Cases" dense blurb="Cliniko cases for this patient." actions={<Button size="xs" variant="ghost" onClick={() => setNewCase("")}><Plus className="size-3" />New</Button>}>
          {p.cases.length === 0 && newCase === null ? <p className="text-sm text-fg-tertiary">No cases.</p> : <ul className="space-y-1 text-sm">{p.cases.map((c) => <li key={c.id} className="flex items-center gap-2"><FolderOpen className="size-3.5 shrink-0 text-fg-tertiary" /><a href={c.clinikoUrl} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">{c.name}</a><Pill tone={c.closed ? "neutral" : "good"}>{c.closed ? "closed" : "open"}</Pill></li>)}</ul>}
          {newCase !== null && <form className="mt-2 flex gap-1" onSubmit={async (e) => { e.preventDefault(); if (!newCase.trim()) return; setBusy(true); try { await createCase({ patientId, name: newCase.trim() }); toast.success("Case created in Cliniko"); setNewCase(null); live.reload(); } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); } }}><input autoFocus value={newCase} onChange={(e) => setNewCase(e.target.value)} placeholder="Case name" className="h-8 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-sm" /><Button size="sm" type="submit" disabled={busy}>Create</Button><Button size="sm" type="button" variant="ghost" onClick={() => setNewCase(null)}>Cancel</Button></form>}
        </Panel>
        <Panel title="Forms" dense blurb="Intake and consent forms from Cliniko templates.">
          {p.forms.length === 0 ? <p className="text-sm text-fg-tertiary">No forms yet.</p> : <ul className="space-y-1 text-sm">{p.forms.map((f) => <li key={f.id} className="flex items-center gap-2"><ClipboardList className="size-3.5 shrink-0 text-fg-tertiary" /><a href={f.clinikoUrl} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">{f.name}</a><Pill tone={f.completed ? "good" : "warn"}>{f.completed ? `done ${f.completedAt ? day(f.completedAt) : ""}` : "waiting"}</Pill></li>)}</ul>}
          <form className="mt-2 flex gap-1" onSubmit={async (e) => { e.preventDefault(); if (!formTemplate) return; setBusy(true); try { const f = await sendForm({ patientId, templateId: formTemplate }); if (f.url) { await navigator.clipboard.writeText(f.url).catch(() => undefined); toast.success(`${f.name} created. Link copied; Cliniko will email it too.`); } else toast.success(`${f.name} created in Cliniko`); live.reload(); } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); } }}>
            <select value={formTemplate} onChange={(e) => setFormTemplate(e.target.value)} className="h-8 min-w-0 flex-1 rounded-md border border-input bg-card px-2 text-xs"><option value="">Send a form…</option>{(formTemplates.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
            <Button size="sm" type="submit" disabled={!formTemplate || busy}><Send className="size-3" />Send</Button>
          </form>
        </Panel>
      </div>
      <Panel title="Appointments" dense>
        {p.appointments.length === 0 ? <p className="text-sm text-fg-tertiary">No appointments.</p> : (
          <DataTable head={<><th>When</th><th>Type</th><th>Practitioner</th><th>Status</th><th></th></>} minWidth={560}>
            {p.appointments.map((a) => <tr key={a.id}><td className="num whitespace-nowrap">{day(a.startsAt)} {time(a.startsAt)}</td><td>{a.typeName}</td><td>{a.practitionerName}</td><td>{a.cancelledAt ? <Pill tone="bad">cancelled</Pill> : a.didNotArrive ? <Pill tone="warn">did not arrive</Pill> : Date.parse(a.endsAt) < now ? <Pill tone="neutral">attended</Pill> : <Pill tone="info">upcoming</Pill>}</td><td><a href={a.clinikoUrl} target="_blank" rel="noreferrer" className="text-xs text-fg-tertiary hover:text-foreground">Cliniko ↗</a></td></tr>)}
          </DataTable>
        )}
      </Panel>
      {p.invoices.length > 0 && (
        <Panel title="Invoices in Cliniko" dense blurb="Historic Cliniko invoices. New invoices are raised in Stripe from the Money page.">
          <DataTable head={<><th>Number</th><th>Issued</th><th>Total</th><th>Status</th><th></th></>} minWidth={480}>
            {p.invoices.map((i) => <tr key={i.id}><td className="num">{i.number}</td><td>{day(i.issueDate)}</td><td className="num">${i.total.toFixed(2)}</td><td><Pill tone={i.closedAt ? "good" : "warn"}>{i.status}</Pill></td><td><a href={i.clinikoUrl} target="_blank" rel="noreferrer" className="text-xs text-fg-tertiary hover:text-foreground">Cliniko ↗</a></td></tr>)}
          </DataTable>
        </Panel>
      )}
    </div>
  );
}
