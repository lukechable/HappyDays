"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { PdfPage, type Field } from "./pdf-viewer";
import { SignaturePad } from "./signature-pad";
import { openPdf, flatten, dateStamp, type LoadedPdf, type Annotation } from "@/lib/pdf";
import { sha256 } from "@/lib/compose-handoff";
import { errorMessage } from "@/lib/utils";

/**
 * The signer's page. No login: the token in the link is the credential. Fields are completed in the browser, the
 * signature is flattened into the PDF with pdf-lib, and the result is uploaded with an audit trail.
 */
export function PublicSign({ token }: { token: string }) {
  const req = useQuery(api.signatures.publicByToken, { token });
  const viewed = useMutation(api.signatures.publicViewed);
  const uploadUrl = useMutation(api.signatures.publicUploadUrl);
  const complete = useMutation(api.signatures.publicComplete);
  const decline = useMutation(api.signatures.publicDecline);
  const [pdf, setPdf] = useState<LoadedPdf | null>(null);
  const [fields, setFields] = useState<Field[]>([]);
  const [active, setActive] = useState<Field | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const marked = useRef(false);
  useEffect(() => { if (req && !marked.current) { marked.current = true; void viewed({ token, userAgent: navigator.userAgent }); } }, [req, token, viewed]);
  useEffect(() => { if (req?.fileUrl) fetch(req.fileUrl).then((r) => r.arrayBuffer()).then(async (b) => { setPdf(await openPdf(new Uint8Array(b))); setFields(req.fields.map((f) => ({ ...f }))); }).catch((e) => toast.error(errorMessage(e))); }, [req?.fileUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  if (req === undefined) return <Shell><p className="text-sm text-fg-tertiary">Loading…</p></Shell>;
  if (req === null) return <Shell><h1 className="font-display text-2xl">This link isn’t valid.</h1><p className="mt-2 text-sm text-fg-secondary">Check the address you were sent, or ask the practice for a new link.</p></Shell>;
  if (done || req.status === "signed") return <Shell><h1 className="font-display text-2xl">Signed. Thank you.</h1><p className="mt-2 text-sm text-fg-secondary">{req.practiceName} has received the signed document.</p>{req.signedUrl && <Button className="mt-4" render={<a href={req.signedUrl} target="_blank" rel="noreferrer" />}>Download your copy</Button>}</Shell>;
  if (req.status === "declined") return <Shell><h1 className="font-display text-2xl">You declined to sign.</h1><p className="mt-2 text-sm text-fg-secondary">The practice has been told. Contact them if that was a mistake.</p></Shell>;
  if (req.status === "cancelled" || req.status === "expired") return <Shell><h1 className="font-display text-2xl">This request is no longer open.</h1><p className="mt-2 text-sm text-fg-secondary">Ask {req.practiceName} to send a new one.</p></Shell>;

  const remaining = fields.filter((f) => !f.value && f.kind !== "date");
  const fill = (f: Field, value: string) => setFields((x) => x.map((y) => (y.id === f.id ? { ...y, value } : y)));
  const onField = (f: Field) => {
    if (f.kind === "date") { fill(f, dateStamp()); return; }
    if (f.kind === "text") { const v = prompt(f.label ?? "Enter text", f.value ?? ""); if (v !== null) fill(f, v); return; }
    setActive(f);
  };
  const submit = async () => {
    if (!pdf) return;
    if (remaining.length) { toast.error(`${remaining.length} field${remaining.length === 1 ? "" : "s"} still to complete.`); return; }
    setBusy(true);
    try {
      const annotations: Annotation[] = fields.map((f) => f.kind === "signature" || f.kind === "initials" ? { id: f.id, page: f.page, kind: "image" as const, x: f.x, y: f.y, w: f.w, h: f.h, dataUrl: f.value! } : { id: f.id, page: f.page, kind: "text" as const, x: f.x, y: f.y, w: f.w, h: f.h, text: f.value ?? dateStamp(), color: "#14213d", size: 11 });
      const bytes = await flatten(pdf.bytes, annotations);
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const url = await uploadUrl({ token });
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: blob });
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      await complete({ token, storageId, size: bytes.length, sha256: await sha256(blob), userAgent: navigator.userAgent });
      setDone(true);
    } catch (e) { toast.error(errorMessage(e)); }
    finally { setBusy(false); }
  };

  return (
    <main className="min-h-svh bg-surface-2/60">
      <header className="sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur"><div className="mx-auto flex max-w-4xl flex-wrap items-center gap-3 px-4 py-3"><div className="min-w-0 flex-1"><p className="text-[10.5px] uppercase tracking-[0.14em] text-fg-tertiary">{req.practiceName}</p><h1 className="truncate font-display text-lg">{req.fileName}</h1></div><span className="num text-xs text-fg-tertiary">{fields.length - remaining.length} of {fields.length} fields</span><Button variant="ghost" size="sm" onClick={async () => { const r = prompt("Tell the practice why you are declining (optional)") ; if (r === null) return; await decline({ token, reason: r || undefined }); }}>Decline</Button><Button size="sm" disabled={busy || !pdf} onClick={submit}>{busy ? "Finishing…" : "Finish and send"}</Button></div></header>
      <div className="mx-auto max-w-4xl px-4 py-4">
        {req.message && <p className="mb-3 rounded-xl bg-card px-4 py-3 text-sm ring-1 ring-black/[0.06]">{req.message}</p>}
        <p className="mb-3 text-sm text-fg-secondary">Hello {req.signerName.split(" ")[0]}. Tap each highlighted field to complete it, then press <b>Finish and send</b>.</p>
        {!pdf ? <div className="h-[60svh] animate-pulse rounded-xl bg-muted" /> : <div className="space-y-4">{Array.from({ length: pdf.pageCount }, (_, i) => <PdfPage key={i} pdf={pdf} pageNo={i + 1} scale={Math.min(1.2, (Math.min(900, typeof window !== "undefined" ? window.innerWidth - 32 : 800)) / 620)} tool="select" color="#0081f2" annotations={[]} fields={fields} onFieldClick={onField} readOnly />)}</div>}
        <p className="mt-6 text-xs text-fg-quaternary">By finishing you agree that your electronic signature is as valid as a handwritten one. The time and network address of signing are recorded.</p>
      </div>
      {active && <SignaturePad label={active.kind === "initials" ? "Your initials" : "Your signature"} initials={active.kind === "initials"} defaultName={req.signerName} onCancel={() => setActive(null)} onDone={(url) => { fill(active, url); const same = fields.filter((f) => f.kind === active.kind && !f.value && f.id !== active.id); if (same.length && confirm(`Apply the same ${active.kind} to the other ${same.length} ${active.kind} field${same.length === 1 ? "" : "s"}?`)) setFields((x) => x.map((y) => (y.kind === active.kind && !y.value ? { ...y, value: url } : y))); setActive(null); }} />}
    </main>
  );
}

const Shell = ({ children }: { children: React.ReactNode }) => <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center px-6 py-12">{children}</main>;
