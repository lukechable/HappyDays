"use client";

import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { ExternalLink, AlertTriangle, FileText, Briefcase, Plus } from "lucide-react";
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
export function PatientPanel({ patientId }: { patientId: number }) {
  const now = useNow();
  const live = useLive(api.bookings.patient, Number.isFinite(patientId) ? { patientId } : "skip");
  const matters = useQuery(api.matters.list, {});
  const save = useMutation(api.matters.save);
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
