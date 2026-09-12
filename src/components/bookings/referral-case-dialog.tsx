"use client";
import { useState } from "react";
import { useAction } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { errorMessage } from "@/lib/utils";

export function ReferralCaseDialog({ patientId, onClose, onCreated }: { patientId: string; onClose: () => void; onCreated: () => void }) {
  const create = useAction(api.cases.create);
  const [sourceKey] = useState(() => `manual:${crypto.randomUUID()}`);
  const [name, setName] = useState("Mental health referral");
  const [issueDate, setIssueDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [sessions, setSessions] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" showCloseButton={!busy}>
      <DialogHeader><DialogTitle>Create Medicare referral case</DialogTitle><DialogDescription>The referral and session allowance are saved in Cliniko. Verify the original referral before submitting rebates.</DialogDescription></DialogHeader>
      <form className="space-y-4" onSubmit={async (e) => {
        e.preventDefault(); setBusy(true);
        try { await create({ patientId, name, issueDate, expiryDate: expiryDate || undefined, maxSessions: Number(sessions), notes: notes || undefined, sourceKey }); toast.success("Referral case created in Cliniko"); onCreated(); onClose(); }
        catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
      }}>
        <div><Label htmlFor="ref-name">Case name</Label><Input id="ref-name" required value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><Label htmlFor="ref-date">Referral issue date</Label><Input id="ref-date" required type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></div>
          <div><Label htmlFor="ref-expiry">Recorded expiry (optional)</Label><Input id="ref-expiry" type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)} /></div>
          <div><Label htmlFor="ref-sessions">Sessions on this referral</Label><Input id="ref-sessions" required type="number" min={1} max={200} step={1} value={sessions} onChange={(e) => setSessions(e.target.value)} /></div>
        </div>
        <div><Label htmlFor="ref-notes">Referral notes / document reference</Label><textarea id="ref-notes" className="w-full rounded-lg border border-input bg-card p-3" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        <div className="flex gap-2"><Button type="submit" className="min-h-10" disabled={busy}>{busy ? "Creating…" : "Create case"}</Button><Button type="button" className="min-h-10" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button></div>
      </form>
    </DialogContent>
  </Dialog>;
}
