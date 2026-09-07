"use client";

import { useState } from "react";
import { useAction, useConvex, useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { Copy, Lock, RefreshCw, Mail, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PrefetchLink } from "@/components/prefetch-link";
import { bundleName, encryptedZip, randomPassword } from "@/lib/encrypted-zip";
import { sha256 } from "@/lib/compose-handoff";
import { bytes } from "@/lib/format";
import { errorMessage } from "@/lib/utils";

const MAX_BYTES = 20 * 1024 * 1024;
const PRACTICE = "Barbara Fraser & Associates";

/**
 * The Send Documents flow. The chosen files are zipped and AES-256 encrypted in the browser, the zip is stored, and
 * it goes out from the signed-in Gmail account with a read receipt requested. The password is shown once at the end so
 * it can be passed on by another channel; it is never stored and never in the email.
 */
export function SendDialog({ files, matterId, onClose }: { files: File[]; matterId?: Id<"matters"> | null; onClose: (sent: boolean) => void }) {
  const matters = useQuery(api.matters.list, { includeClosed: false });
  const uploadUrl = useMutation(api.files.uploadUrl);
  const register = useMutation(api.files.register);
  const send = useAction(api.mail.sendDocuments);
  const [form, setForm] = useState({ toName: "", to: "", subject: `Documents from ${PRACTICE}`, message: "Please find the documents attached, as discussed.", password: randomPassword(), readReceipt: true, matterId: (matterId ?? "") as string });
  const [step, setStep] = useState<string | null>(null);
  const [done, setDone] = useState<{ gmailThreadId: string; password: string; name: string } | null>(null);
  const total = files.reduce((s, f) => s + f.size, 0);

  const submit = async () => {
    const to = form.to.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) { toast.error("Enter the recipient's email address."); return; }
    if (form.password.length < 8) { toast.error("The password needs at least 8 characters."); return; }
    if (total > MAX_BYTES) { toast.error(`These files come to ${bytes(total)}. Gmail takes about 20 MB per message; send fewer at once.`); return; }
    try {
      setStep("Zipping and encrypting…");
      const zip = await encryptedZip(files, form.password, (n, t) => setStep(`Encrypting ${n} of ${t}…`));
      setStep("Storing the encrypted bundle…");
      const url = await uploadUrl({});
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/zip" }, body: zip });
      if (!res.ok) throw new Error("Upload failed.");
      const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
      const name = bundleName(form.toName || to);
      const fileId = await register({ storageId, name, mime: "application/zip", size: zip.size, sha256: await sha256(zip), matterId: (form.matterId || undefined) as Id<"matters"> | undefined, isReport: files.some((f) => /report/i.test(f.name)), encrypted: true, bundleNames: files.map((f) => f.name) });
      setStep("Sending from Gmail…");
      const first = form.toName.trim().split(/\s+/)[0];
      const html = [
        `<p>Hello${first ? ` ${first}` : ""},</p>`,
        `<p>${escapeHtml(form.message).replace(/\n/g, "<br>")}</p>`,
        `<p>The attached file <b>${escapeHtml(name)}</b> contains:</p><ul>${files.map((f) => `<li>${escapeHtml(f.name)}</li>`).join("")}</ul>`,
        `<p>It is encrypted. The password will reach you separately, by text message or phone; it is not in this email. Windows Explorer and the Mac Finder cannot open encrypted zips of this kind: use 7-Zip or WinZip on Windows, or Keka or The Unarchiver on a Mac.</p>`,
        `<p>Kind regards,<br>${PRACTICE}</p>`,
      ].join("");
      const r = await send({ fileId, to: { name: form.toName.trim(), email: to }, subject: form.subject.trim() || `Documents from ${PRACTICE}`, html, readReceipt: form.readReceipt });
      setDone({ gmailThreadId: r.gmailThreadId, password: form.password, name });
      toast.success(`Sent to ${to}`);
    } catch (e) { toast.error(errorMessage(e)); }
    finally { setStep(null); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !step && onClose(!!done)}>
      <div className="w-full max-w-lg rounded-2xl bg-card p-5 shadow-float" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Send documents">
        {done ? (
          <div className="space-y-4">
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-fg-tertiary">Sent{form.readReceipt ? " · read receipt requested" : ""}</p>
              <p className="mt-1 text-sm text-fg-secondary"><b className="text-foreground">{done.name}</b> went to {form.toName ? `${form.toName} (${form.to})` : form.to} from your Gmail. The receipt, if their mail app sends one, arrives as a reply in the same thread.</p>
            </div>
            <div className="rounded-xl border border-border bg-muted/40 p-4 text-center">
              <p className="text-xs uppercase tracking-[0.14em] text-fg-tertiary">Password for the zip</p>
              <p className="num my-2 text-2xl font-semibold tracking-[0.08em]">{done.password}</p>
              <p className="text-xs text-fg-tertiary">Pass it on by text message or phone, never by email. It is not stored anywhere; copy it now.</p>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="outline" onClick={() => { void navigator.clipboard.writeText(done.password); toast.success("Password copied"); }}><Copy className="size-3.5" />Copy password</Button>
              <Button variant="outline" render={<PrefetchLink href={`/mail?thread=${done.gmailThreadId}`} />}><ExternalLink className="size-3.5" />Open the thread</Button>
              <Button onClick={() => onClose(true)}>Done</Button>
            </div>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <div>
              <h2 className="font-display text-xl">Send documents</h2>
              <p className="mt-1 text-sm text-fg-secondary">{files.length} file{files.length === 1 ? "" : "s"}, {bytes(total)}. They are zipped and encrypted here in your browser before anything is stored or sent.</p>
            </div>
            <ul className="max-h-28 space-y-0.5 overflow-y-auto rounded-lg border border-border p-2 text-sm">{files.map((f, i) => <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2"><span className="truncate">{f.name}</span><span className="num shrink-0 text-xs text-fg-tertiary">{bytes(f.size)}</span></li>)}</ul>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor="s-name">Recipient name</Label><Input id="s-name" value={form.toName} onChange={(e) => setForm({ ...form, toName: e.target.value })} autoFocus /></div>
              <div><Label htmlFor="s-to">Recipient email</Label><Input id="s-to" type="email" required value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} /></div>
            </div>
            <div><Label htmlFor="s-subject">Subject</Label><Input id="s-subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} /></div>
            <div><Label htmlFor="s-msg">Message</Label><textarea id="s-msg" rows={3} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className="mt-1 w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus:border-foreground" /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="s-pw">Zip password</Label>
                <div className="flex gap-1"><Input id="s-pw" className="num" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /><Button type="button" variant="outline" size="icon" title="New password" aria-label="New password" onClick={() => setForm({ ...form, password: randomPassword() })}><RefreshCw className="size-3.5" /></Button></div>
                <p className="mt-1 text-[11px] text-fg-tertiary">AES-256. Shown again after sending so you can pass it on by another channel.</p>
              </div>
              <div><Label htmlFor="s-matter">Matter</Label><select id="s-matter" value={form.matterId} onChange={(e) => setForm({ ...form, matterId: e.target.value })} className="mt-1 h-9 w-full rounded-lg border border-input bg-card px-2 text-sm"><option value="">No matter</option>{(matters ?? []).map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}</select><p className="mt-1 text-[11px] text-fg-tertiary">A report sent on a matter marks that matter delivered.</p></div>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-foreground" checked={form.readReceipt} onChange={(e) => setForm({ ...form, readReceipt: e.target.checked })} />Ask for a read receipt and a delivery receipt</label>
            <div className="flex items-center gap-2">
              <Button type="submit" disabled={!!step}>{step ? <><RefreshCw className="size-3.5 animate-spin" />{step}</> : <><Lock className="size-3.5" />Encrypt and send</>}</Button>
              <Button type="button" variant="ghost" disabled={!!step} onClick={() => onClose(false)}>Cancel</Button>
              <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-fg-tertiary"><Mail className="size-3" />from your Gmail</span>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);

/** Pull a stored file back into the browser as a File so it can go through the encrypted send flow. */
export function useStoredFileLoader() {
  const convex = useConvex();
  return async (id: Id<"files">, name: string, mime: string): Promise<File> => {
    const url = await convex.query(api.files.url, { id });
    if (!url) throw new Error("That file is no longer stored.");
    const res = await fetch(url);
    if (!res.ok) throw new Error("Couldn't read the file.");
    return new File([await res.blob()], name, { type: mime });
  };
}
