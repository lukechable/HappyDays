"use client";

import { useEffect, useState } from "react";
import { useAction } from "convex/react";
import { FileText, RefreshCw, ExternalLink, UserRound } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PatientSearch } from "@/components/bookings/patient-search";
import { errorMessage } from "@/lib/utils";

type Fields = Record<string, string | null>;
const LABELS: Array<[string, string]> = [["patientName", "Patient"], ["dateOfBirth", "Date of birth"], ["medicareNumber", "Medicare number"], ["patientPhone", "Phone"], ["patientEmail", "Email"], ["referrerName", "Referring GP"], ["referrerPracticeName", "GP practice"], ["referrerProviderNumber", "Provider number"], ["referralDate", "Referral date"], ["planType", "Plan type"], ["sessionsReferred", "Sessions referred"], ["diagnosis", "Diagnosis"], ["presentingIssues", "Presenting issues"]];

/**
 * Reads the attached plan, shows what Claude found for checking, asks which Cliniko patient it belongs to, and
 * creates the patient case in Cliniko. The exact fields to extract are a first cut until Luke specifies them.
 */
export function CreateCaseDialog({ gmailMessageId, attachment, onClose }: { gmailMessageId: string; attachment: { attachmentId: string; filename: string; mime: string }; onClose: () => void }) {
  const readPlan = useAction(api.cases.readPlan);
  const create = useAction(api.cases.create);
  const autoCreate = useAction(api.cases.autoCreateFromPlan);
  const [issueDate, setIssueDate] = useState("");
  const [maxSessions, setMaxSessions] = useState("");
  const [fields, setFields] = useState<Fields | null>(null);
  const [reading, setReading] = useState(true);
  const [patient, setPatient] = useState<{ id: string; name: string } | null>(null);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ url: string } | null>(null);

  useEffect(() => {
    let live = true;
    readPlan({ gmailMessageId, attachmentId: attachment.attachmentId, mime: attachment.mime, filename: attachment.filename })
      .then((f) => { if (!live) return; setFields(f); setIssueDate(f.referralDate ?? ""); setMaxSessions(f.sessionsReferred ?? ""); setName([f.planType ?? "Mental Health Treatment Plan", f.referrerName ? `from ${f.referrerName}` : "", f.referralDate ?? ""].filter(Boolean).join(" ")); setNotes([f.diagnosis && `Diagnosis: ${f.diagnosis}`, f.presentingIssues && `Presenting: ${f.presentingIssues}`, f.sessionsReferred && `Sessions referred: ${f.sessionsReferred}`, f.referrerProviderNumber && `Provider no: ${f.referrerProviderNumber}`, f.notes].filter(Boolean).join("\n")); })
      .catch((e) => { toast.error(errorMessage(e)); onClose(); })
      .finally(() => { if (live) setReading(false); });
    return () => { live = false; };
  }, [gmailMessageId, attachment.attachmentId, attachment.mime, attachment.filename, readPlan, onClose]);

  const submit = async () => {
    if (!patient) { toast.error("Pick the Cliniko patient this plan belongs to."); return; }
    setBusy(true);
    try { const r = await create({ patientId: patient.id, name, notes: notes || undefined, issueDate: issueDate || undefined, maxSessions: maxSessions ? Number(maxSessions) : undefined, sourceKey: fields?.sourceKey || `mail:${gmailMessageId}:${attachment.attachmentId}` }); setDone(r); toast.success("Case created in Cliniko"); }
    catch (e) { toast.error(errorMessage(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !busy && onClose()}>
      <div className="hd-pop flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-card shadow-float" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Create case">
        <div className="border-b border-border px-5 py-3"><h2 className="flex items-center gap-2 font-display text-xl"><FileText className="size-4" />Create case from {attachment.filename}</h2><p className="mt-0.5 text-xs text-fg-tertiary">Review the extracted details, then match the patient automatically or choose them yourself. Edits below apply when you choose the patient manually.</p></div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {reading ? <div className="flex items-center gap-2 py-8 text-sm text-fg-secondary"><RefreshCw className="size-4 animate-spin" />Reading the plan…</div> : done ? (
            <div className="space-y-3 text-sm"><p>The referral case was created in Cliniko. Verify the original referral before claiming.</p><Button render={<a href={done.url} target="_blank" rel="noreferrer" />}><ExternalLink className="size-3.5" />Open in Cliniko</Button></div>
          ) : (
            <div className="space-y-4">
              <div>
                <Label>Found in the plan</Label>
                <dl className="mt-1 grid grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-1 rounded-xl border border-border p-3 text-sm sm:grid-cols-[140px_minmax(0,1fr)]">{LABELS.map(([k, l]) => <div key={k} className="contents"><dt className="text-xs text-fg-tertiary sm:pt-0.5">{l}</dt><dd className={fields?.[k] ? "" : "text-fg-quaternary"}>{fields?.[k] ?? "not stated"}</dd></div>)}</dl>
              </div>
              <div>
                <Label>Cliniko patient</Label><Button className="my-2 min-h-10" variant="outline" disabled={busy} onClick={async () => { setBusy(true); try { const result = await autoCreate({ gmailMessageId, ...attachment }); setDone(result); toast.success("Case imported automatically; verify the original referral before claiming."); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } }}>Match patient and create automatically</Button>
                {patient ? <div className="mt-1 flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"><UserRound className="size-4 text-fg-tertiary" />{patient.name}<Button size="xs" variant="ghost" className="ml-auto" onClick={() => setPatient(null)}>Change</Button></div> : <div className="mt-1"><PatientSearch inline onPick={(p) => setPatient(p)} /><p className="mt-1 text-[11px] text-fg-tertiary">{fields?.patientName ? `The plan names ${fields.patientName}. Search for them above.` : "Search by name, email or phone."}</p></div>}
              </div>
              <div><Label htmlFor="cc-name">Case name</Label><Input id="cc-name" value={name} onChange={(e) => setName(e.target.value)} /></div>
              <div className="grid grid-cols-2 gap-3"><div><Label htmlFor="cc-date">Referral issue date</Label><Input id="cc-date" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></div><div><Label htmlFor="cc-sessions">Sessions referred</Label><Input id="cc-sessions" type="number" min={1} max={200} value={maxSessions} onChange={(e) => setMaxSessions(e.target.value)} /></div></div>
              <div><Label htmlFor="cc-notes">Case notes</Label><textarea id="cc-notes" rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus:border-foreground" /></div>
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 border-t border-border px-5 py-3">
          {done ? <Button onClick={onClose}>Done</Button> : <><Button onClick={() => void submit()} disabled={reading || busy || !patient || !name.trim()}>{busy ? "Creating…" : "Create case in Cliniko"}</Button><Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button></>}
        </div>
      </div>
    </div>
  );
}
