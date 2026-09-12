"use client";

import { createContext, useContext, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useAction } from "convex/react";
import { getFunctionName, type FunctionArgs, type FunctionReference, type FunctionReturnType } from "convex/server";
import { fetchLive, readLive, subscribeLive, EMPTY_SLOT, writeLive } from "@/lib/live-cache";

/** The current time, refreshed on an interval, so render stays pure. */
/** True when the media query matches; false during server render and the first paint. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore((cb) => { const m = window.matchMedia(query); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); }, () => window.matchMedia(query).matches, () => false);
}

/* A tiny store over localStorage: parsed values are cached so snapshots are referentially stable, and writes notify subscribers. */
const storedCache = new Map<string, unknown>();
const STORED_EVENT = "hd-stored";
function readStored<T>(key: string, fallback: T): T {
  if (storedCache.has(key)) return storedCache.get(key) as T;
  let v: T = fallback;
  try { const raw = localStorage.getItem(key); if (raw) v = JSON.parse(raw) as T; } catch { /* private mode */ }
  storedCache.set(key, v);
  return v;
}
function writeStored(key: string, value: unknown) {
  storedCache.set(key, value);
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
  window.dispatchEvent(new Event(STORED_EVENT));
}
const subscribeStored = (cb: () => void) => { window.addEventListener(STORED_EVENT, cb); return () => window.removeEventListener(STORED_EVENT, cb); };
/** A value remembered on this device (localStorage), read with a stable snapshot so it is safe to render from. */
export function useStored<T>(key: string, fallback: T): [T, (v: T) => void] {
  const value = useSyncExternalStore(subscribeStored, () => readStored(key, fallback), () => fallback);
  return [value, (v) => writeStored(key, v)];
}

export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(t); }, [intervalMs]);
  return now;
}

export const CacheScope = createContext("anonymous");
export const useCacheScope = () => useContext(CacheScope);
const DEFAULT_TTL = 90_000;
/** Cache keys are `<function name>|<json args>`; names contain ":" so "|" is the separator. */


/**
 * Run a Convex action whenever its arguments change and expose the result like a query would, with a session
 * cache: a result seen before shows immediately and is refreshed in the background once older than `ttlMs`.
 * Gmail, Cliniko and Stripe are read through actions (live, nothing stored server-side), so most screens use this.
 */
export function useLive<A extends FunctionReference<"action">>(ref: A, args: FunctionArgs<A> | "skip", opts: { ttlMs?: number } = {}) {
  const run = useAction(ref);
  const ttl = opts.ttlMs ?? DEFAULT_TTL;
  const scope = useCacheScope();
  const argsJson = JSON.stringify(args);
  const key = args === "skip" ? "" : `${getFunctionName(ref)}|${argsJson}|scope:${scope}`;
  const slot = useSyncExternalStore(subscribeLive, () => (key ? readLive<FunctionReturnType<A>>(key) : (EMPTY_SLOT as never)), () => EMPTY_SLOT as never);
  useEffect(() => {
    if (!key) return;
    const cur = readLive<FunctionReturnType<A>>(key);
    const fresh = cur.fetchedAt !== undefined && Date.now() - cur.fetchedAt < ttl;
    if (fresh || cur.inflight) return;
    void fetchLive(key, () => run(JSON.parse(argsJson) as FunctionArgs<A>));
  }, [key, argsJson, run, ttl]);
  const reload = useCallback(() => { if (key) { writeLive(key, { fetchedAt: undefined }); void fetchLive(key, () => run(JSON.parse(argsJson) as FunctionArgs<A>)); } }, [key, argsJson, run]);
  return { data: slot.data as FunctionReturnType<A> | undefined, error: slot.error, loading: !!key && slot.data === undefined && !slot.error, refreshing: !!slot.inflight && slot.data !== undefined, skipped: !key, reload, fetchedAt: slot.fetchedAt };
}
