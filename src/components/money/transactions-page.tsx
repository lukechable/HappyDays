"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { useAction } from "convex/react";
import { useLive } from "@/lib/hooks";
import { toast } from "sonner";
import { errorMessage } from "@/lib/utils";
import { Landmark, Link2 } from "lucide-react";
import { ExternalLink, X } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { PageHeader, Panel, Pill, statusTone, Kpi, Empty, Loading, DataTable } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ExportMenu } from "@/components/export/export-menu";
import { aud, day, time } from "@/lib/format";
import { cn } from "@/lib/utils";

type Kind = "all" | "payment" | "invoice" | "booking" | "bank";
type SortKey = "at" | "amountCents" | "status" | "who";

/** Every Stripe payment and invoice payment as one dated ledger, with period and type filters, totals and export. */
export function TransactionsPage() {
  const data = useQuery(api.money.transactions);
  const setup = useQuery(api.settings.setupStatus);
  const bankStatus = useQuery(api.bank.status);
  const bank = useLive(api.bank.transactions, bankStatus?.configured && bankStatus.linked ? {} : "skip", { ttlMs: 300_000 });
  const connectLink = useAction(api.bank.connectLink);
  const [linking, setLinking] = useState(false);
  // Same-tab navigation: a window.open after an await is blocked by popup blockers. Basiq's consent page sends the browser back to the policy's redirect URL (this page).
  const link = async () => { setLinking(true); try { const { url } = await connectLink({}); window.location.assign(url); } catch (e) { toast.error(errorMessage(e)); setLinking(false); } };
  // A bank credit matches an invoice when the payer typed the invoice number as the reference, or the amount equals an open invoice.
  const invoices = data?.rows.filter((r) => r.kind === "invoice") ?? [];
  const matchFor = (t: { description: string; amountCents: number }) => invoices.find((i) => i.description && new RegExp(`\\b${(i.stripeId.split("_")[1] ?? "").slice(0, 8)}`, "i").test(t.description)) ?? invoices.find((i) => i.status === "open" && i.amountCents === t.amountCents);
  const [days, setDays] = useState<number | null>(90);
  const [kind, setKind] = useState<Kind>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "at", dir: -1 });

  const rows = useMemo(() => {
    let r = data?.rows ?? [];
    if (days) { const since = Date.now() - days * 86_400_000; r = r.filter((x) => x.at >= since); }
    if (kind === "booking") r = r.filter((x) => x.booking);
    else if (kind !== "all" && kind !== "bank") r = r.filter((x) => x.kind === kind);
    if (q.trim()) { const n = q.trim().toLowerCase(); r = r.filter((x) => [x.description, x.who, x.matter?.name, x.stripeId, x.status].some((v) => v?.toLowerCase().includes(n))); }
    const val = (x: (typeof r)[number]) => sort.key === "who" ? (x.who ?? "").toLowerCase() : x[sort.key] ?? "";
    return [...r].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir);
  }, [data, days, kind, q, sort]);
  const received = rows.filter((r) => r.status === "succeeded" || r.status === "paid").reduce((s, r) => s + r.amountCents, 0);
  const filtered = kind !== "all" || !!q.trim() || days !== 90;
  const th = (label: string, key: SortKey, right = false) => <th className={right ? "text-right" : ""}><button type="button" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 }))} className={cn("uppercase", sort.key === key && "text-foreground")}>{label}{sort.key === key ? (sort.dir === 1 ? " ↑" : " ↓") : ""}</button></th>;
  const exportTable = () => ({ title: "Transactions", subtitle: [days ? `Last ${days} days` : "All time", kind !== "all" ? kind : "", q ? `search “${q}”` : "", `${rows.length} rows, ${aud(received)} received`].filter(Boolean).join(" · "), filename: `transactions-${new Date().toISOString().slice(0, 10)}`, columns: [{ key: "date", label: "Date" }, { key: "description", label: "Description" }, { key: "who", label: "Who" }, { key: "matter", label: "Matter" }, { key: "type", label: "Type" }, { key: "amount", label: "Amount", align: "right" as const }, { key: "status", label: "Status" }, { key: "stripeId", label: "Stripe id" }], rows: rows.map((r) => ({ date: day(r.at), description: r.description, who: r.who ?? "", matter: r.matter?.name ?? "", type: r.booking ? "booking" : r.kind, amount: (r.amountCents / 100).toFixed(2), status: r.status, stripeId: r.stripeId })) });

  return (
    <div className="space-y-5">
      <PageHeader title="Transactions" blurb="Every payment Stripe has taken for the practice, in one list: online bookings, card payments and report invoices on the day they were paid." actions={<><div className="flex gap-0.5 rounded-full bg-muted p-0.5 text-xs">{([30, 90, 365, null] as const).map((d) => <button key={d ?? "all"} type="button" onClick={() => setDays(d)} className={cn("h-7 rounded-full px-2.5", days === d ? "bg-card shadow-xs" : "text-fg-tertiary hover:text-foreground")}>{d ? `${d} days` : "All"}</button>)}</div><ExportMenu table={exportTable} disabled={!rows.length} /></>} />
      {setup && !setup.stripe && <p className="rounded-2xl bg-warning-soft px-4 py-3 text-sm">Stripe isn’t connected. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET on the Convex deployment, then Sync from the Invoices page.</p>}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Kpi label={filtered ? "Received (filtered)" : "Received, 90 days"} value={data ? aud(received, { whole: true }) : "…"} sub={`${rows.length} transaction${rows.length === 1 ? "" : "s"}`} />
        <Kpi label="This month" value={data ? aud(data.totals.monthCents, { whole: true }) : "…"} sub="paid since the 1st" />
        <Kpi label="All time" value={data ? aud(data.totals.receivedCents, { whole: true }) : "…"} sub="mirrored from Stripe" />
        <Kpi label="Open invoices" value={data ? aud(data.totals.openCents, { whole: true }) : "…"} tone={(data?.totals.openCents ?? 0) > 0 ? "warn" : undefined} sub="not yet paid" href="/money" />
      </div>
      <Panel>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {([["all", "All"], ["payment", "Payments"], ["invoice", "Invoices"], ["booking", "Bookings"], ["bank", "Bank"]] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setKind(k)} className={cn("rounded-full px-2.5 py-1 text-xs", kind === k ? "bg-foreground text-background" : "bg-muted text-fg-secondary hover:text-foreground")}>{l}</button>)}
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search description, payer, matter, id" className="ml-auto h-8 w-64" />
          {filtered && <Button size="xs" variant="ghost" onClick={() => { setKind("all"); setQ(""); setDays(90); }}><X className="size-3" />Clear</Button>}
        </div>
        {kind === "bank" ? (
          !bankStatus ? <Loading rows={4} /> : !bankStatus.configured ? <Empty title="Bank feed not set up" body="Direct deposits show here once Basiq is connected. Set BASIQ_API_KEY on the Convex deployment (a Basiq account, basiq.io), then link the practice's Bendigo Bank account." /> : !bankStatus.linked ? <Empty title="Link the practice's bank account" body="Basiq opens Bendigo Bank's consent page; you sign in there and choose the account. We only ever read transactions, never move money." action={<Button onClick={link} disabled={linking}><Link2 className="size-3.5" />{linking ? "Opening…" : "Link bank account"}</Button>} /> : bank.error ? <Empty title="Couldn’t read the bank feed" body={bank.error} action={<Button variant="outline" onClick={bank.reload}>Try again</Button>} /> : !bank.data ? <Loading rows={6} /> : bank.data.rows.length === 0 ? <Empty title="No bank transactions yet" body="Basiq may still be fetching history for a newly linked account." action={<Button variant="outline" onClick={bank.reload}>Refresh</Button>} /> : (
            <>
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-fg-tertiary"><Landmark className="size-3.5" />{bank.data.accounts.map((a) => a.name).join(", ")}<Button size="xs" variant="ghost" className="ml-auto" onClick={bank.reload}>{bank.refreshing ? "Refreshing…" : "Refresh"}</Button><Button size="xs" variant="ghost" onClick={link}>Relink</Button></div>
              <DataTable head={<><th>Date</th><th>Reference / description</th><th>Account</th><th className="text-right">Amount</th><th>Matches</th></>} minWidth={720}>
                {bank.data.rows.filter((t) => !q.trim() || t.description.toLowerCase().includes(q.trim().toLowerCase())).map((t) => { const m = t.direction === "credit" ? matchFor(t) : undefined; return (
                  <tr key={t.id} className={cn("hover:bg-muted/50", t.direction === "credit" && "bg-success-soft/20")}>
                    <td className="text-xs text-fg-tertiary">{day(t.postDate)}</td>
                    <td className="max-w-[360px] truncate font-medium" title={t.description}>{t.description || "—"}</td>
                    <td className="text-xs text-fg-tertiary">{t.accountName ?? "—"}</td>
                    <td className={cn("num text-right", t.direction === "credit" ? "text-success" : "")}>{t.direction === "credit" ? "+" : "−"}{aud(t.amountCents)}</td>
                    <td className="text-xs">{m ? <Link href="/money" className="hover:underline">{m.description} · {m.status}</Link> : t.direction === "credit" ? <span className="text-fg-quaternary">no invoice matched</span> : ""}</td>
                  </tr>
                ); })}
              </DataTable>
            </>
          )
        ) : data === undefined ? <Loading rows={6} /> : rows.length === 0 ? <Empty title={data.rows.length ? "No transactions match" : "No transactions yet"} body={data.rows.length ? "Try another period or filter." : "Payments appear here as Stripe reports them. Click Sync Stripe on the Invoices page to import history."} /> : (
          <DataTable head={<>{th("When", "at")}<th>Description</th>{th("Who", "who")}<th>Matter</th><th>Type</th>{th("Amount", "amountCents", true)}{th("Status", "status")}<th></th></>} minWidth={820}>
            {rows.map((r) => (
              <tr key={`${r.kind}-${r._id}`} className="hover:bg-muted/50">
                <td className="text-xs text-fg-tertiary">{day(r.at)}<br />{time(r.at)}</td>
                <td className="max-w-[280px] truncate" title={r.description}>{r.description}</td>
                <td className="truncate text-xs">{r.who ?? "—"}</td>
                <td className="text-xs">{r.matter ? <Link href={`/matters/${r.matter._id}`} className="hover:underline">{r.matter.name}</Link> : <span className="text-fg-quaternary">—</span>}</td>
                <td><Pill tone={r.booking ? "info" : "neutral"}>{r.booking ? "booking" : r.kind === "invoice" ? "invoice" : r.source.replace("_", " ")}</Pill></td>
                <td className="num text-right">{aud(r.amountCents)}</td>
                <td><Pill tone={statusTone(r.status === "succeeded" ? "paid" : r.status)}>{r.status}</Pill></td>
                <td><div className="flex justify-end">{r.hostedUrl && <a href={r.hostedUrl} target="_blank" rel="noreferrer" className="inline-flex size-7 items-center justify-center rounded-md text-fg-secondary hover:bg-muted" title="Open in Stripe" aria-label="Open in Stripe"><ExternalLink className="size-3.5" /></a>}</div></td>
              </tr>
            ))}
            <tr><td colSpan={5} className="text-xs text-fg-tertiary">{rows.length} transaction{rows.length === 1 ? "" : "s"}</td><td className="num text-right font-semibold">{aud(received)}</td><td colSpan={2} className="text-xs text-fg-tertiary">received</td></tr>
          </DataTable>
        )}
      </Panel>
    </div>
  );
}
