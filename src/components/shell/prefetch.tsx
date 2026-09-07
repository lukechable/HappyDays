"use client";

import { useEffect } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useLive } from "@/lib/hooks";
import { fetchLive, readLive } from "@/lib/live-cache";
import type { Me } from "@/components/shell/app-shell";

/** Warms the session cache once after sign-in so the first visit to Mail and Bookings is instant. Renders nothing. */
export function Prefetch({ me }: { me: Me }) {
  const setup = useQuery(api.settings.setupStatus);
  const connected = me.google?.status === "connected";
  useLive(api.mail.labels, connected ? {} : "skip", { ttlMs: 300_000 });
  useLive(api.bookings.practice, setup?.cliniko ? {} : "skip", { ttlMs: 600_000 });
  const listThreads = useAction(api.mail.listThreads);
  useEffect(() => {
    if (!connected) return;
    const key = `mail:list:${JSON.stringify({ view: "inbox", labelId: undefined, q: undefined, connected: true })}`;
    if (readLive(key).fetchedAt) return;
    const t = setTimeout(() => { void fetchLive(key, async () => { const r = await listThreads({ view: "inbox" }); return { items: r.items, nextToken: r.nextPageToken, missing: r.missing ?? 0 }; }); }, 1500);
    return () => clearTimeout(t);
  }, [connected, listThreads]);
  return null;
}
