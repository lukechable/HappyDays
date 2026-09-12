"use client";

import { gmailRead } from "./gmail-budget";

/**
 * Session cache for live reads (Gmail, Cliniko, Stripe via Convex actions). Lives in memory for the tab, never on
 * our servers. A key that has been seen renders instantly and refreshes in the background when older than its TTL.
 */
export type Slot<T> = { data?: T; fetchedAt?: number; error?: string; inflight?: Promise<void> };
const store = new Map<string, Slot<unknown>>();
const listeners = new Set<() => void>();
const MAX = 200;
export const EMPTY_SLOT: Slot<never> = {};

export const subscribeLive = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const readLive = <T,>(key: string): Slot<T> => (store.get(key) as Slot<T> | undefined) ?? (EMPTY_SLOT as Slot<T>);
export function writeLive<T>(key: string, patch: Partial<Slot<T>>) {
  const cur = store.get(key) ?? {};
  store.delete(key); store.set(key, { ...cur, ...patch });
  while (store.size > MAX) { const oldest = store.keys().next().value; if (oldest === undefined) break; store.delete(oldest); }
  listeners.forEach((l) => l());
}
export const dropLive = (prefix: string) => { for (const k of Array.from(store.keys())) if (k.startsWith(prefix)) store.delete(k); listeners.forEach((l) => l()); };

/** Run `fn` for `key` unless one is already in flight; results land in the store. */
export function fetchLive<T>(key: string, fn: () => Promise<T>): Promise<void> {
  const cur = store.get(key) as Slot<T> | undefined;
  if (cur?.inflight) return cur.inflight;
  // Gmail action reads share the browser concurrency queue; quota is enforced by the server.
  const run = key.startsWith("mail:listThreads|") ? () => gmailRead(fn) : fn;
  const p: Promise<void> = run().then((data) => store.get(key)?.inflight === p && writeLive<T>(key, { data, fetchedAt: Date.now(), error: undefined, inflight: undefined })).catch((e: unknown) => store.get(key)?.inflight === p && writeLive<T>(key, { error: e instanceof Error ? e.message : String(e), inflight: undefined })).then(() => undefined);
  writeLive<T>(key, { inflight: p, error: undefined });
  return p;
}
