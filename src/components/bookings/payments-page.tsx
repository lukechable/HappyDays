"use client";

import { useMemo, useState } from "react";
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
import { matchEft } from "@/lib/eft-matching";

type Status = "all" | "open" | "paid" | "closed";
type SortKey = "number" | "patientName" | "issueDate" | "total" | "openAmount" | "status";
type Row = { patientNames?: string[]; appointmentAt: string | null; statusCode: number; openAmount: number; id: string; number: number; patientId?: string; patientName: string; issueDate: string; closedAt: string | null; status: string; total: number; net: number; clinikoUrl: string; payUrl?: string };

/** Cliniko invoices (read live) beside Stripe payments (mirrored by webhook), with filters, sorting and export. */
export function PaymentsPage() {
  const [days, setDays] = useState(90);
  const [status, setStatus] = useState<Status>("all");
  const [customer, setCustomer] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [min, setMin] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "openAmount", dir: -1 });
  const [eftFilter, setEftFilter] = useState("all");
  const [windowDays, setWindowDays] = useState(7);
  const [account, setAccount] = useState("");
  const [age, setAge] = useState(0);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const bankStatus = useQuery(api.bank.status);
  const bank = useLive(api.bank.transactions, bankStatus?.configured && bankStatus.linked ? {} : "skip", { ttlMs: 120_000 });
  const setup = useQuery(api.settings.setupStatus);
  const invoices = useLive(api.bookings.clinikoInvoices, setup?.cliniko ? { days } : "skip", { ttlMs: 120_000 });
  const money = useQuery(api.money.table);
  const sessions = useQuery(api.bookings.recentSessions);
  const needsReview = sessions?.filter(s => s.fulfillmentStartedAt && s.status !== "booked") ?? [];
  const all: Row[] = useMemo(() => invoices.data ?? [], [invoices.data]);
  const candidates = useMemo(() => matchEft(all, (bank.data?.rows ?? []).filter(t => !account || t.accountId === account), windowDays), [all, bank.data, account, windowDays]);
  const bankReady = !!bank.data?.linked && !bank.error;
  const newestBankDate = bank.data?.rows[0]?.postDate;
  const clear = () => { setStatus("all"); setCustomer(null); setQ(""); setMin(""); setAge(0); setFrom(""); setTo(""); setEftFilter("all"); setAccount(""); };

  const customers = Array.from(new Set(all.map((i) => i.patientName).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const rows = (() => {
    let r = all;
    if (status === "open") r = r.filter((i) => i.statusCode === 10);
    if (status === "paid") r = r.filter((i) => i.statusCode === 20);
    if (status === "closed") r = r.filter(i => i.statusCode === 30);
    if (age) r = r.filter(i => i.openAmount > 0 && Date.parse(i.issueDate) <= Date.now() - age * 86_400_000);
    if (from) r = r.filter(i => i.issueDate.slice(0, 10) >= from);
    if (to) r = r.filter(i => i.issueDate.slice(0, 10) <= to);
    if (eftFilter !== "all") r = bankReady ? r.filter(i => { const c = candidates.get(i.id) ?? []; return eftFilter === "strong" ? c.some(m => m.confidence === "strong") : eftFilter === "review" ? c.length > 0 : i.openAmount > 0 && !!i.appointmentAt && c.length === 0; }) : [];
    if (customer) r = r.filter((i) => i.patientName === customer);
    if (q.trim()) { const n = q.trim().toLowerCase(); r = r.filter((i) => String(i.number).includes(n) || i.patientName.toLowerCase().includes(n) || i.status.toLowerCase().includes(n)); }
    if (min) { const m = Number(min); if (Number.isFinite(m)) r = r.filter((i) => i.openAmount >= m); }
    const val = (i: Row) => sort.key === "issueDate" ? Date.parse(i.issueDate) : sort.key === "patientName" ? i.patientName.toLowerCase() : i[sort.key];
    return [...r].sort((a, b) => { const x = val(a), y = val(b); return (x > y ? 1 : x < y ? -1 : 0) * sort.dir; });
  })();
  const sum = rows.reduce((s, i) => s + i.total, 0);
  const owing = rows.reduce((s, i) => s + i.openAmount, 0);
  const filtered = status !== "all" || !!customer || !!q.trim() || !!min || !!age || !!from || !!to || eftFilter !== "all" || !!account;

  const th = (label: string, key: SortKey, right = false) => <th className={right ? "text-right" : ""}><button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : key === "patientName" ? 1 : -1 }))} className={cn("uppercase", sort.key === key && "text-foreground")}>{label}{sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}</button></th>;
  const exportTable = () => ({ title: `Cliniko invoices${customer ? ` — ${customer}` : ""}`, subtitle: [`Last ${days} days`, status !== "all" ? status : "", q ? `search “${q}”` : "", `${rows.length} invoices, total ${aud(Math.round(sum * 100))}, open invoice estimate ${aud(Math.round(owing * 100))}`].filter(Boolean).join(" · "), filename: `cliniko-invoices-${new Date().toISOString().slice(0, 10)}`, columns: [{ key: "number", label: "Number" }, { key: "patientName", label: "Patient" }, { key: "issueDate", label: "Issued" }, { key: "status", label: "Status" }, { key: "total", label: "Total", align: "right" as const }, { key: "openAmount", label: "Open amount (estimate)", align: "right" as const }, { key: "appointmentAt", label: "Appointment" }, { key: "eft", label: "EFT candidates (unconfirmed)" }, { key: "closedAt", label: "Closed" }, { key: "clinikoUrl", label: "Cliniko link" }], rows: rows.map((i) => ({ number: i.number, patientName: i.patientName, issueDate: day(i.issueDate), status: i.status, total: i.total.toFixed(2), openAmount: i.openAmount.toFixed(2), appointmentAt: i.appointmentAt ? day(i.appointmentAt) : "Not available", eft: bankReady ? (candidates.get(i.id) ?? []).map(c => `${c.confidence}: ${c.transaction.id}, ${day(c.transaction.postDate)}, ${aud(c.transaction.amountCents)}, ${c.transaction.description}`).join("; ") : "Bank not checked", closedAt: i.closedAt ? day(i.closedAt) : "", clinikoUrl: i.clinikoUrl })) });

  return (
    <div className="space-y-5">
      <PageHeader title="Payments" blurb="Prioritise open invoices and investigate nearby bank transfers against appointment dates." actions={<><div className="flex gap-0.5 rounded-full bg-muted p-0.5 text-xs">{[30, 90, 365].map((d) => <button key={d} type="button" onClick={() => setDays(d)} className={cn("h-7 rounded-full px-2.5", days === d ? "bg-card shadow-xs" : "text-fg-tertiary hover:text-foreground")}>{d} days</button>)}</div><ExportMenu table={exportTable} disabled={!rows.length} /></>} />
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Kpi label={filtered ? "Invoices (filtered)" : "Cliniko invoices"} value={invoices.data ? rows.length : "…"} sub={invoices.data ? `${aud(Math.round(sum * 100), { whole: true })} in total` : `last ${days} days`} />
        <Kpi label="Open in Cliniko" value={invoices.data ? rows.filter((i) => i.statusCode === 10).length : "…"} tone={owing ? "warn" : undefined} sub={invoices.data ? `${aud(Math.round(owing * 100), { whole: true })} open (estimate)` : ""} />
        <Kpi label="Stripe payments" value={money ? money.payments.length : "…"} sub="online bookings and cards" href="/money" />
        <Kpi label="Stripe outstanding" value={money ? aud(money.counts.outstandingCents, { whole: true }) : "…"} sub="report invoices" href="/money" />
      </div>
      {needsReview.length > 0 && <Panel title="Paid bookings awaiting confirmation" blurb="Check Cliniko and Stripe before creating or retrying a booking; a previous request may have completed despite a network error.">
        <DataTable head={<><th>Patient</th><th>Appointment</th><th>Payment</th><th>Next step</th></>}>
          {needsReview.map(s => <tr key={s._id}><td>{s.patient.firstName} {s.patient.lastName}<div className="text-xs text-fg-tertiary">{s.patient.email}</div></td><td>{day(s.startsAt)}</td><td>{aud(s.amountCents)}<div className="text-xs text-fg-tertiary">{s.stripeCheckoutSessionId}</div></td><td className="max-w-sm whitespace-normal text-xs">{s.status === "paid" ? "Confirmation in progress. Investigate if this persists." : "Automatic confirmation stopped. Review the patient and appointment in Cliniko."}</td></tr>)}
        </DataTable>
      </Panel>}
      <Panel title="Cliniko invoices" blurb="Open amounts are invoice totals, not verified balances: Cliniko’s API does not expose partial-payment allocations. Confirm the balance in Cliniko before collecting." actions={<Button size="xs" variant="ghost" onClick={invoices.reload}>{invoices.refreshing ? "Refreshing…" : "Refresh"}</Button>}>
        <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
          <div className="flex gap-0.5 rounded-full bg-muted p-0.5 text-xs">{([["all", "All"], ["open", "Open"], ["paid", "Paid"], ["closed", "Closed"]] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setStatus(k)} className={cn("h-7 rounded-full px-2.5", status === k ? "bg-card shadow-xs" : "text-fg-tertiary hover:text-foreground")}>{l}</button>)}</div>
          <select value={customer ?? ""} onChange={(e) => setCustomer(e.target.value || null)} className="h-8 max-w-[240px] rounded-lg border border-input bg-card px-2 text-[13px]" aria-label="Customer"><option value="">All customers</option>{customers.map((c) => <option key={c} value={c}>{c}</option>)}</select>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search number, name, status" className="h-8 w-52" />
          <Input value={min} onChange={(e) => setMin(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Min owing $" aria-label="Minimum open invoice amount" inputMode="decimal" className="num h-8 w-28" />
          <select aria-label="Sort invoices" value={`${sort.key}:${sort.dir}`} onChange={e => { const [key, dir] = e.target.value.split(":"); setSort({ key: key as SortKey, dir: Number(dir) as 1 | -1 }); }} className="h-8 rounded-lg border border-input bg-card px-2 text-[13px]">
            <option value="openAmount:-1">Most owing first (estimate)</option><option value="openAmount:1">Least owing first (estimate)</option><option value="issueDate:1">Oldest first</option><option value="issueDate:-1">Newest first</option><option value="total:-1">Largest invoice first</option><option value="patientName:1">Patient A–Z</option>
            {!["openAmount:-1", "openAmount:1", "issueDate:1", "issueDate:-1", "total:-1", "patientName:1"].includes(`${sort.key}:${sort.dir}`) && <option value={`${sort.key}:${sort.dir}`}>Column sort: {sort.key} {sort.dir === 1 ? "↑" : "↓"}</option>}
          </select>
          <select aria-label="Age of open invoices" value={age} onChange={e => setAge(Number(e.target.value))} className="h-8 rounded-lg border border-input bg-card px-2 text-[13px]"><option value={0}>Any age</option>{[30, 60, 90].map(d => <option key={d} value={d}>Open {d}+ days</option>)}</select>
          <label className="text-xs">Issued from <input aria-label="Issued from" type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-8 rounded-lg border border-input bg-card px-2" /></label>
          <label className="text-xs">to <input aria-label="Issued to" type="date" value={to} onChange={e => setTo(e.target.value)} className="h-8 rounded-lg border border-input bg-card px-2" /></label>
          {filtered && <Button size="xs" variant="ghost" onClick={clear}><X className="size-3" />Clear</Button>}
          <span className="num ml-auto text-xs text-fg-tertiary">{rows.length} of {all.length}</span>
        </div>
        <div className="mb-3 space-y-2 rounded-lg border border-border p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">Bank transfer checks</span>
            <select aria-label="EFT match filter" value={eftFilter} disabled={!bankReady} onChange={e => setEftFilter(e.target.value)} className="h-8 rounded-lg border border-input bg-card px-2 text-xs"><option value="all">All invoices</option><option value="strong">Strong EFT candidates</option><option value="review">Any EFT candidate</option><option value="none">No candidate in available feed</option></select>
            <select aria-label="EFT date window" value={windowDays} onChange={e => setWindowDays(Number(e.target.value))} className="h-8 rounded-lg border border-input bg-card px-2 text-xs">{[1, 3, 7, 14].map(d => <option key={d} value={d}>Within {d} day{d === 1 ? "" : "s"} of appointment</option>)}</select>
            <select aria-label="Bank account" value={account} onChange={e => setAccount(e.target.value)} className="h-8 max-w-56 rounded-lg border border-input bg-card px-2 text-xs"><option value="">All linked accounts</option>{bank.data?.accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
            {bankStatus?.linked && <Button size="xs" variant="ghost" onClick={bank.reload} disabled={bank.refreshing}>{bank.refreshing ? "Reading bank…" : "Refresh bank"}</Button>}
          </div>
          {bank.error ? <ErrorBox title="Bank check unavailable" message={bank.error} retry={bank.reload} /> : !bankStatus ? <p className="text-xs text-fg-tertiary">Checking bank connection…</p> : !bankStatus.linked || !bankStatus.configured ? <p className="text-xs text-fg-secondary"><Link href="/money/transactions" className="underline">Connect the bank feed</Link> to investigate EFT payments.</p> : !bank.data ? <p className="text-xs text-fg-tertiary">Reading transactions across linked accounts…</p> : <p className="text-xs text-fg-secondary">{bank.data.rows.length} transactions loaded{newestBankDate ? ` · Latest posted transaction ${day(newestBankDate)}` : ""}. {bank.data.complete ? "All available feed pages read." : "Feed is incomplete; some transactions have not been checked."} Candidates require a nearby appointment date; strong candidates also match the amount and patient name or invoice reference. Review in Cliniko before recording payment.</p>}
        </div>
        {setup && !setup.cliniko ? <Empty title="Cliniko isn’t connected" action={<Button render={<Link href="/settings?tab=cliniko" />}>Settings</Button>} /> : invoices.error ? <ErrorBox title="Couldn’t read invoices from Cliniko" message={invoices.error} retry={invoices.reload} /> : !invoices.data ? <Loading rows={6} /> : rows.length === 0 ? <Empty title={all.length ? "No invoices match these filters" : `No Cliniko invoices in the last ${days} days`} action={filtered ? <Button size="sm" variant="outline" onClick={clear}>Clear filters</Button> : undefined} /> : (
          <DataTable head={<>{th("Number", "number")}{th("Patient", "patientName")}{th("Issued", "issueDate")}{th("Total", "total", true)}{th("Open est.", "openAmount", true)}{th("Status", "status")}<th>EFT check</th><th></th></>} minWidth={640}>
            {rows.map((i) => <tr key={i.id} className="hover:bg-muted/50"><td className="num">{i.number}</td><td>{i.patientId ? <button type="button" onClick={() => setCustomer(i.patientName)} className="hover:underline" title="Show only this customer">{i.patientName || `Patient ${i.patientId}`}</button> : i.patientName || "—"}</td><td className="text-xs text-fg-secondary">{day(i.issueDate)}{i.appointmentAt && <div className="mt-1 whitespace-nowrap text-fg-tertiary">Appt {day(i.appointmentAt)}</div>}</td><td className="num text-right">${i.total.toFixed(2)}</td><td className="num text-right">${i.openAmount.toFixed(2)}</td><td><Pill tone={i.statusCode === 20 ? "good" : i.statusCode === 10 ? "warn" : undefined}>{i.status}</Pill></td><td className="min-w-56 max-w-80 text-xs">{i.openAmount <= 0 ? "—" : !bankReady ? "Bank not checked" : !i.appointmentAt ? "Appointment date unavailable" : !(candidates.get(i.id)?.length) ? "No candidate in available feed" : <details><summary className="cursor-pointer font-medium">{candidates.get(i.id)!.some(c => c.confidence === "strong") ? "Strong candidate" : "Investigate EFT"} ({candidates.get(i.id)!.length})</summary><div className="mt-2 space-y-3">{candidates.get(i.id)!.map(c => <div key={c.transaction.id} className="space-y-1 border-t border-border pt-2"><p className="font-medium">{aud(c.transaction.amountCents)} · {day(c.transaction.transactionDate || c.transaction.postDate)}</p><p className="whitespace-normal break-words">{c.transaction.description}</p><p>{c.transaction.accountName ?? "Linked bank account"}</p><p>Appointment {day(i.appointmentAt!)} · {c.daysFromAppointment === 0 ? "same day" : `${Math.abs(c.daysFromAppointment)} days ${c.daysFromAppointment < 0 ? "before" : "after"}`}</p><p className="whitespace-normal">{c.reasons.join(" · ")}</p>{c.otherInvoiceNumbers.length > 0 && <p className="whitespace-normal text-warning">Also a candidate for invoice{c.otherInvoiceNumbers.length === 1 ? "" : "s"} {c.otherInvoiceNumbers.join(", ")}; verify allocation.</p>}<p className="text-fg-tertiary">Unconfirmed · {c.transaction.id}</p></div>)}</div></details>}</td><td><div className="flex justify-end gap-2 text-xs">{i.patientId && <PrefetchLink href={`/bookings/patients/${i.patientId}`} className="text-fg-tertiary hover:text-foreground">patient</PrefetchLink>}{i.payUrl && <a href={i.payUrl} target="_blank" rel="noreferrer" className="text-fg-tertiary hover:text-foreground">pay link</a>}<a href={i.clinikoUrl} target="_blank" rel="noreferrer" className="text-fg-tertiary hover:text-foreground">Cliniko ↗</a></div></td></tr>)}
            <tr><td colSpan={3} className="text-xs text-fg-tertiary">{rows.length} invoice{rows.length === 1 ? "" : "s"}{customer ? ` for ${customer}` : ""}</td><td className="num text-right font-semibold">${sum.toFixed(2)}</td><td className="num text-right font-semibold">${owing.toFixed(2)}</td><td colSpan={3} className="text-xs text-fg-tertiary">Open invoice totals; confirm balances in Cliniko</td></tr>
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
