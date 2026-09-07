"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useAction } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import { errorMessage } from "@/lib/utils";

type Window = { fromIso: string; toIso: string };
type Data = FunctionReturnType<typeof api.bookings.calendar>;
type Slot = { data?: Data; fetchedAt?: number; error?: string; phase: "idle" | "loading" | "checking" };

/**
 * Weeks already fetched this session, kept in memory for the tab. A week you have seen shows instantly; Cliniko is
 * then asked only whether any appointment in it changed since the fetch, and a full reload happens only if so.
 */
const store = new Map<string, Slot>();
const listeners = new Set<() => void>();
const EMPTY: Slot = { phase: "idle" };
const RECHECK_AFTER_MS = 30_000;
const get = (key: string) => store.get(key) ?? EMPTY;
const set = (key: string, patch: Partial<Slot>) => { store.set(key, { ...get(key), ...patch }); listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export function useCalendarWindow(win: Window | null) {
  const calendar = useAction(api.bookings.calendar);
  const changedSince = useAction(api.bookings.changedSince);
  const key = win ? `${win.fromIso}|${win.toIso}` : "";
  const slot = useSyncExternalStore(subscribe, () => get(key), () => EMPTY);

  const fetchFull = useCallback(async (k: string, w: Window) => {
    set(k, { phase: get(k).data ? "checking" : "loading", error: undefined });
    try { const data = await calendar(w); set(k, { data, fetchedAt: Date.now(), phase: "idle" }); }
    catch (e) { set(k, { error: errorMessage(e), phase: "idle" }); }
  }, [calendar]);

  useEffect(() => {
    if (!win) return;
    const cur = get(key);
    if (cur.phase !== "idle") return;
    if (!cur.data || !cur.fetchedAt) { void fetchFull(key, win); return; }
    if (Date.now() - cur.fetchedAt <= RECHECK_AFTER_MS) return;
    const since = new Date(cur.fetchedAt - 60_000).toISOString();
    const k = key; const w = win; const at = cur.fetchedAt;
    set(k, { phase: "checking" });
    changedSince({ fromIso: w.fromIso, toIso: w.toIso, sinceIso: since })
      .then((r) => { if (get(k).fetchedAt !== at) return; if (r.changed > 0) void fetchFull(k, w); else set(k, { fetchedAt: Date.now(), phase: "idle" }); })
      .catch(() => { void fetchFull(k, w); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return {
    data: slot.data,
    fetchedAt: slot.fetchedAt,
    error: slot.error,
    loading: !!win && slot.phase === "loading",
    checking: slot.phase === "checking",
    reload: () => { if (win) { store.delete(key); listeners.forEach((l) => l()); void fetchFull(key, win); } },
  };
}
