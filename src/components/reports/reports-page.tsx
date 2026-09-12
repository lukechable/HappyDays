"use client";

import { useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { Upload, FileText, Eye, PenLine, Lock, KeyRound, Trash2, ArrowLeftRight, Check, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { ReportKind } from "../../../convex/files";
import { PageHeader, Panel, Pill, Kpi, Empty, Loading, DataTable } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PrefetchLink } from "@/components/prefetch-link";
import { ExportMenu } from "@/components/export/export-menu";
import { SendDialog, useStoredFileLoader } from "@/components/files/send-dialog";
import { replaceSearch } from "@/lib/shallow";
import { sha256 } from "@/lib/compose-handoff";
import { bytes, day } from "@/lib/format";
import { cn, errorMessage } from "@/lib/utils";

const COPY: Record<ReportKind, { title: string; blurb: string; other: ReportKind; empty: string }> = {
  therapy: { title: "Therapy reports", blurb: "Therapy reports the practice has written, with the matter each one belongs to, whether it has gone out, and how.", other: "family", empty: "Upload a therapy report, or move one across from Family reports." },
  family: { title: "Family reports", blurb: "Family reports for the court, with the matter each one belongs to, whether it has gone out, and how.", other: "therapy", empty: "Upload a family report, or move one across from Therapy reports." },
};

/** One list per report kind. Uploads here are marked as reports of this kind; everything else is the stored file. */
export function ReportsPage({ kind }: { kind: ReportKind }) {
  const copy = COPY[kind];
  const base = `/reports/${kind}`;
  const params = useSearchParams();
  const matterFilter = params.get("matter") as Id<"matters"> | null;
  const [q, setQ] = useState("");
  const filter = ["delivered", "pending", "unlinked"].find(f => f === params.get("filter")) ?? "all";
  const setFilter = (filter: string) => replaceSearch(base, { filter: filter === "all" ? undefined : filter });
  const reports = useQuery(api.files.reports, { kind });
  const matters = useQuery(api.matters.list, { includeClosed: true });
  const uploadUrl = useMutation(api.files.uploadUrl);
  const register = useMutation(api.files.register);
  const update = useMutation(api.files.update);
  const remove = useMutation(api.files.remove);
  const markDelivered = useMutation(api.matters.markDelivered);
  const [uploading, setUploading] = useState(0);
  const [toSend, setToSend] = useState<{ files: File[]; matterId?: Id<"matters"> | null } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const loadStored = useStoredFileLoader();

  const upload = async (list: FileList | File[], replaces?: Id<"files">) => {
    const arr = Array.from(list);
    setUploading(arr.length);
    let succeeded = 0;
    for (const file of arr) {
      try {
        const url = await uploadUrl({});
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
        if (!res.ok) throw new Error("Upload failed. Please try again.");
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        await register({ storageId, name: file.name, mime: file.type || "application/octet-stream", size: file.size, sha256: await sha256(file), matterId: matterFilter ?? undefined, isReport: true, reportKind: kind, replacesFileId: replaces });
        succeeded++;
      } catch (e) { toast.error(`${file.name}: ${errorMessage(e)}`); }
      setUploading((n) => n - 1);
    }
    if (succeeded) toast.success(`${succeeded} of ${arr.length} reports uploaded`);
  };

  const all = (reports ?? []).filter(r => !matterFilter || r.matterId === matterFilter);
  const rows = all.filter((r) => (filter === "all" || (filter === "delivered" ? !!r.matter?.deliveredAt : filter === "unlinked" ? !r.matter : !!r.matter && !r.matter.deliveredAt && r.matter.status !== "closed")) && (!q.trim() || [r.name, r.matter?.name, r.uploadedByName].some((v) => v?.toLowerCase().includes(q.trim().toLowerCase()))));
  const delivered = all.filter((r) => r.matter?.deliveredAt).length;
  const awaiting = all.filter((r) => r.matter && !r.matter.deliveredAt && r.matter.status !== "closed").length;
  const unlinked = all.filter((r) => !r.matter).length;
  const exportTable = () => ({ title: copy.title, subtitle: `${rows.length} reports${matterFilter ? " · one matter" : ""}${q ? ` · search “${q}”` : ""}`, filename: `${kind}-reports-${new Date().toISOString().slice(0, 10)}`, columns: [{ key: "name", label: "Report" }, { key: "matter", label: "Matter" }, { key: "uploaded", label: "Uploaded" }, { key: "by", label: "By" }, { key: "status", label: "Status" }, { key: "delivered", label: "Delivered" }, { key: "via", label: "Via" }, { key: "sent", label: "Last sent" }, { key: "to", label: "Sent to" }], rows: rows.map((r) => ({ name: r.name, matter: r.matter?.name ?? "", uploaded: day(r.createdAt), by: r.uploadedByName, status: statusOf(r), delivered: r.matter?.deliveredAt ? day(r.matter.deliveredAt) : "", via: r.matter?.deliveredVia ?? "", sent: r.lastSentAt ? day(r.lastSentAt) : "", to: r.lastSentTo ?? "" })) });

  return (
    <div className="space-y-5" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) void upload(e.dataTransfer.files); }}>
      <PageHeader title={copy.title} blurb={copy.blurb} actions={<><ExportMenu table={exportTable} disabled={!rows.length} /><Button onClick={() => inputRef.current?.click()}><Upload className="size-3.5" />{uploading ? `Uploading ${uploading}…` : "Upload report"}</Button><input ref={inputRef} type="file" multiple hidden onChange={(e) => { if (e.target.files) void upload(e.target.files); e.target.value = ""; }} /></>} />
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Kpi label={copy.title} value={reports ? all.length : "…"} sub="latest versions" href={`${base}${matterFilter ? `?matter=${matterFilter}` : ""}`} />
        <Kpi label="Delivered" value={reports ? delivered : "…"} tone={delivered ? "good" : undefined} sub="matter marked delivered" href={`${base}?filter=delivered${matterFilter ? `&matter=${matterFilter}` : ""}`} />
        <Kpi label="Awaiting delivery" value={reports ? awaiting : "…"} tone={awaiting ? "warn" : undefined} sub="on an open matter" href={`${base}?filter=pending${matterFilter ? `&matter=${matterFilter}` : ""}`} />
        <Kpi label="No matter" value={reports ? unlinked : "…"} sub="link one from the row" href={`${base}?filter=unlinked${matterFilter ? `&matter=${matterFilter}` : ""}`} />
      </div>
      <Panel>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {([["all", "All"], ["delivered", "Delivered"], ["pending", "Awaiting delivery"], ["unlinked", "No matter"]] as const).map(([key, label]) => <button key={key} type="button" onClick={() => setFilter(key)} aria-pressed={filter === key} className={cn("rounded-full px-2.5 py-1 text-xs", filter === key ? "bg-foreground text-background" : "bg-muted text-fg-secondary hover:text-foreground")}>{label}</button>)}
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search report, matter, who" className="ml-auto h-8 w-56" />
          <select value={matterFilter ?? ""} onChange={(e) => replaceSearch(base, { matter: e.target.value || undefined })} className="h-8 rounded-lg border border-input bg-card px-2 text-xs" aria-label="Matter"><option value="">All matters</option>{(matters ?? []).map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}</select>
        </div>
        {reports === undefined ? <Loading rows={4} /> : rows.length === 0 ? <Empty title={all.length ? "No reports match" : `No ${kind} reports yet`} body={all.length ? "Try another filter." : `${copy.empty} Drop a file anywhere on this page.`} /> : (
          <DataTable head={<><th>Report</th><th>Matter</th><th>Uploaded</th><th>Status</th><th>Sent</th><th></th></>} minWidth={820}>
            {rows.map((r) => (
              <tr key={r._id} className="group hover:bg-muted/50">
                <td><div className="flex items-center gap-2"><FileText className="size-4 shrink-0 text-fg-tertiary" /><div className="min-w-0"><div className="flex items-center gap-1.5"><span className="truncate font-medium">{r.name}</span>{r.version > 1 && <span className="text-[10px] text-fg-quaternary">v{r.version}</span>}</div><div className="text-xs text-fg-tertiary">{bytes(r.size)}{r.activeCodes.length ? ` · code ${r.activeCodes.join(", ")}` : ""}</div></div></div></td>
                <td><select value={r.matterId ?? ""} onChange={(e) => update({ id: r._id, matterId: (e.target.value || null) as Id<"matters"> | null })} className="h-7 max-w-[200px] rounded-md border border-transparent bg-transparent text-xs hover:border-input"><option value="">— link a matter —</option>{(matters ?? []).map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}</select></td>
                <td className="text-xs text-fg-tertiary">{day(r.createdAt)}<br />{r.uploadedByName}</td>
                <td>{r.matter ? r.matter.deliveredAt ? <><Pill tone="good">delivered</Pill><div className="text-[11px] text-fg-tertiary">{day(r.matter.deliveredAt)} · {r.matter.deliveredVia}</div></> : r.matter.status === "closed" ? <Pill>closed</Pill> : <button type="button" onClick={() => markDelivered({ id: r.matter!._id, via: "manual" }).catch((e) => toast.error(errorMessage(e)))} className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] text-fg-secondary hover:bg-foreground hover:text-background" title="Mark the matter's report delivered"><Check className="mr-0.5 inline size-3" />mark delivered</button> : <span className="text-xs text-fg-quaternary">no matter</span>}</td>
                <td className="text-xs text-fg-tertiary">{r.lastSentAt ? <>{day(r.lastSentAt)}<div className="truncate">{r.lastSentTo}</div></> : "—"}</td>
                <td><div className="flex justify-end gap-0.5 opacity-60 group-hover:opacity-100">
                  <RowAction label="Preview / download" href={`/files/${r._id}`} icon={<Eye className="size-3.5" />} />
                  {r.mime === "application/pdf" && <RowAction label="Open in PDF tools" href={`/pdf?file=${r._id}`} icon={<PenLine className="size-3.5" />} />}
                  <RowAction label="Encrypt and send" onClick={async () => { try { setToSend({ files: [await loadStored(r._id, r.name, r.mime)], matterId: r.matterId }); } catch (e) { toast.error(errorMessage(e)); } }} icon={<Lock className="size-3.5" />} />
                  <RowAction label="Download codes" href={`/files?tab=codes&file=${r._id}`} icon={<KeyRound className="size-3.5" />} />
                  <RowAction label="Upload new version" onClick={() => { const i = document.createElement("input"); i.type = "file"; i.onchange = () => i.files && void upload(i.files, r._id); i.click(); }} icon={<RefreshCw className="size-3.5" />} />
                  <RowAction label={`Move to ${COPY[copy.other].title}`} onClick={() => update({ id: r._id, reportKind: copy.other })} icon={<ArrowLeftRight className="size-3.5" />} />
                  <RowAction label="Delete" onClick={() => { if (confirm(`Delete “${r.name}”? Active codes for it stop working.`)) void remove({ id: r._id }); }} icon={<Trash2 className="size-3.5" />} />
                </div></td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
      {toSend && <SendDialog files={toSend.files} matterId={toSend.matterId} onClose={() => setToSend(null)} />}
    </div>
  );
}

const statusOf = (r: { matter?: { deliveredAt?: number; status: string } }) => (r.matter ? (r.matter.deliveredAt ? "delivered" : r.matter.status === "closed" ? "closed" : "awaiting delivery") : "no matter");

function RowAction({ label, onClick, href, icon }: { label: string; onClick?: () => void; href?: string; icon: React.ReactNode }) {
  const cls = "inline-flex size-7 items-center justify-center rounded-md text-fg-secondary hover:bg-muted hover:text-foreground";
  return href ? <PrefetchLink href={href} className={cls} title={label} aria-label={label}>{icon}</PrefetchLink> : <button type="button" onClick={onClick} className={cls} title={label} aria-label={label}>{icon}</button>;
}
