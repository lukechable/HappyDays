"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { PageHeader, Panel, Empty, Loading, ErrorBox, DataTable } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { PatientSearch } from "./patient-search";
import { useLive } from "@/lib/hooks";
import { ago, day } from "@/lib/format";

/** Patients, live from Cliniko: search on top, the most recently updated records below. Nothing is stored here. */
export function PatientsPage() {
  const router = useRouter();
  const setup = useQuery(api.settings.setupStatus);
  const recent = useLive(api.bookings.recentPatients, setup?.cliniko ? {} : "skip");
  return (
    <div className="space-y-6">
      <PageHeader title="Patients" blurb="Search by name, email or phone. Records, files and notes stay in Cliniko; this page links you there." actions={<PatientSearch onPick={(p) => router.push(`/bookings/patients/${p.id}`)} />} />
      {setup && !setup.cliniko ? <Empty title="Cliniko isn’t connected" action={<Button render={<Link href="/settings?tab=cliniko" />}>Settings</Button>} /> : (
        <Panel title="Recently updated" blurb="The 50 patient records Cliniko changed most recently." actions={<Button size="sm" variant="ghost" onClick={recent.reload}>Refresh</Button>}>
          {recent.error ? <ErrorBox title="Couldn’t read patients from Cliniko" message={recent.error} retry={recent.reload} /> : !recent.data ? <Loading rows={6} /> : recent.data.length === 0 ? <Empty title="No patients yet" /> : (
            <DataTable head={<><th>Patient</th><th>Contact</th><th>DOB</th><th>Updated</th><th></th></>} minWidth={640}>
              {recent.data.map((p) => <tr key={p.id} className="hover:bg-muted/50"><td><Link href={`/bookings/patients/${p.id}`} className="font-medium hover:underline">{p.name}</Link>{p.medicalAlerts && <div className="text-xs text-warning">{p.medicalAlerts}</div>}</td><td className="text-xs text-fg-secondary">{[p.email, p.phone].filter(Boolean).join(" · ") || "—"}</td><td className="text-xs">{p.dob ? day(p.dob) : "—"}</td><td className="text-xs text-fg-tertiary">{ago(Date.parse(p.updatedAt))}</td><td><a href={p.clinikoUrl} target="_blank" rel="noreferrer" className="text-xs text-fg-tertiary hover:text-foreground">Cliniko ↗</a></td></tr>)}
            </DataTable>
          )}
        </Panel>
      )}
    </div>
  );
}
