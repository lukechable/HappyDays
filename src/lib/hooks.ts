"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useAction } from "convex/react";
import { getFunctionName, type FunctionArgs, type FunctionReference, type FunctionReturnType } from "convex/server";
import { fetchLive, readLive, subscribeLive, EMPTY_SLOT, writeLive } from "@/lib/live-cache";

/** The current time, refreshed on an interval, so render stays pure. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(t); }, [intervalMs]);
  return now;
}

const DEFAULT_TTL = 90_000;
/** Cache keys are `<function name>|<json args>`; names contain ":" so "|" is the separator. */
const argsOf = <T,>(k: string) => JSON.parse(k.slice(k.indexOf("|") + 1)) as T;

/**
 * Run a Convex action whenever its arguments change and expose the result like a query would, with a session
 * cache: a result seen before shows immediately and is refreshed in the background once older than `ttlMs`.
 * Gmail, Cliniko and Stripe are read through actions (live, nothing stored server-side), so most screens use this.
 */
export function useLive<A extends FunctionReference<"action">>(ref: A, args: FunctionArgs<A> | "skip", opts: { ttlMs?: number } = {}) {
  const run = useAction(ref);
  const ttl = opts.ttlMs ?? DEFAULT_TTL;
  const key = args === "skip" ? "" : `${getFunctionName(ref)}|${JSON.stringify(args)}`;
  const slot = useSyncExternalStore(subscribeLive, () => (key ? readLive<FunctionReturnType<A>>(key) : (EMPTY_SLOT as never)), () => EMPTY_SLOT as never);
  useEffect(() => {
    if (!key) return;
    const cur = readLive<FunctionReturnType<A>>(key);
    const fresh = cur.fetchedAt !== undefined && Date.now() - cur.fetchedAt < ttl;
    if (fresh || cur.inflight) return;
    void fetchLive(key, () => run(argsOf<FunctionArgs<A>>(key)));
  }, [key, run, ttl]);
  const reload = useCallback(() => { if (key) { writeLive(key, { fetchedAt: undefined }); void fetchLive(key, () => run(argsOf<FunctionArgs<A>>(key))); } }, [key, run]);
  return { data: slot.data as FunctionReturnType<A> | undefined, error: slot.error, loading: !!key && slot.data === undefined && !slot.error, refreshing: !!slot.inflight && slot.data !== undefined, skipped: !key, reload, fetchedAt: slot.fetchedAt };
}
