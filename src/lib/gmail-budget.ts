/**
 * Gmail allows each user 250 quota units per second (a thread read costs 10, a list page about 210). Every Gmail
 * read the browser starts goes through this bucket, so the shell prefetch, the dashboard, the folder list and the
 * warm-ups queue up behind one another instead of colliding in the same second and being refused. Reads the user
 * is waiting on go first; warm-ups only run when there is budget to spare.
 */
const PER_SECOND = 250;
const RESERVE = 110; // background reads leave room for a click
let tokens = PER_SECOND;
let refilledAt = Date.now();
const waiting: Array<{ cost: number; background: boolean; go: () => void }> = [];
let timer: ReturnType<typeof setTimeout> | undefined;

function refill() { const now = Date.now(); tokens = Math.min(PER_SECOND, tokens + ((now - refilledAt) / 1000) * PER_SECOND); refilledAt = now; }
function pump() {
  refill();
  const fgPending = waiting.some((w) => !w.background);
  const next = waiting.find((w) => !w.background) ?? (fgPending ? undefined : waiting[0]);
  if (!next) return;
  const need = next.cost + (next.background ? RESERVE : 0);
  if (tokens >= Math.min(need, PER_SECOND)) { waiting.splice(waiting.indexOf(next), 1); tokens -= next.cost; next.go(); pump(); return; }
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
/** Quota units per call: threads.list (10) plus a 20-thread batch (200); one thread (10). */
export const COST = { list: 210, thread: 10 } as const;
