"use client";

import { useState } from "react";
import { PrefetchLink } from "@/components/prefetch-link";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { PageHeader, Panel, Pill, statusTone, Empty, Loading, DataTable } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { aud, ago, day } from "@/lib/format";
import { ExportMenu } from "@/components/export/export-menu";
import { errorMessage } from "@/lib/utils";
import { SubpoenaExport } from "./subpoena-export";

/** Court matters: the spine that emails, tasks, files, invoices and the subpoena export hang off. */
export function MattersList() {
  const [includeClosed, setIncludeClosed] = useState(false);
  const matters = useQuery(api.matters.list, { includeClosed });
  const save = useMutation(api.matters.save);
  const [draft, setDraft] = useState<{ name: string; courtFileNo: string; court: string; parties: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  return (
    <div className="space-y-5">
      <PageHeader title="Subpoena export" blurb="One record per court matter. Link emails from Mail, tasks from Tasks, files and invoices here, then export the lot for a subpoena." actions={<><ExportMenu disabled={!matters?.length} table={() => ({ title: "Matters", subtitle: `${matters?.length ?? 0} matters${includeClosed ? " including closed" : ""}`, filename: `matters-${new Date().toISOString().slice(0, 10)}`, columns: [{ key: "name", label: "Matter" }, { key: "file", label: "Court file" }, { key: "court", label: "Court" }, { key: "parties", label: "Parties" }, { key: "status", label: "Status" }, { key: "emails", label: "Emails", align: "right" as const }, { key: "tasks", label: "Open tasks", align: "right" as const }, { key: "files", label: "Files", align: "right" as const }, { key: "invoices", label: "Invoices", align: "right" as const }, { key: "paid", label: "Paid" }, { key: "owing", label: "Owing", align: "right" as const }, { key: "delivered", label: "Report delivered" }], rows: (matters ?? []).map((m) => ({ name: m.name, file: m.courtFileNo ?? "", court: m.court ?? "", parties: m.parties.join("; "), status: m.status.replace("_", " "), emails: m.counts.threads, tasks: m.counts.tasks, files: m.counts.files, invoices: m.counts.invoices, paid: m.paid ? "yes" : "", owing: (m.unpaidCents / 100).toFixed(2), delivered: m.reportDeliveredAt ? day(m.reportDeliveredAt) : "" })) })} /><label className="flex items-center gap-1.5 text-xs text-fg-tertiary"><input type="checkbox" className="size-3.5 accent-foreground" checked={includeClosed} onChange={(e) => setIncludeClosed(e.target.checked)} />show closed</label><Button variant="outline" onClick={() => setDraft({ name: "", courtFileNo: "", court: "", parties: "" })}>Add matter</Button><Button onClick={() => setExporting(true)}>New export</Button></>} />
      {draft && (
        <Panel title="New matter" dense>
          <form className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2" onSubmit={async (e) => { e.preventDefault(); try { await save({ name: draft.name, courtFileNo: draft.courtFileNo || undefined, court: draft.court || undefined, parties: draft.parties.split(/[;\n]/).map((p) => p.trim()).filter(Boolean), clinikoPatientIds: [] }); setDraft(null); toast.success("Matter created"); } catch (err) { toast.error(errorMessage(err)); } }}>
            <div className="sm:col-span-2"><Label htmlFor="m-name">Name</Label><Input id="m-name" autoFocus required value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Smith & Jones (family report)" /></div>
            <div><Label htmlFor="m-file">Court file number</Label><Input id="m-file" value={draft.courtFileNo} onChange={(e) => setDraft({ ...draft, courtFileNo: e.target.value })} placeholder="MLC1234/2026" /></div>
            <div><Label htmlFor="m-court">Court</Label><Input id="m-court" value={draft.court} onChange={(e) => setDraft({ ...draft, court: e.target.value })} placeholder="Federal Circuit and Family Court, Melbourne" /></div>
            <div className="sm:col-span-2"><Label htmlFor="m-parties">Parties (one per line or separated by ;)</Label><Input id="m-parties" value={draft.parties} onChange={(e) => setDraft({ ...draft, parties: e.target.value })} placeholder="Jane Smith; John Jones; ICL" /></div>
            <div className="flex gap-2 sm:col-span-2"><Button type="submit">Create</Button><Button type="button" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button></div>
          </form>
        </Panel>
      )}
      <Panel>
        {matters === undefined ? <Loading rows={4} /> : matters.length === 0 ? <Empty title="No matters yet" body="Create one here, or from the Matter button on any email." /> : (
          <DataTable head={<><th>Matter</th><th>Status</th><th>Emails</th><th>Tasks</th><th>Files</th><th>Invoices</th><th>Report</th><th>Updated</th></>} minWidth={760}>
            {matters.map((m) => (
              <tr key={m._id} className="hover:bg-muted/50">
                <td><PrefetchLink href={`/matters/${m._id}`} className="font-medium hover:underline">{m.name}</PrefetchLink>{m.courtFileNo && <div className="text-xs text-fg-tertiary">{m.courtFileNo}</div>}</td>
                <td><Pill tone={statusTone(m.status)}>{m.status.replace("_", " ")}</Pill></td>
                <td className="num">{m.counts.threads}</td>
                <td className="num">{m.counts.tasks}</td>
                <td className="num">{m.counts.files}</td>
                <td>{m.counts.invoices ? <Pill tone={m.paid ? "good" : "warn"}>{m.paid ? "paid" : `${aud(m.unpaidCents, { whole: true })} owing`}</Pill> : <span className="text-fg-quaternary">—</span>}</td>
                <td>{m.reportDeliveredAt ? <Pill tone="good">delivered</Pill> : m.status === "report_due" ? <Pill tone="warn">due</Pill> : <span className="text-fg-quaternary">—</span>}</td>
                <td className="text-xs text-fg-tertiary">{ago(m.updatedAt)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
      {exporting && <SubpoenaExport pickSource onClose={() => setExporting(false)} />}
    </div>
  );
}
