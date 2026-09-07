"use client";

import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { PageHeader, Panel, Pill, Empty, Loading, ErrorBox, DataTable } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { PricingRow } from "@/components/settings/settings-page";
import { useLive } from "@/lib/hooks";
import { aud } from "@/lib/format";
import { errorMessage } from "@/lib/utils";
import { siteUrl } from "@/lib/public-url";

/** Every Cliniko appointment type with its colour, length and how Happy Days charges for it online. */
export function AppointmentTypesPage() {
  const setup = useQuery(api.settings.setupStatus);
  const practice = useLive(api.bookings.practice, setup?.cliniko ? {} : "skip");
  const pricing = useQuery(api.bookings.pricing);
  const syncPricing = useAction(api.bookings.syncPricing);
  const setPricing = useMutation(api.bookings.setPricing);
  const byId = new Map((pricing ?? []).map((p) => [p.clinikoAppointmentTypeId, p]));
  const types = (practice.data?.appointmentTypes ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div className="space-y-6">
      <PageHeader title="Appointment types" blurb="Cliniko owns the types, colours and lengths. Happy Days decides whether each can be booked online and what is paid up front through Stripe." actions={<Button variant="outline" disabled={!practice.data} onClick={async () => { try { const n = await syncPricing({}); toast.success(`${n} appointment types synced`); } catch (e) { toast.error(errorMessage(e)); } }}>Sync pricing rows</Button>} />
      {setup && !setup.cliniko ? <Empty title="Cliniko isn’t connected" action={<Button render={<Link href="/settings?tab=cliniko" />}>Settings</Button>} /> : practice.error ? <ErrorBox title="Couldn’t read appointment types" message={practice.error} retry={practice.reload} /> : !practice.data || pricing === undefined ? <Loading rows={8} /> : (
        <Panel>
          <DataTable head={<><th>Type</th><th>Length</th><th>Cliniko online</th><th>Book online here</th><th>Charge</th><th>Fee</th><th>Deposit</th></>} minWidth={900}>
            {types.map((t) => {
              const p = byId.get(t.id);
              return p ? <PricingRow key={t.id} p={{ ...p, name: t.name }} color={t.color} telehealth={!!t.telehealth_enabled} clinikoOnline={!!t.show_in_online_bookings} onSave={(patch) => setPricing({ id: p._id, mode: patch.mode ?? p.mode, feeCents: patch.feeCents ?? p.feeCents, depositCents: patch.depositCents ?? p.depositCents, bookableOnline: patch.bookableOnline ?? p.bookableOnline }).then(() => toast.success(`${t.name} saved`)).catch((e) => toast.error(errorMessage(e)))} />
                : <tr key={t.id}><td><span className="mr-2 inline-block size-3 rounded-full align-middle" style={{ background: t.color ?? "#999" }} />{t.name}</td><td className="num text-fg-secondary">{t.duration_in_minutes} min</td><td>{t.show_in_online_bookings ? <Pill tone="good">yes</Pill> : <Pill>no</Pill>}</td><td colSpan={4} className="text-xs text-fg-tertiary">Click “Sync pricing rows” to price this type.</td></tr>;
            })}
          </DataTable>
          <p className="mt-3 text-xs text-fg-tertiary">{(pricing ?? []).filter((p) => p.bookableOnline && p.mode !== "none").length} type{(pricing ?? []).filter((p) => p.bookableOnline && p.mode !== "none").length === 1 ? "" : "s"} bookable online at {siteUrl()}/book. Paid amounts show as {aud(0).replace("0.00", "…")} on the booking page.</p>
        </Panel>
      )}
    </div>
  );
}
