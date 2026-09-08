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
export function gmailRead<T>(cost: number, fn: () => Promise<T>, opts: { background?: boolean } = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => { waiting.push({ cost, background: !!opts.background, go: () => fn().then(resolve, reject) }); pump(); });
}
/** Quota units per call: threads.list (10) plus a 20-thread batch (200); one thread (10). */
export const COST = { list: 210, thread: 10 } as const;
