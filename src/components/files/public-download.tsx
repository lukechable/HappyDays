"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { Download, Lock } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { bytes } from "@/lib/format";

/** The client-facing download page: enter a code, maybe a PIN, get the files. Every attempt is logged. */
export function PublicDownload({ initialCode }: { initialCode?: string }) {
  const [typed, setTyped] = useState(initialCode ?? "");
  const [code, setCode] = useState(initialCode?.toUpperCase() ?? "");
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [links, setLinks] = useState<Array<{ _id: string; name: string; size: number; url: string | null }> | null>(null);
  const practice = useQuery(api.settings.publicPractice);
  const lookup = useQuery(api.files.publicLookup, code.length >= 6 ? { code } : "skip");

  const redeem = async (fileId?: string) => {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/d/${encodeURIComponent(code)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: pin || undefined, list: !fileId && (lookup?.state === "ok" ? lookup.files.length > 1 : false), fileId }) });
      if (!res.ok) { const j = (await res.json().catch(() => ({}))) as { reason?: string }; setError(j.reason === "bad_pin" ? "That PIN isn’t right." : j.reason === "expired" ? "This code has expired. Please contact the practice." : j.reason === "revoked" ? "This code is no longer active." : j.reason === "limit" ? "This code has reached its download limit." : "That code wasn’t recognised."); return; }
      const ct = res.headers.get("content-type") ?? "";
      if (ct.includes("application/json")) { const j = (await res.json()) as { files: Array<{ _id: string; name: string; size: number; url: string | null }> }; setLinks(j.files); return; }
      const blob = await res.blob();
      const name = decodeURIComponent(/filename\*=UTF-8''([^;]+)/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "document");
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href);
      setLinks([{ _id: "one", name, size: blob.size, url: null }]);
    } catch { setError("Something went wrong. Please try again."); }
    finally { setBusy(false); }
  };

  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center px-6 py-12">
      <p className="text-xs uppercase tracking-[0.14em] text-fg-tertiary">{practice?.name ?? "Barbara Fraser & Associates"}</p>
      <h1 className="mt-2 font-display text-3xl">Download your document</h1>
      <p className="mt-2 text-sm text-fg-secondary">Enter the code you were given. Codes are 8 characters and expire.</p>
      <form className="mt-6 flex gap-2" onSubmit={(e) => { e.preventDefault(); setLinks(null); setError(null); setCode(typed.trim().toUpperCase()); }}>
        <Input value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8))} placeholder="ABCD2345" className="num h-11 text-lg tracking-[0.2em]" autoFocus={!initialCode} aria-label="Download code" />
        <Button type="submit" size="lg">Find</Button>
      </form>
      {code.length >= 6 && lookup === undefined && <p className="mt-4 text-sm text-fg-tertiary">Checking…</p>}
      {lookup && lookup.state !== "ok" && <p className="mt-4 rounded-xl bg-error-soft px-4 py-3 text-sm">{lookup.state === "expired" ? "This code has expired. Please contact the practice for a new one." : lookup.state === "revoked" ? "This code is no longer active." : lookup.state === "limit" ? "This code has reached its download limit." : "That code wasn’t recognised. Check it and try again."}</p>}
      {lookup && lookup.state === "ok" && (
        <div className="mt-6 rounded-2xl bg-card p-5 ring-1 ring-black/[0.06] dark:ring-white/10">
          {lookup.recipientName && <p className="text-sm">For <b>{lookup.recipientName}</b></p>}
          {lookup.note && <p className="mt-1 text-sm text-fg-secondary">{lookup.note}</p>}
          <ul className="mt-3 divide-y divide-border/70">{lookup.files.map((f) => <li key={f._id} className="flex items-center justify-between gap-3 py-2 text-sm"><span className="min-w-0 truncate">{f.name}</span><span className="shrink-0 text-xs text-fg-tertiary">{bytes(f.size)}</span></li>)}</ul>
          {lookup.needsPin && !links && <div className="mt-3"><label className="text-xs text-fg-tertiary" htmlFor="pin"><Lock className="mr-1 inline size-3" />This code needs the PIN you were sent separately</label><Input id="pin" inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))} className="num mt-1 h-11 text-lg tracking-[0.2em]" placeholder="PIN" /></div>}
          {error && <p className="mt-3 text-sm text-error">{error}</p>}
          {links ? (
            <div className="mt-4 space-y-2">
              <p className="text-sm text-success">Ready.</p>
              {links.map((l) => l.url ? <Button key={l._id} className="w-full" render={<a href={l.url} download={l.name} />}><Download className="size-4" />{l.name}</Button> : <p key={l._id} className="text-sm text-fg-secondary">{l.name} has been downloaded.</p>)}
              <p className="text-xs text-fg-tertiary">Links are valid for a short time. Reload and enter the code again if one stops working.</p>
            </div>
          ) : (
            <Button className="mt-4 w-full" size="lg" disabled={busy || (lookup.needsPin && pin.length < 4)} onClick={() => void redeem()}><Download className="size-4" />{busy ? "Preparing…" : lookup.files.length > 1 ? "Get download links" : "Download"}</Button>
          )}
        </div>
      )}
      <p className="mt-8 text-xs text-fg-quaternary">Downloads are logged with the time and network address for the practice’s records.</p>
    </main>
  );
}
