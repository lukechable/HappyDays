"use client";

import Link from "next/link";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { api } from "../../../convex/_generated/api";
import { PageHeader, Panel, Pill, Empty, Loading, ErrorBox, DataTable } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { useLive } from "@/lib/hooks";
import { aud } from "@/lib/format";

const modes: Record<string, string> = { required: "Full payment required", optional: "Payment optional", deposit_required: "Deposit required", disabled: "No payment at booking", unknown: "Not supplied by Cliniko" };
export function AppointmentTypesPage() {
  const setup = useQuery(api.settings.setupStatus);
  const source = useLive(api.bookings.appointmentPaymentTypes, setup?.cliniko ? {} : "skip", { ttlMs: 120_000 });
  const types = [...(source.data?.types ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  return <div className="space-y-5">
    <PageHeader title="Appointment types" blurb="Fees, booking deposits and payment requirements read directly from Cliniko." actions={<Button variant="outline" onClick={source.reload} disabled={source.refreshing}>{source.refreshing ? "Refreshing…" : "Refresh from Cliniko"}</Button>} />
    {setup && !setup.cliniko ? <Empty title="Cliniko isn’t connected" action={<Button render={<Link href="/settings?tab=cliniko" />}>Settings</Button>} /> : source.error ? <ErrorBox title="Couldn’t read appointment payment settings" message={source.error} retry={source.reload} /> : !source.data ? <Loading rows={8} /> : <Panel>
      <p className="mb-3 text-sm text-fg-secondary">{source.data.onlinePaymentsActivated === true ? "Online invoice payments are enabled in Cliniko. Booking requirements are shown separately below." : source.data.onlinePaymentsActivated === false ? "Online payments are disabled in Cliniko." : "Cliniko did not supply the account’s online payment status."}</p>
      <DataTable head={<><th>Type</th><th>Length</th><th>Online booking</th><th>Payment at booking</th><th className="text-right">Fee incl. tax</th><th className="text-right">Deposit</th><th></th></>} minWidth={900}>
        {types.map(t => <tr key={t.id}><td className="font-medium"><span className="mr-2 inline-block size-3 rounded-full" style={{ background: t.color ?? "#999" }} />{t.name}</td><td className="num whitespace-nowrap">{t.durationMinutes} min</td><td><Pill tone={t.bookableOnline ? "good" : undefined}>{t.bookableOnline ? "Yes" : "No"}</Pill></td><td><Pill tone={t.mode === "deposit_required" ? "warn" : t.mode === "required" ? "good" : undefined}>{modes[t.mode] ?? t.mode}</Pill></td><td className="num text-right">{t.feeCents === null ? "Not supplied" : aud(t.feeCents)}</td><td className="num text-right">{t.mode === "deposit_required" ? t.depositCents === null ? "Not supplied" : aud(t.depositCents) : "—"}</td><td><a href={t.clinikoUrl} target="_blank" rel="noreferrer" className="whitespace-nowrap text-xs hover:underline">Edit in Cliniko ↗</a></td></tr>)}
      </DataTable>
      <p className="mt-3 text-xs text-fg-tertiary">{types.filter(t => t.mode === "deposit_required").length} types require deposits. Fees use linked billable items and products; patient concessions may change the final invoice. Happy Days checkout overrides are managed in <Link href="/settings?tab=cliniko" className="underline">Settings</Link>.</p>
    </Panel>}
  </div>;
}
