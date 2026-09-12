/**
 * Current Gmail defaults allow 6,000 units per minute (a thread read costs 40, a list page about 810). Every Gmail
 * read the browser starts goes through this bucket, so the shell prefetch, the dashboard, the folder list and the
 * warm-ups queue up behind one another instead of colliding in the same second and being refused. Reads the user
 * is waiting on go first; warm-ups only run when there is budget to spare.
 */
const PER_SECOND = 80;
const CAPACITY = 1000;
const RESERVE = 80; // background reads leave room for a click
let tokens = CAPACITY;
let refilledAt = Date.now();
const waiting: Array<{ cost: number; background: boolean; go: () => void }> = [];
let timer: ReturnType<typeof setTimeout> | undefined;

function refill() { const now = Date.now(); tokens = Math.min(CAPACITY, tokens + ((now - refilledAt) / 1000) * PER_SECOND); refilledAt = now; }
function pump() {
  refill();
  const fgPending = waiting.some((w) => !w.background);
  const next = waiting.find((w) => !w.background) ?? (fgPending ? undefined : waiting[0]);
  if (!next) return;
  const need = next.cost + (next.background ? RESERVE : 0);
  if (tokens >= Math.min(need, CAPACITY)) { waiting.splice(waiting.indexOf(next), 1); tokens -= next.cost; next.go(); pump(); return; }
  if (!timer) timer = setTimeout(() => { timer = undefined; pump(); }, Math.ceil(((need - tokens) / PER_SECOND) * 1000) + 20);
}

/** Run a Gmail-backed call once the per-second budget allows. `background` reads (warm-ups) yield to everything else. */
export function gmailRead<T>(cost: number, fn: () => Promise<T>, opts: { background?: boolean; signal?: AbortSignal } = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (opts.signal?.aborted) { reject(new DOMException("Cancelled", "AbortError")); return; }
    const cancel = () => { const i = waiting.indexOf(entry); if (i >= 0) waiting.splice(i, 1); reject(new DOMException("Cancelled", "AbortError")); };
    const entry = { cost, background: !!opts.background, go: () => { opts.signal?.removeEventListener("abort", cancel); void Promise.resolve().then(fn).then(resolve, reject); } };
    opts.signal?.addEventListener("abort", cancel, { once: true });
    waiting.push(entry); pump();
  });
}
/** Quota units per call: threads.list (10) plus a 20-thread batch (800); one thread (40). */
export const COST = { list: 810, thread: 40 } as const;
