"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useAction, useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { Plus, RefreshCw, ExternalLink, FileText } from "lucide-react";
import { ExportMenu } from "@/components/export/export-menu";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { PageHeader, Panel, Pill, statusTone, Kpi, Empty, Loading, DataTable } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { aud, day } from "@/lib/format";
import { cn, errorMessage } from "@/lib/utils";

type Flag = "all" | "paid_not_delivered" | "delivered_unpaid" | "complete" | "open";
type SortKey = "createdAt" | "amountCents" | "status" | "customerName" | "deliveredAt";

/**
 * The money table: one row per Stripe invoice, joined to its matter's report delivery. The two flags that matter
 * to the practice are "paid but no report yet" and "report out but unpaid".
 */
export function MoneyPage() {
  const params = useSearchParams();
  const data = useQuery(api.money.table);
  const matters = useQuery(api.matters.list, { includeClosed: true });
  const setup = useQuery(api.settings.setupStatus);
  const link = useMutation(api.money.linkInvoiceToMatter);
  const markDelivered = useMutation(api.matters.markDelivered);
  const backfill = useAction(api.stripe.backfill);
  const [flag, setFlag] = useState<Flag>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "createdAt", dir: -1 });
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const matterFilter = params.get("matter");

  const rows = useMemo(() => {
    let r = data?.rows ?? [];
    if (matterFilter) r = r.filter((x) => x.matter?._id === matterFilter);
    if (flag !== "all") r = r.filter((x) => x.flag === flag);
    if (q.trim()) { const n = q.toLowerCase(); r = r.filter((x) => [x.customerName, x.customerEmail, x.number, x.description, x.matter?.name].some((v) => v?.toLowerCase().includes(n))); }
    const val = (x: (typeof r)[number]) => sort.key === "deliveredAt" ? x.deliveredAt ?? 0 : sort.key === "customerName" ? x.customerName ?? "" : x[sort.key] ?? "";
    return [...r].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir);
  }, [data, flag, q, sort, matterFilter]);

  const exportTable = () => ({
    title: "Invoices and reports", subtitle: `${flag === "all" ? "All invoices" : flag.replace(/_/g, " ")}${q ? ` · search “${q}”` : ""} · ${rows.length} rows`, filename: `invoices-${new Date().toISOString().slice(0, 10)}`,
    columns: [{ key: "number", label: "Invoice" }, { key: "client", label: "Client" }, { key: "email", label: "Email" }, { key: "matter", label: "Matter" }, { key: "description", label: "Description" }, { key: "amount", label: "Amount", align: "right" as const }, { key: "status", label: "Status" }, { key: "invoiced", label: "Invoiced" }, { key: "paid", label: "Paid" }, { key: "delivered", label: "Report delivered" }, { key: "via", label: "Delivered via" }, { key: "days", label: "Days invoice→delivery", align: "right" as const }],
    rows: rows.map((r) => ({ number: r.number ?? r.stripeId, client: r.customerName ?? "", email: r.customerEmail ?? "", matter: r.matter?.name ?? "", description: r.description ?? "", amount: (r.amountCents / 100).toFixed(2), status: r.status, invoiced: day(r.createdAt), paid: r.paidAt ? day(r.paidAt) : "", delivered: r.deliveredAt ? day(r.deliveredAt) : "", via: r.deliveredVia ?? "", days: r.daysInvoiceToDelivery ?? "" })),
  });
  const th = (label: string, key: SortKey) => <th><button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 }))} className={cn("uppercase", sort.key === key && "text-foreground")}>{label}{sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}</button></th>;

  return (
    <div className="space-y-5">
      <PageHeader title="Invoices & reports" blurb="Every Stripe invoice next to whether the written report has gone out. Raise report invoices here; bookings pay through Stripe Checkout on their own." actions={<><Button variant="outline" disabled={!setup?.stripe || busy} onClick={async () => { setBusy(true); try { const r = await backfill({}); toast.success(`Refreshed ${r.count} records from Stripe`); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } }}><RefreshCw className={cn("size-3.5", busy && "animate-spin")} />Sync Stripe</Button><ExportMenu table={exportTable} disabled={!rows.length} /><Button onClick={() => setCreating(true)} disabled={!setup?.stripe}><Plus className="size-3.5" />New invoice</Button></>} />
      {setup && !setup.stripe && <p className="rounded-2xl bg-warning-soft px-4 py-3 text-sm">Stripe isn’t connected. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET on the Convex deployment, then Sync.</p>}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Kpi label="Paid, report not delivered" value={data?.counts.paidNotDelivered ?? "…"} tone={(data?.counts.paidNotDelivered ?? 0) > 0 ? "warn" : undefined} sub="the client is waiting" />
        <Kpi label="Delivered, unpaid" value={data?.counts.deliveredUnpaid ?? "…"} tone={(data?.counts.deliveredUnpaid ?? 0) > 0 ? "bad" : undefined} sub="chase these" />
        <Kpi label="Outstanding" value={data ? aud(data.counts.outstandingCents, { whole: true }) : "…"} sub="open invoices" />
        <Kpi label="Invoices" value={data?.rows.length ?? "…"} sub="last 300 from Stripe" />
      </div>
      <Panel>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {([["all", "All"], ["paid_not_delivered", "Paid, not delivered"], ["delivered_unpaid", "Delivered, unpaid"], ["open", "Open"], ["complete", "Complete"]] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setFlag(k)} className={cn("rounded-full px-2.5 py-1 text-xs", flag === k ? "bg-foreground text-background" : "bg-muted text-fg-secondary hover:text-foreground")}>{l}</button>)}
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search client, matter, invoice" className="ml-auto h-8 w-64" />
          {matterFilter && <Link href="/money" className="text-xs underline">clear matter filter</Link>}
        </div>
        {data === undefined ? <Loading rows={5} /> : rows.length === 0 ? <Empty title={data.rows.length ? "No invoices match" : "No invoices yet"} body={data.rows.length ? "Try another filter." : "Click Sync Stripe to import the last 90 days, or raise a new invoice."} /> : (
          <DataTable head={<>{th("Invoice", "createdAt")}{th("Client", "customerName")}<th>Matter</th>{th("Amount", "amountCents")}{th("Status", "status")}<th>Report</th>{th("Delivered", "deliveredAt")}<th></th></>} minWidth={880}>
            {rows.map((r) => (
              <tr key={r._id} className={cn("hover:bg-muted/50", r.flag === "paid_not_delivered" && "bg-warning-soft/40", r.flag === "delivered_unpaid" && "bg-error-soft/30")}>
                <td><div className="num font-medium">{r.number ?? r.stripeId.slice(0, 12)}</div><div className="text-xs text-fg-tertiary">{day(r.createdAt)}{r.dueAt ? ` · due ${day(r.dueAt)}` : ""}</div></td>
                <td><div>{r.customerName ?? "—"}</div><div className="truncate text-xs text-fg-tertiary">{r.customerEmail}</div></td>
                <td><select value={r.matter?._id ?? ""} onChange={(e) => link({ invoiceId: r._id, matterId: (e.target.value || undefined) as Id<"matters"> | undefined })} className="h-7 max-w-[200px] rounded-md border border-transparent bg-transparent text-xs hover:border-input"><option value="">— link a matter —</option>{(matters ?? []).map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}</select></td>
                <td className="num">{aud(r.amountCents)}</td>
                <td><Pill tone={statusTone(r.status)}>{r.status}</Pill>{r.paidAt && <div className="text-[11px] text-fg-tertiary">paid {day(r.paidAt)}</div>}</td>
                <td>{r.matter ? r.delivered ? <Pill tone="good">delivered</Pill> : <button type="button" onClick={() => markDelivered({ id: r.matter!._id, via: "manual" })} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-fg-secondary hover:bg-foreground hover:text-background">mark delivered</button> : <span className="text-xs text-fg-quaternary">no matter</span>}</td>
                <td className="text-xs text-fg-tertiary">{r.deliveredAt ? <>{day(r.deliveredAt)}<div>{r.deliveredVia}{r.daysInvoiceToDelivery !== undefined ? ` · ${r.daysInvoiceToDelivery}d` : ""}</div></> : "—"}</td>
                <td><div className="flex justify-end gap-1">{r.hostedUrl && <a href={r.hostedUrl} target="_blank" rel="noreferrer" className="inline-flex size-7 items-center justify-center rounded-md text-fg-secondary hover:bg-muted" title="Open in Stripe" aria-label="Open in Stripe"><ExternalLink className="size-3.5" /></a>}{r.pdfUrl && <a href={r.pdfUrl} className="inline-flex size-7 items-center justify-center rounded-md text-fg-secondary hover:bg-muted" title="Invoice PDF" aria-label="Invoice PDF"><FileText className="size-3.5" /></a>}{r.matter && <Link href={`/matters/${r.matter._id}`} className="text-xs text-fg-tertiary hover:text-foreground">matter</Link>}</div></td>
              </tr>
            ))}
          </DataTable>
        )}
      </Panel>
      {data && data.payments.length > 0 && (
        <Panel title="Recent payments" blurb="Checkout and card payments, including online bookings." dense>
          <DataTable head={<><th>When</th><th>Description</th><th>Payer</th><th>Amount</th><th>Status</th></>} minWidth={560}>
            {data.payments.slice(0, 30).map((p) => <tr key={p._id}><td className="text-xs text-fg-tertiary">{day(p.createdAt)}</td><td className="truncate">{p.description ?? p.kind}</td><td className="text-xs">{p.customerEmail ?? "—"}</td><td className="num">{aud(p.amountCents)}</td><td><Pill tone={statusTone(p.status === "succeeded" ? "paid" : p.status)}>{p.status}</Pill></td></tr>)}
          </DataTable>
        </Panel>
      )}
      {creating && <NewInvoice matters={matters ?? []} onClose={() => setCreating(false)} />}
    </div>
  );
}

