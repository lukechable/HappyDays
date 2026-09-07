"use client";

import { useCallback, useEffect, useState } from "react";
import { useAction } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { errorMessage } from "@/lib/utils";

/** The current time, refreshed on an interval, so render stays pure. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), intervalMs); return () => clearInterval(t); }, [intervalMs]);
  return now;
}

/**
 * Run a Convex action whenever its arguments change and expose the result like a query would.
 * Gmail, Cliniko and Stripe are read through actions (live, nothing stored), so most screens use this.
 */
export function useLive<A extends FunctionReference<"action">>(ref: A, args: FunctionArgs<A> | "skip") {
  const run = useAction(ref);
  const key = args === "skip" ? "skip" : JSON.stringify(args);
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<{ key: string; tick: number; data?: FunctionReturnType<A>; error?: string }>({ key: "", tick: -1 });
  useEffect(() => {
    if (key === "skip") return;
    let live = true;
    run(JSON.parse(key) as FunctionArgs<A>).then((data) => { if (live) setState({ key, tick, data }); }).catch((e: unknown) => { if (live) setState({ key, tick, error: errorMessage(e) }); });
    return () => { live = false; };
  }, [key, tick, run]);
  const fresh = state.key === key && state.tick === tick;
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data: fresh ? state.data : state.key === key ? state.data : undefined, error: fresh ? state.error : undefined, loading: key !== "skip" && !fresh, skipped: key === "skip", reload };
}
