"use client";

import { ReactNode, useCallback, useEffect, useState } from "react";
import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useAuth } from "@clerk/nextjs";
import { ConvexQueryCacheProvider } from "convex-helpers/react/cache/provider";

/** Keeps a page's query subscriptions alive for five minutes after it unmounts, so coming back to it renders from the client cache with no round trip. */
const CACHE = { expiration: 300_000, maxIdleEntries: 150 };

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

/** Pending Clerk sessions (e.g. an org-selection task we don't use) still count as signed in. */
const useAuthForConvex = () => useAuth({ treatPendingAsSignedOut: false });

/** Convex client that forwards Clerk's "convex" JWT template to the backend. */
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return <ConvexProviderWithClerk client={convex} useAuth={useAuthForConvex}><ConvexQueryCacheProvider {...CACHE}>{children}</ConvexQueryCacheProvider></ConvexProviderWithClerk>;
}

/** Guest sessions: the token comes from the httpOnly cookie via /api/guest/token and is handed to Convex. */
const guestClient = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

function useGuestAuth() {
  const [state, setState] = useState<{ loading: boolean; token: string | null }>({ loading: true, token: null });
  useEffect(() => {
    let live = true;
    fetch("/api/guest/token", { cache: "no-store" }).then(async (r) => { const j = r.ok ? ((await r.json()) as { token: string | null }) : { token: null }; if (live) setState({ loading: false, token: j.token }); }).catch(() => { if (live) setState({ loading: false, token: null }); });
    return () => { live = false; };
  }, []);
  const fetchAccessToken = useCallback(async () => { const r = await fetch("/api/guest/token", { cache: "no-store" }); if (!r.ok) return null; return ((await r.json()) as { token: string | null }).token; }, []);
  return { isLoading: state.loading, isAuthenticated: !!state.token, fetchAccessToken };
}

export function GuestConvexProvider({ children }: { children: ReactNode }) {
  return <ConvexProviderWithAuth client={guestClient} useAuth={useGuestAuth}><ConvexQueryCacheProvider {...CACHE}>{children}</ConvexQueryCacheProvider></ConvexProviderWithAuth>;
}
