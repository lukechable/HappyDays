"use client";
import { useState } from "react";
import { useAction, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { PageHeader, Panel, Pill, Loading, ErrorBox, DataTable } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { PatientSearch } from "./patient-search";
import { ReferralCaseDialog } from "./referral-case-dialog";
import { useLive } from "@/lib/hooks";
import { errorMessage } from "@/lib/utils";
import { aud } from "@/lib/format";

const day = (value: string) => new Date(value.length === 10 ? `${value}T00:00:00+10:00` : value).toLocaleDateString("en-AU", { timeZone: "Australia/Melbourne", day: "numeric", month: "short", year: "numeric" });
const time = (value: string) => new Date(value).toLocaleTimeString("en-AU", { timeZone: "Australia/Melbourne", hour: "numeric", minute: "2-digit" });

export function RebatesPage() {
  const search = useSearchParams();
  const [patient, setPatient] = useState<{ id: string; name: string } | null>(() => search.get("patientId") ? { id: search.get("patientId")!, name: "Selected patient" } : null);
  const config = useQuery(api.rebateData.config);
  const { results: history, status: historyStatus, loadMore } = usePaginatedQuery(api.rebateData.history, {}, { initialNumItems: 25 });
  const goLive = useMutation(api.rebateData.setGoLive);
  const autoImport = useQuery(api.rebateData.autoImportStatus);
  const setAutoImport = useMutation(api.rebateData.setAutoImport);
  const reconcile = useAction(api.rebates.reconcile);
  const [launchDialog, setLaunchDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  return <div className="space-y-5">
    <PageHeader title="Medicare rebates" blurb="Process rebates for completed, attended and fully paid sessions covered by a verified referral." />
    <Panel title="HappyDays go-live" blurb="Appointments that took place before HappyDays went live are not eligible for rebate processing through HappyDays.">
      {config === undefined ? <Loading rows={1} /> : config.goLiveAt === null ? <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-fg-secondary">Rebates are disabled until launch. Set the fixed cutoff when HappyDays is ready.</p><Button className="min-h-10" variant="outline" onClick={() => setLaunchDialog(true)}>Go live now…</Button></div> : <p className="text-sm tabular-nums">Fixed cutoff: {new Date(config.goLiveAt).toLocaleString("en-AU", { timeZone: "Australia/Melbourne", timeZoneName: "short" })}</p>}
      {config && !config.tyroReady && <p className="mt-3 rounded-lg bg-warning-soft p-3 text-sm">Tyro partner access is not configured. You can manage cases and check eligibility; rebate submission is disabled.</p>}
    </Panel>
    <Panel title="Automatic referral cases" blurb="Use a Gmail filter to apply the HappyDays/Referrals label to incoming referral emails. New labelled messages with one PDF or photo are matched by exact patient name and date of birth. Created cases need verification before claiming.">
      <label className="flex min-h-10 items-center gap-3 text-sm"><input type="checkbox" checked={autoImport ?? false} disabled={busy || autoImport === undefined} onChange={async (e) => { setBusy(true); try { await setAutoImport({ enabled: e.target.checked }); } catch (error) { toast.error(errorMessage(error)); } finally { setBusy(false); } }} />Create referral cases automatically from new labelled emails</label>
      <p className="mt-1 text-xs text-fg-tertiary">Ambiguous matches need manual review. Existing emails are not imported automatically.</p>
    </Panel>
    <Panel title="Patient and referral">
      {patient ? <div className="flex items-center justify-between gap-3"><p className="text-sm">{patient.name}</p><Button className="min-h-10" variant="outline" onClick={() => setPatient(null)}>Change patient</Button></div> : <PatientSearch inline onPick={setPatient} />}
    </Panel>
    {patient && <PatientRebates key={patient.id} patientId={patient.id} enabled={!!config?.tyroReady && config?.goLiveAt !== null} />}
    <Panel title="Claim history" blurb="Opening Tyro reserves the appointment. Cancelled browser windows and network errors require reconciliation before another attempt.">
      {historyStatus === "LoadingFirstPage" ? <Loading rows={2} /> : history.length === 0 ? <p className="text-sm text-fg-secondary">No rebate attempts yet.</p> : <DataTable minWidth={560} head={<><th>Service</th><th>Reference</th><th>Fee</th><th>Status</th><th /></>}>
        {history.map((claim) => <tr key={claim._id}><td>{day(claim.serviceDate)}</td><td className="font-mono text-xs">{claim.invoiceReference}</td><td className="tabular-nums">{aud(claim.amountCents)}</td><td><Pill tone={claim.status === "approved" ? "good" : claim.status === "rejected" ? "bad" : "warn"}>{claim.status.replaceAll("_", " ")}</Pill></td><td><Button className="min-h-10" size="sm" variant="outline" disabled={busy || !config?.tyroReady || claim.status === "not_launched"} onClick={async () => { setBusy(true); try { const r = await reconcile({ claimId: claim._id }); toast.success(`Tyro: ${r.status.replaceAll("_", " ")}`); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } }}>Check Tyro</Button></td></tr>)}
      </DataTable>}
      {(historyStatus === "CanLoadMore" || historyStatus === "LoadingMore") && <Button className="mt-3 min-h-10" variant="outline" disabled={historyStatus === "LoadingMore"} onClick={() => loadMore(25)}>{historyStatus === "LoadingMore" ? "Loading…" : "Load older claims"}</Button>}
    </Panel>
    <Dialog open={launchDialog} onOpenChange={setLaunchDialog}><DialogContent><DialogTitle>Record HappyDays go-live now?</DialogTitle><DialogDescription>This permanently records the current time as the cutoff. Earlier appointments cannot be claimed through HappyDays. Only do this when the practice is ready to launch.</DialogDescription><Button disabled={busy} onClick={async () => { setBusy(true); try { await goLive({}); setLaunchDialog(false); toast.success("HappyDays go-live cutoff recorded"); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } }}>Record go-live now</Button><Button variant="outline" onClick={() => setLaunchDialog(false)}>Not yet</Button></DialogContent></Dialog>
  </div>;
}

function PatientRebates({ patientId, enabled }: { patientId: string; enabled: boolean }) {
  const options = useLive(api.rebates.patientOptions, { patientId });
  const [appointmentId, setAppointmentId] = useState("");
  const [caseId, setCaseId] = useState("");
  const [newCase, setNewCase] = useState(false);
  return <>
    <Panel title="Select the session and its referral" actions={<Button className="min-h-10" variant="outline" onClick={() => setNewCase(true)}>Create referral case</Button>}>
      {options.error ? <ErrorBox title="Could not load rebate details" message={options.error} retry={options.reload} /> : !options.data ? <Loading rows={2} /> : <div className="grid gap-4 sm:grid-cols-2">
        <div><Label htmlFor="rebate-appointment">Appointment</Label><select id="rebate-appointment" className="mt-1 min-h-10 w-full rounded-lg border border-input bg-card px-3 text-sm" value={appointmentId} onChange={(e) => setAppointmentId(e.target.value)}><option value="">Choose an appointment…</option>{options.data.appointments.map((a) => <option key={a.id} value={a.id}>{day(a.startsAt)} {time(a.startsAt)}{a.cancelled ? " · cancelled" : a.didNotArrive ? " · did not arrive" : ""}</option>)}</select></div>
        <div><Label htmlFor="rebate-case">Referral case</Label><select id="rebate-case" className="mt-1 min-h-10 w-full rounded-lg border border-input bg-card px-3 text-sm" value={caseId} onChange={(e) => setCaseId(e.target.value)}><option value="">Choose a case…</option>{options.data.cases.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.maxSessions ?? "no"} session limit</option>)}</select></div>
      </div>}
    </Panel>
    {appointmentId && caseId && <SessionRebate key={`${appointmentId}:${caseId}`} patientId={patientId} appointmentId={appointmentId} caseId={caseId} enabled={enabled} />}
    {newCase && <ReferralCaseDialog patientId={patientId} onClose={() => setNewCase(false)} onCreated={options.reload} />}
  </>;
}

function SessionRebate({ patientId, appointmentId, caseId, enabled }: { patientId: string; appointmentId: string; caseId: string; enabled: boolean }) {
  const check = useLive(api.rebates.check, { appointmentId, caseId }, { ttlMs: 0 });
  const verify = useAction(api.rebates.verifyReferral);
  const link = useAction(api.rebates.linkCase);
  const prepare = useAction(api.rebates.prepare);
  const reconcile = useAction(api.rebates.reconcile);
  const flags = useAction(api.bookings.updateAppointmentFlags);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [entitlement, setEntitlement] = useState(false);
  const [noOtherClaim, setNoOtherClaim] = useState(false);
  const [service, setService] = useState(false);
  const [provider, setProvider] = useState("");
  const [referrer, setReferrer] = useState("");
  const [itemCode, setItemCode] = useState("");
  const [otherClaimant, setOtherClaimant] = useState(false);
  const [claimant, setClaimant] = useState({ firstName: "", lastName: "", dob: "", accountNumber: "", reference: "" });
  const run = async (operation: () => Promise<unknown>) => { setBusy(true); try { await operation(); check.reload(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } };
  if (check.error) return <ErrorBox title="Could not load rebate details" message={check.error} retry={check.reload} />;
  const r = check.data;
  if (!r) return <Loading rows={4} />;
  const submit = async () => {
    setBusy(true);
    try {
      // Load before reserving the claim, so a bundle failure doesn't create an ambiguous claim attempt.
      const sdk = (await import("@medipass/partner-sdk")).default;
      const result = await prepare({ appointmentId, caseId, providerNumber: provider.trim().toUpperCase(), referrerProviderNumber: referrer.trim().toUpperCase(), itemCode: itemCode.trim(), claimant: otherClaimant ? claimant : undefined, entitlementConfirmed: entitlement, noOtherClaimConfirmed: noOtherClaim, serviceConfirmed: service });
      await sdk.setConfig({ env: "prod", apiKey: result.token, appId: result.appId, appVersion: "happydays-0.1.0" });
      const refresh = async () => {
        try { const outcome = await reconcile({ claimId: result.claimId }); toast.info(`Medicare claim: ${outcome.status.replaceAll("_", " ")}`); }
        catch { toast.info("The claim is awaiting reconciliation. Use Check Tyro in claim history; do not submit it again."); }
        finally { setBusy(false); check.reload(); }
      };
      sdk.renderCreateTransaction(result.payload, { onSuccess: refresh, onCancel: refresh, onError: refresh });
      check.reload();
    } catch (e) { toast.error(errorMessage(e)); setBusy(false); check.reload(); }
  };
  return <Panel title="Rebate checks" actions={<Button className="min-h-10" variant="outline" disabled={busy} onClick={check.reload}>{check.refreshing ? "Refreshing…" : "Refresh checks"}</Button>}>
    <div className="mb-4 flex flex-wrap gap-2"><Pill tone={r.attended ? "good" : "warn"}>{r.attended ? "Attendance confirmed" : "Attendance unconfirmed"}</Pill><Pill tone={r.paid ? "good" : "warn"}>{r.paid ? "Fully paid" : "Payment required"}</Pill><Pill tone={r.reviewed ? "good" : "warn"}>{r.reviewed ? "Referral verified" : "Referral needs review"}</Pill><span className="text-sm tabular-nums">Session {r.sessionNumber ?? "—"} of {r.maxSessions ?? "—"} · {r.amountCents ? aud(r.amountCents) : "Fee unavailable"}</span></div>
    <div aria-live="polite">{r.reasons.length > 0 ? <ul className="mb-4 list-disc space-y-1 rounded-lg bg-warning-soft py-3 pl-8 pr-3 text-sm">{r.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul> : <p className="mb-4 text-sm text-success">Attendance, payment and referral allocation checks passed. Confirm Medicare entitlement and service details below.</p>}</div>
    <div className="mb-4 flex flex-wrap gap-2">
      <Button className="min-h-10" variant="outline" disabled={busy || r.attended} onClick={() => void run(() => flags({ appointmentId, arrived: true }))}>Confirm patient attended</Button>
      <Button className="min-h-10" variant="outline" disabled={busy} onClick={() => void run(() => link({ appointmentId, caseId }))}>Link appointment to this case</Button>
      <Button className="min-h-10" variant="outline" render={<a href={r.clinikoUrl} target="_blank" rel="noreferrer" />}>Review referral in Cliniko ↗</Button>
    </div>
    {!r.reviewed && <div className="mb-5 space-y-2"><label className="flex min-h-10 items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={verified} onChange={(e) => setVerified(e.target.checked)} />I checked the original referral, patient, issue date and session allowance against this case.</label><Button className="min-h-10" variant="outline" disabled={!verified || busy} onClick={() => void run(() => verify({ caseId, patientId, expectedUpdatedAt: r.caseUpdatedAt }))}>Save referral verification</Button></div>}
    <div className="grid gap-4 sm:grid-cols-3">
      <div><Label htmlFor="rebate-provider">Treating provider number</Label><Input id="rebate-provider" value={provider} onChange={(e) => setProvider(e.target.value)} /></div>
      <div><Label htmlFor="rebate-referrer">Referring provider number</Label><Input id="rebate-referrer" value={referrer} onChange={(e) => setReferrer(e.target.value)} /></div>
      <div><Label htmlFor="rebate-item">MBS item for this service</Label><Input id="rebate-item" inputMode="numeric" value={itemCode} onChange={(e) => setItemCode(e.target.value)} /></div>
    </div>
    <div className="mt-4"><label className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={otherClaimant} onChange={(e) => setOtherClaimant(e.target.checked)} />Use an adult claimant (required when the patient is under 15)</label>
      {otherClaimant && <div className="mt-2 grid gap-3 sm:grid-cols-2">{([["firstName", "Claimant first name"], ["lastName", "Claimant last name"], ["dob", "Claimant date of birth"], ["accountNumber", "Claimant Medicare number"], ["reference", "Claimant reference number"]] as const).map(([field, label]) => <div key={field}><Label htmlFor={`claimant-${field}`}>{label}</Label><Input id={`claimant-${field}`} type={field === "dob" ? "date" : "text"} autoComplete="off" value={claimant[field]} onChange={(e) => setClaimant((c) => ({ ...c, [field]: e.target.value }))} /></div>)}</div>}
    </div>
    <div className="my-4 space-y-2">
      <label className="flex min-h-10 items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={entitlement} onChange={(e) => setEntitlement(e.target.checked)} />I confirmed Medicare entitlement for this service, including the annual limit and services claimed at other clinics.</label>
      <label className="flex min-h-10 items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={noOtherClaim} onChange={(e) => setNoOtherClaim(e.target.checked)} />This service has not already been submitted through Cliniko, Tyro or another claiming channel.</label>
      <label className="flex min-h-10 items-start gap-2 text-sm"><input className="mt-1" type="checkbox" checked={service} onChange={(e) => setService(e.target.checked)} />The provider, MBS item, service date and fully paid fee are correct for this session.</label>
    </div>
    <Button className="min-h-10" disabled={busy || check.refreshing || !enabled || !r.ready || !entitlement || !noOtherClaim || !service || !provider || !referrer || !itemCode} onClick={() => void submit()}>{busy ? "Working with Tyro…" : "Review and submit in Tyro"}</Button>
    <p className="mt-2 text-xs text-fg-tertiary">HappyDays rechecks the live records before opening Tyro. Medicare determines the claim outcome. In Tyro, use the already-paid patient claim option.</p>
  </Panel>;
}
