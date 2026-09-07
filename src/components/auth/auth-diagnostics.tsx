"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAuth, useUser } from "@clerk/nextjs";
import { useAuthMode } from "@/components/auth/auth-mode";
import { Button } from "@/components/ui/button";
import { decodeJwt } from "@/lib/guest";

const EXPECTED_ISSUER = "https://workable-python-3722.clerk.accounts.dev";

/**
 * Shown when Clerk has a session but Convex reports none. It fetches the "convex" JWT and lays out the claims
 * Convex checks (issuer, audience) next to what is expected, so a template misconfiguration is obvious.
 */
export function AuthDiagnostics() {
  const mode = useAuthMode();
  if (mode !== "clerk") return <Button className="mt-4" render={<Link href="/signin" />}>Sign in</Button>;
  return <ClerkDiagnostics />;
}

function ClerkDiagnostics() {
  const { isLoaded, isSignedIn, getToken, signOut } = useAuth();
  const { user } = useUser();
  const [probe, setProbe] = useState<{ token: string | null; error?: string } | null>(null);
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let live = true;
    getToken({ template: "convex", skipCache: true }).then((t) => { if (live) setProbe({ token: t }); }).catch((e: unknown) => { if (live) setProbe({ token: null, error: e instanceof Error ? e.message : String(e) }); });
    return () => { live = false; };
  }, [isLoaded, isSignedIn, getToken]);
  if (!isLoaded) return null;
  if (!isSignedIn) return <Button className="mt-4" render={<Link href="/signin" />}>Sign in</Button>;
  const claims = probe?.token ? (decodeJwt(probe.token) as { iss?: string; aud?: string | string[]; email?: string; exp?: number } | null) : null;
  const aud = Array.isArray(claims?.aud) ? claims?.aud.join(", ") : claims?.aud;
  const rows: Array<[string, string, boolean | null]> = [
    ["Clerk session", user?.primaryEmailAddress?.emailAddress ?? "signed in", true],
    ["Token from template “convex”", probe === null ? "checking…" : probe.token ? "received" : `none${probe.error ? ` (${probe.error})` : ""}`, probe === null ? null : !!probe.token],
    ["Issuer (iss)", claims?.iss ?? "—", claims ? claims.iss === EXPECTED_ISSUER : null],
    ["Audience (aud)", aud ?? "—", claims ? aud === "convex" : null],
    ["Email claim", claims?.email ?? "—", claims ? !!claims.email : null],
  ];
  const hint = probe && !probe.token ? "Clerk has no JWT template named “convex”, or it isn’t saved. In Clerk go to Configure → JWT templates → New template → choose the Convex preset (the name must be exactly convex)."
    : claims && aud !== "convex" ? "The template exists but its audience isn’t “convex”. Open the template and either recreate it from the Convex preset or add the claim  { \"aud\": \"convex\" }."
    : claims && claims.iss !== EXPECTED_ISSUER ? `The token’s issuer doesn’t match the Convex setting (${EXPECTED_ISSUER}).`
    : claims && !claims.email ? "The token has no email claim; Convex needs it to match the allowlist. Recreate the template from the Convex preset."
    : claims ? "Claims look right. Convex may need a moment after a deploy; try Reload. If it persists, the Convex deployment’s CLERK_JWT_ISSUER_DOMAIN may differ from the issuer above." : "";
  return (
    <div className="mt-4 w-full max-w-md text-left">
      <p className="text-sm font-medium text-foreground">Signed in with Clerk, but Convex didn’t accept the session.</p>
      <dl className="mt-2 divide-y divide-border rounded-xl bg-card text-xs ring-1 ring-border">
        {rows.map(([k, v, ok]) => <div key={k} className="flex items-start gap-2 px-3 py-1.5"><dt className="w-40 shrink-0 text-fg-tertiary">{k}</dt><dd className="min-w-0 flex-1 break-all">{v}</dd><span className={ok === null ? "text-fg-quaternary" : ok ? "text-success" : "text-error"}>{ok === null ? "…" : ok ? "ok" : "check"}</span></div>)}
      </dl>
      {hint && <p className="mt-2 text-xs text-fg-secondary">{hint}</p>}
      <div className="mt-3 flex gap-2"><Button size="sm" variant="outline" onClick={() => window.location.reload()}>Reload</Button><Button size="sm" variant="ghost" onClick={() => void signOut({ redirectUrl: "/signin" })}>Sign out</Button></div>
    </div>
  );
}
