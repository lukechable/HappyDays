"use client";

import { ReactNode, useEffect, useState } from "react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useAuth } from "@clerk/nextjs";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

/** Pending Clerk sessions (e.g. an org-selection task we don't use) still count as signed in. */
const useAuthForConvex = () => useAuth({ treatPendingAsSignedOut: false });

/** Convex client that forwards Clerk's "convex" JWT template to the backend. */
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return <ConvexProviderWithClerk client={convex} useAuth={useAuthForConvex}>{children}</ConvexProviderWithClerk>;
}

/** Guest sessions: the token comes from the httpOnly cookie via /api/guest/token and is handed to Convex. */
export function GuestConvexProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!));
  useEffect(() => {
    client.setAuth(async () => { const r = await fetch("/api/guest/token", { cache: "no-store" }); if (!r.ok) return null; const j = (await r.json()) as { token: string | null }; return j.token; });
    return () => client.clearAuth();
  }, [client]);
  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}
