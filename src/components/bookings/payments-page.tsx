"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { PageHeader, Panel, Pill, Kpi, Empty, Loading, ErrorBox, DataTable } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { useLive } from "@/lib/hooks";
import { aud, day } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Cliniko invoices (read live) beside Stripe payments (mirrored by webhook). */
export function PaymentsPage() {
  const [days, setDays] = useState(90);
  const setup = useQuery(api.settings.setupStatus);
  const invoices = useLive(api.bookings.clinikoInvoices, setup?.cliniko ? { days } : "skip");
  const money = useQuery(api.money.table);
  const rows = invoices.data ?? [];
  const open = rows.filter((i) => !i.closedAt);
  return (
    <div className="space-y-6">
      <PageHeader title="Payments" blurb="Invoices raised in Cliniko, and payments taken through Stripe by Happy Days (online bookings and report invoices)." actions={<div className="flex gap-1 rounded-full bg-muted p-0.5 text-xs">{[30, 90, 365].map((d) => <button key={d} type="button" onClick={() => setDays(d)} className={cn("h-7 rounded-full px-3", days === d ? "bg-card shadow-xs" : "text-fg-tertiary")}>{d} days</button>)}</div>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Cliniko invoices" value={invoices.data ? rows.length : "…"} sub={`last ${days} days`} />
        <Kpi label="Open in Cliniko" value={invoices.data ? open.length : "…"} tone={open.length ? "warn" : undefined} sub={invoices.data ? `$${open.reduce((s, i) => s + i.total, 0).toFixed(0)} unpaid` : ""} />
        <Kpi label="Stripe payments" value={money ? money.payments.length : "…"} sub="online bookings and cards" href="/money" />
        <Kpi label="Stripe outstanding" value={money ? aud(money.counts.outstandingCents, { whole: true }) : "…"} sub="report invoices" href="/money" />
      </div>
      <Panel title="Cliniko invoices" blurb="Read live. Open one in Cliniko to edit or record a payment there." actions={<Button size="sm" variant="ghost" onClick={invoices.reload}>Refresh</Button>}>
        {setup && !setup.cliniko ? <Empty title="Cliniko isn’t connected" action={<Button render={<Link href="/settings?tab=cliniko" />}>Settings</Button>} /> : invoices.error ? <ErrorBox title="Couldn’t read invoices from Cliniko" message={invoices.error} retry={invoices.reload} /> : !invoices.data ? <Loading rows={6} /> : rows.length === 0 ? <Empty title={`No Cliniko invoices in the last ${days} days`} /> : (
          <DataTable head={<><th>Number</th><th>Patient</th><th>Issued</th><th>Total</th><th>Status</th><th></th></>} minWidth={640}>
            {rows.map((i) => <tr key={i.id} className="hover:bg-muted/50"><td className="num">{i.number}</td><td>{i.patientId ? <Link href={`/bookings/patients/${i.patientId}`} className="hover:underline">{i.patientName || `Patient ${i.patientId}`}</Link> : i.patientName || "—"}</td><td className="text-xs">{day(i.issueDate)}</td><td className="num">${i.total.toFixed(2)}</td><td><Pill tone={i.closedAt ? "good" : "warn"}>{i.status}</Pill></td><td><div className="flex justify-end gap-2 text-xs">{i.payUrl && <a href={i.payUrl} target="_blank" rel="noreferrer" className="text-fg-tertiary hover:text-foreground">pay link</a>}<a href={i.clinikoUrl} target="_blank" rel="noreferrer" className="text-fg-tertiary hover:text-foreground">Cliniko ↗</a></div></td></tr>)}
          </DataTable>
        )}
      </Panel>
      <Panel title="Stripe payments" blurb="Mirrored from Stripe webhooks." actions={<Button size="sm" variant="ghost" render={<Link href="/money" />}>Money page</Button>}>
        {money === undefined ? <Loading rows={3} /> : money.payments.length === 0 ? <Empty title="No Stripe payments yet" body="Online bookings and card payments appear here once Stripe is connected." /> : (
          <DataTable head={<><th>When</th><th>Description</th><th>Payer</th><th>Amount</th><th>Status</th></>} minWidth={560}>
            {money.payments.slice(0, 50).map((p) => <tr key={p._id}><td className="text-xs text-fg-tertiary">{day(p.createdAt)}</td><td className="truncate">{p.description ?? p.kind}</td><td className="text-xs">{p.customerEmail ?? "—"}</td><td className="num">{aud(p.amountCents)}</td><td><Pill tone={p.status === "succeeded" || p.status === "paid" ? "good" : "warn"}>{p.status}</Pill></td></tr>)}
          </DataTable>
        )}
      </Panel>
    </div>
  );
}
