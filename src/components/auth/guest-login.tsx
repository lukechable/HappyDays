"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Password-only guest access for testing. Appears only while GUEST_PASSWORD is set on the Convex deployment. */
export function GuestLogin() {
  const practice = useQuery(api.settings.publicPractice);
  const params = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!practice?.guestEnabled) return null;
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/guest/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) { setError(j.error ?? "Sign-in failed"); return; }
      const to = params.get("redirect_url") ?? "/";
      window.location.assign(/^\/(?![\/\\])/.test(to) ? to : "/");
    } catch { setError("Sign-in failed. Try again."); }
    finally { setBusy(false); }
  };
  return (
    <form className="w-full max-w-xs rounded-2xl bg-card p-5 ring-1 ring-black/[0.06] dark:ring-white/10" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <p className="text-sm font-medium">Guest tester</p>
      <p className="mt-0.5 text-xs text-fg-tertiary">Full access as “Guest Tester”, no Google account. For trying the app before Clerk is set up.</p>
      <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Guest password" className="mt-3" autoComplete="current-password" />
      {error && <p className="mt-2 text-xs text-error">{error}</p>}
      <Button type="submit" className="mt-3 w-full" disabled={busy || !password}>{busy ? "Signing in…" : "Enter as guest"}</Button>
    </form>
  );
}