function NewInvoice({ matters, onClose }: { matters: Array<{ _id: Id<"matters">; name: string; parties: string[] }>; onClose: () => void }) {
  const create = useAction(api.stripe.createInvoice);
  const [form, setForm] = useState({ matterId: "" as string, customerName: "", customerEmail: "", description: "Family report", amount: "", daysUntilDue: 14, send: true });
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const cents = Math.round(Number(form.amount) * 100);
    if (!cents || cents < 100) { toast.error("Enter an amount."); return; }
    setBusy(true);
    try { const r = await create({ matterId: (form.matterId || undefined) as Id<"matters"> | undefined, customerEmail: form.customerEmail.trim(), customerName: form.customerName.trim(), description: form.description.trim(), amountCents: cents, daysUntilDue: form.daysUntilDue, send: form.send }); toast.success(form.send ? "Invoice sent from Stripe" : "Invoice created", { action: r.hostedUrl ? { label: "Open", onClick: () => window.open(r.hostedUrl, "_blank") } : undefined }); onClose(); }
    catch (e) { toast.error(errorMessage(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <form className="w-full max-w-md space-y-3 rounded-2xl bg-card p-5 shadow-float" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); void submit(); }} role="dialog" aria-label="New invoice">
        <h2 className="font-display text-xl">New Stripe invoice</h2>
        <div><Label htmlFor="i-matter">Matter</Label><select id="i-matter" value={form.matterId} onChange={(e) => { const m = matters.find((x) => x._id === e.target.value); setForm({ ...form, matterId: e.target.value, description: m ? `Family report — ${m.name}` : form.description }); }} className="mt-1 h-9 w-full rounded-lg border border-input bg-card px-2 text-sm"><option value="">No matter</option>{matters.map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}</select></div>
        <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="i-name">Bill to (name)</Label><Input id="i-name" required value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} /></div><div><Label htmlFor="i-email">Email</Label><Input id="i-email" type="email" required value={form.customerEmail} onChange={(e) => setForm({ ...form, customerEmail: e.target.value })} /></div></div>
        <div><Label htmlFor="i-desc">Description</Label><Input id="i-desc" required value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
        <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="i-amt">Amount (AUD)</Label><Input id="i-amt" inputMode="decimal" required className="num" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} placeholder="2400.00" /></div><div><Label htmlFor="i-due">Due in (days)</Label><Input id="i-due" type="number" min={1} className="num" value={form.daysUntilDue} onChange={(e) => setForm({ ...form, daysUntilDue: Math.max(1, Number(e.target.value) || 14) })} /></div></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-foreground" checked={form.send} onChange={(e) => setForm({ ...form, send: e.target.checked })} />Email the invoice from Stripe now</label>
        <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? "Creating…" : form.send ? "Create and send" : "Create"}</Button><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button></div>
      </form>
    </div>
  );
}
