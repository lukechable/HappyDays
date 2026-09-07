"use client";

import { useState } from "react";
import Link from "next/link";
import { PrefetchLink } from "@/components/prefetch-link";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { X } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { PageHeader, Panel, Pill, Kpi, Empty, Loading, ErrorBox, DataTable } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExportMenu } from "@/components/export/export-menu";
import { useLive } from "@/lib/hooks";
import { aud, day } from "@/lib/format";
import { cn } from "@/lib/utils";

type Status = "all" | "open" | "paid";
type SortKey = "number" | "patientName" | "issueDate" | "total" | "status";
type Row = { id: string; number: number; patientId?: string; patientName: string; issueDate: string; closedAt: string | null; status: string; total: number; net: number; clinikoUrl: string; payUrl?: string };

/** Cliniko invoices (read live) beside Stripe payments (mirrored by webhook), with filters, sorting and export. */
export function PaymentsPage() {
  const [days, setDays] = useState(90);
  const [status, setStatus] = useState<Status>("all");
  const [customer, setCustomer] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [min, setMin] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "issueDate", dir: -1 });
  const setup = useQuery(api.settings.setupStatus);
  const invoices = useLive(api.bookings.clinikoInvoices, setup?.cliniko ? { days } : "skip", { ttlMs: 120_000 });
  const money = useQuery(api.money.table);
  const all: Row[] = invoices.data ?? [];

  const customers = Array.from(new Set(all.map((i) => i.patientName).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const rows = (() => {
    let r = all;
    if (status === "open") r = r.filter((i) => !i.closedAt);
    if (status === "paid") r = r.filter((i) => !!i.closedAt);
    if (customer) r = r.filter((i) => i.patientName === customer);
    if (q.trim()) { const n = q.trim().toLowerCase(); r = r.filter((i) => String(i.number).includes(n) || i.patientName.toLowerCase().includes(n) || i.status.toLowerCase().includes(n)); }
    if (min) { const m = Number(min); if (Number.isFinite(m)) r = r.filter((i) => i.total >= m); }
    const val = (i: Row) => sort.key === "issueDate" ? Date.parse(i.issueDate) : sort.key === "patientName" ? i.patientName.toLowerCase() : i[sort.key];
    return [...r].sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * sort.dir; });
  })();
  const sum = rows.reduce((s, i) => s + i.total, 0);
  const owing = rows.filter((i) => !i.closedAt).reduce((s, i) => s + i.total, 0);
  const filtered = status !== "all" || !!customer || !!q.trim() || !!min;

  const th = (label: string, key: SortKey, right = false) => <th className={right ? "text-right" : ""}><button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "patientName" ? 1 : -1 }))} className={cn("uppercase", sort.key === key && "text-foreground")}>{label}{sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}</button></th>;
  const exportTable = () => ({ title: `Cliniko invoices${customer ? ` — ${customer}` : ""}`, subtitle: [`Last ${days} days`, status !== "all" ? status : "", q ? `search “${q}”` : "", `${rows.length} invoices, total ${aud(Math.round(sum * 100))}, owing ${aud(Math.round(owing * 100))}`].filter(Boolean).join(" · "), filename: `cliniko-invoices-${new Date().toISOString().slice(0, 10)}`, columns: [{ key: "number", label: "Number" }, { key: "patientName", label: "Patient" }, { key: "issueDate", label: "Issued" }, { key: "status", label: "Status" }, { key: "total", label: "Total", align: "right" as const }, { key: "closedAt", label: "Closed" }, { key: "clinikoUrl", label: "Cliniko link" }], rows: rows.map((i) => ({ number: i.number, patientName: i.patientName, issueDate: day(i.issueDate), status: i.status, total: i.total.toFixed(2), closedAt: i.closedAt ? day(i.closedAt) : "", clinikoUrl: i.clinikoUrl })) });

  return (
    <div className="space-y-5">
      <PageHeader title="Payments" blurb="Cliniko invoices read live, and Stripe payments taken by Happy Days for online bookings and report invoices." actions={<><div className="flex gap-0.5 rounded-full bg-muted p-0.5 text-xs">{[30, 90, 365].map((d) => <button key={d} type="button" onClick={() => setDays(d)} className={cn("h-7 rounded-full px-2.5", days === d ? "bg-card shadow-xs" : "text-fg-tertiary hover:text-foreground")}>{d} days</button>)}</div><ExportMenu table={exportTable} disabled={!rows.length} /></>} />
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Kpi label={filtered ? "Invoices (filtered)" : "Cliniko invoices"} value={invoices.data ? rows.length : "…"} sub={invoices.data ? `${aud(Math.round(sum * 100), { whole: true })} in total` : `last ${days} days`} />
        <Kpi label="Open in Cliniko" value={invoices.data ? rows.filter((i) => !i.closedAt).length : "…"} tone={owing ? "warn" : undefined} sub={invoices.data ? `${aud(Math.round(owing * 100), { whole: true })} unpaid` : ""} />
        <Kpi label="Stripe payments" value={money ? money.payments.length : "…"} sub="online bookings and cards" href="/money" />
        <Kpi label="Stripe outstanding" value={money ? aud(money.counts.outstandingCents, { whole: true }) : "…"} sub="report invoices" href="/money" />
      </div>
      <Panel title="Cliniko invoices" blurb="Open one in Cliniko to edit it or record a payment there." actions={<Button size="xs" variant="ghost" onClick={invoices.reload}>{invoices.refreshing ? "Refreshing…" : "Refresh"}</Button>}>
        <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
          <div className="flex gap-0.5 rounded-full bg-muted p-0.5 text-xs">{([["all", "All"], ["open", "Open"], ["paid", "Paid"]] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setStatus(k)} className={cn("h-7 rounded-full px-2.5", status === k ? "bg-card shadow-xs" : "text-fg-tertiary hover:text-foreground")}>{l}</button>)}</div>
          <select value={customer ?? ""} onChange={(e) => setCustomer(e.target.value || null)} className="h-8 max-w-[240px] rounded-lg border border-input bg-card px-2 text-[13px]" aria-label="Customer"><option value="">All customers</option>{customers.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search number, name, status" className="h-8 w-52" />
          <Input value={min} onChange={(e) => setMin(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Min $" inputMode="decimal" className="num h-8 w-20" />
          {filtered && <Button size="xs" variant="ghost" onClick={() => { setStatus("all"); setCustomer(null); setQ(""); setMin(""); }}><X className="size-3" />Clear</Button>}
          <span className="num ml-auto text-xs text-fg-tertiary">{rows.length} of {all.length}</span>
        </div>
        {setup && !setup.cliniko ? <Empty title="Cliniko isn’t connected" action={<Button render={<Link href="/settings?tab=cliniko" />}>Settings</Button>} /> : invoices.error ? <ErrorBox title="Couldn’t read invoices from Cliniko" message={invoices.error} retry={invoices.reload} /> : !invoices.data ? <Loading rows={6} /> : rows.length === 0 ? <Empty title={all.length ? "No invoices match these filters" : `No Cliniko invoices in the last ${days} days`} action={filtered ? <Button size="sm" variant="outline" onClick={() => { setStatus("all"); setCustomer(null); setQ(""); setMin(""); }}>Clear filters</Button> : undefined} /> : (
          <DataTable head={<>{th("Number", "number")}{th("Patient", "patientName")}{th("Issued", "issueDate")}{th("Total", "total", true)}{th("Status", "status")}<th></th></>} minWidth={640}>
            {rows.map((i) => <tr key={i.id} className="hover:bg-muted/50"><td className="num">{i.number}</td><td>{i.patientId ? <button type="button" onClick={() => setCustomer(i.patientName)} className="hover:underline" title="Show only this customer">{i.patientName || `Patient ${i.patientId}`}</button> : i.patientName || "—"}</td><td className="text-xs text-fg-secondary">{day(i.issueDate)}</td><td className="num text-right">${i.total.toFixed(2)}</td><td><Pill tone={i.closedAt ? "good" : "warn"}>{i.status}</Pill></td><td><div className="flex justify-end gap-2 text-xs">{i.patientId && <PrefetchLink href={`/bookings/patients/${i.patientId}`} className="text-fg-tertiary hover:text-foreground">patient</PrefetchLink>}{i.payUrl && <a href={i.payUrl} target="_blank" rel="noreferrer" className="text-fg-tertiary hover:text-foreground">pay link</a>}<a href={i.clinikoUrl} target="_blank" rel="noreferrer" className="text-fg-tertiary hover:text-foreground">Cliniko ↗</a></div></td></tr>)}
            <tr><td colSpan={3} className="text-xs text-fg-tertiary">{rows.length} invoice{rows.length === 1 ? "" : "s"}{customer ? ` for ${customer}` : ""}</td><td className="num text-right font-semibold">${sum.toFixed(2)}</td><td colSpan={2} className="text-xs text-fg-tertiary">{owing ? `$${owing.toFixed(2)} unpaid` : "all paid"}</td></tr>
          </DataTable>
        )}
      </Panel>
      <Panel title="Stripe payments" blurb="Mirrored from Stripe webhooks." actions={<Button size="xs" variant="ghost" render={<Link href="/money" />}>Money page</Button>}>
        {money === undefined ? <Loading rows={3} /> : money.payments.length === 0 ? <Empty title="No Stripe payments yet" body="Online bookings and card payments appear here once Stripe is connected." /> : (
          <DataTable head={<><th>When</th><th>Description</th><th>Payer</th><th className="text-right">Amount</th><th>Status</th></>} minWidth={560}>
            {money.payments.slice(0, 50).map((p) => <tr key={p._id}><td className="text-xs text-fg-secondary">{day(p.createdAt)}</td><td className="truncate">{p.description ?? p.kind}</td><td className="text-xs">{p.customerEmail ?? "—"}</td><td className="num text-right">{aud(p.amountCents)}</td><td><Pill tone={p.status === "succeeded" || p.status === "paid" ? "good" : "warn"}>{p.status}</Pill></td></tr>)}
          </DataTable>
        )}
      </Panel>
    </div>
  );
}
