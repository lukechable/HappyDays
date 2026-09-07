"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { PageHeader, Panel, Pill, statusTone, Facts, Empty, Loading } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SubpoenaExport } from "./subpoena-export";
import { aud, day, ago, bytes, mailDate, dueLabel } from "@/lib/format";
import { errorMessage } from "@/lib/utils";

export function MatterDetail({ id }: { id: Id<"matters"> }) {
  const m = useQuery(api.matters.get, { id });
  const save = useMutation(api.matters.save);
  const setStatus = useMutation(api.matters.setStatus);
  const markDelivered = useMutation(api.matters.markDelivered);
  const remove = useMutation(api.matters.remove);
  const createCase = useAction(api.bookings.createCase);
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<{ name: string; courtFileNo: string; court: string; parties: string; notes: string; patients: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  if (m === undefined) return <Loading rows={6} />;
  if (m === null) return <Empty title="Matter not found" action={<Button render={<Link href="/matters" />}>All matters</Button>} />;
  const startEdit = () => { setForm({ name: m.name, courtFileNo: m.courtFileNo ?? "", court: m.court ?? "", parties: m.parties.join("; "), notes: m.notes ?? "", patients: m.clinikoPatientIds.join(", ") }); setEditing(true); };
  return (
    <div className="space-y-5">
      <PageHeader title={m.name} blurb={[m.courtFileNo, m.court].filter(Boolean).join(" · ") || undefined} meta={<span className="inline-flex items-center gap-2"><Pill tone={statusTone(m.status)}>{m.status.replace("_", " ")}</Pill>{m.reportDeliveredAt && <span>Report delivered {day(m.reportDeliveredAt)} via {m.reportDeliveredVia}{m.deliveredBy ? ` by ${m.deliveredBy}` : ""}</span>}</span>}
        actions={<>
          <select value={m.status} onChange={(e) => setStatus({ id, status: e.target.value as "open" | "report_due" | "delivered" | "closed" })} className="h-8 rounded-lg border border-input bg-card px-2 text-sm"><option value="open">Open</option><option value="report_due">Report due</option><option value="delivered">Delivered</option><option value="closed">Closed</option></select>
          {m.reportDeliveredAt ? <Button variant="outline" onClick={() => markDelivered({ id, via: "manual", undo: true })}>Undo delivered</Button> : <Button variant="outline" onClick={() => markDelivered({ id, via: "manual" })}>Mark report delivered</Button>}
          <Button onClick={() => setExporting(true)}>Subpoena export</Button>
          <Button variant="ghost" onClick={startEdit}>Edit</Button>
        </>} />

      {editing && form && (
        <Panel title="Edit matter" dense>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); try { await save({ id, name: form.name, courtFileNo: form.courtFileNo || undefined, court: form.court || undefined, parties: form.parties.split(/[;\n]/).map((p) => p.trim()).filter(Boolean), clinikoPatientIds: form.patients.split(/[,\s]+/).map((x) => x.trim()).filter((x) => /^\d+$/.test(x)), notes: form.notes || undefined, status: m.status }); setEditing(false); toast.success("Saved"); } catch (err) { toast.error(errorMessage(err)); } }}>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Name" required className="sm:col-span-2" />
            <Input value={form.courtFileNo} onChange={(e) => setForm({ ...form, courtFileNo: e.target.value })} placeholder="Court file number" />
            <Input value={form.court} onChange={(e) => setForm({ ...form, court: e.target.value })} placeholder="Court" />
            <Input value={form.parties} onChange={(e) => setForm({ ...form, parties: e.target.value })} placeholder="Parties, separated by ;" className="sm:col-span-2" />
            <Input value={form.patients} onChange={(e) => setForm({ ...form, patients: e.target.value })} placeholder="Cliniko patient ids, comma separated" className="sm:col-span-2" />
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Notes" rows={3} className="sm:col-span-2" />
            <div className="flex gap-2 sm:col-span-2"><Button type="submit">Save</Button><Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button><Button type="button" variant="destructive" className="ml-auto" onClick={async () => { if (confirm("Delete this matter? Emails, tasks and files stay but are unlinked.")) { await remove({ id }); router.push("/matters"); } }}>Delete matter</Button></div>
          </form>
        </Panel>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        <Panel title="Details" dense>
          <Facts items={[["Parties", m.parties.length ? m.parties.join("; ") : "—"], ["Cliniko patients", m.clinikoPatientIds.length ? m.clinikoPatientIds.map((p) => <Link key={p} href={`/bookings/patients/${p}`} className="mr-2 underline">#{p}</Link>) : "—"], ["Cliniko cases", (m.clinikoCases ?? []).length ? (m.clinikoCases ?? []).map((c) => <span key={c.caseId} className="mr-2">{c.name}</span>) : "—"], ["Notes", m.notes ? <span className="whitespace-pre-wrap">{m.notes}</span> : "—"], ["Updated", ago(m.updatedAt)]]} />
          {m.clinikoPatientIds.filter((p) => !(m.clinikoCases ?? []).some((c) => c.patientId === p)).length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">{m.clinikoPatientIds.filter((p) => !(m.clinikoCases ?? []).some((c) => c.patientId === p)).map((p) => <Button key={p} size="xs" variant="outline" onClick={async () => { try { await createCase({ patientId: p, name: m.name, notes: [m.courtFileNo ? `File ${m.courtFileNo}` : "", m.court ?? "", "Created from Happy Days"].filter(Boolean).join(" · "), matterId: id }); toast.success("Case created in Cliniko"); } catch (e) { toast.error(errorMessage(e)); } }}>Create Cliniko case for #{p}</Button>)}</div>
          )}
        </Panel>
        <Panel title="Money" dense actions={<Button size="xs" variant="ghost" render={<Link href={`/money?matter=${id}`} />}>Money page</Button>}>
          {m.invoices.length === 0 ? <p className="text-sm text-fg-tertiary">No Stripe invoice linked. Raise one from the Money page.</p> : (
            <ul className="divide-y divide-border/70 text-sm">{m.invoices.map((i) => <li key={i._id} className="flex items-center gap-2 py-1.5"><span className="num">{i.number ?? i.stripeId.slice(0, 10)}</span><span className="flex-1 truncate text-fg-tertiary">{i.description}</span><span className="num">{aud(i.amountDueCents)}</span><Pill tone={statusTone(i.status)}>{i.status}</Pill>{i.hostedUrl && <a href={i.hostedUrl} target="_blank" rel="noreferrer" className="text-xs underline">open</a>}</li>)}</ul>
          )}
        </Panel>
        <Panel title="Delivery" dense>
          {m.codes.length === 0 && m.signatureRequests.length === 0 ? <p className="text-sm text-fg-tertiary">No download codes or signature requests yet. Create them from Files.</p> : (
            <ul className="space-y-1 text-sm">
              {m.codes.map((c) => <li key={c._id} className="flex items-center gap-2"><span className="num font-medium">{c.code}</span><span className="flex-1 truncate text-fg-tertiary">{c.recipientName ?? c.recipientEmail ?? "—"}</span><Pill tone={c.revokedAt ? "bad" : c.downloadCount ? "good" : "warn"}>{c.revokedAt ? "revoked" : c.downloadCount ? `downloaded ×${c.downloadCount}` : "waiting"}</Pill></li>)}
              {m.signatureRequests.map((s) => <li key={s._id} className="flex items-center gap-2"><span className="flex-1 truncate">{s.signerName}</span><Pill tone={statusTone(s.status)}>{s.status}</Pill></li>)}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Panel title={`Emails (${m.threads.length})`} blurb="Linked from Mail with the Matter button." dense>
          {m.threads.length === 0 ? <p className="text-sm text-fg-tertiary">Nothing linked yet.</p> : (
            <ul className="divide-y divide-border/70">{m.threads.map((t) => <li key={t.threadId} className="py-1.5 text-sm">{t.gmailThreadId ? <Link href={`/mail?thread=${t.gmailThreadId}`} className="hover:underline">{t.subject}</Link> : <span title="Not in your mailbox">{t.subject}</span>}<div className="flex gap-2 text-xs text-fg-tertiary"><span>{mailDate(t.lastMessageAt)}</span>{t.repliedBy.length > 0 && <span className="text-success">{t.repliedBy.join(", ")} replied</span>}</div></li>)}</ul>
          )}
        </Panel>
        <Panel title={`Tasks (${m.tasks.filter((t) => t.status !== "done").length} open)`} dense actions={<Button size="xs" variant="ghost" render={<Link href={`/tasks?view=all`} />}>Tasks</Button>}>
          {m.tasks.length === 0 ? <p className="text-sm text-fg-tertiary">No tasks yet.</p> : <ul className="divide-y divide-border/70">{m.tasks.map((t) => <li key={t._id} className="flex items-center gap-2 py-1.5 text-sm"><Link href={`/tasks?task=${t._id}`} className={t.status === "done" ? "flex-1 text-fg-tertiary line-through" : "flex-1 hover:underline"}>{t.title}</Link>{t.dueAt && <span className="text-xs text-fg-tertiary">{dueLabel(t.dueAt)}</span>}</li>)}</ul>}
        </Panel>
        <Panel title={`Files (${m.files.length})`} dense actions={<Button size="xs" variant="ghost" render={<Link href={`/files?matter=${id}`} />}>Files</Button>} className="lg:col-span-2">
          {m.files.length === 0 ? <p className="text-sm text-fg-tertiary">No files. Upload a report from Files and link it here.</p> : <ul className="divide-y divide-border/70">{m.files.map((f) => <li key={f._id} className="flex items-center gap-2 py-1.5 text-sm"><Link href={`/files?file=${f._id}`} className="flex-1 truncate hover:underline">{f.name}</Link>{f.isReport && <Pill tone="info">report</Pill>}<span className="text-xs text-fg-tertiary">v{f.version} · {bytes(f.size)} · {day(f.createdAt)}</span></li>)}</ul>}
        </Panel>
      </div>

      {exporting && <SubpoenaExport matterId={id} matterName={m.name} onClose={() => setExporting(false)} />}
    </div>
  );
}
