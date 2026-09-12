/**
 * Limit concurrent browser reads and discard queued reads for folders already left.
 * The server owns the shared Gmail quota across tabs and sync workers. A second
 * per-tab token bucket delayed even empty/cached provider reads by up to ten seconds.
 */
const MAX_ACTIVE = 2;
let active = 0;
const waiting: Array<{ background: boolean; key?: string; go: () => void }> = [];
/** A click takes precedence over folders being prepared in the background. */
export function promoteGmailRead(key: string) {
  const entry = waiting.find(w => w.key === key);
  if (entry) { entry.background = false; pump(); }
}
function pump() {
  while (active < MAX_ACTIVE) {
    const index = waiting.findIndex(w => !w.background);
    // Background work leaves a slot free for a user opening a folder or message.
    const next = index >= 0 ? index : active === 0 && waiting.length ? 0 : -1;
    if (next < 0) return;
    const [entry] = waiting.splice(next, 1);
    active++;
    entry.go();
  }
}
export function gmailRead<T>(fn: () => Promise<T>, opts: { background?: boolean; signal?: AbortSignal; key?: string } = {}): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (opts.signal?.aborted) { reject(new DOMException("Cancelled", "AbortError")); return; }
    const cancel = () => {
      const index = waiting.indexOf(entry);
      if (index >= 0) waiting.splice(index, 1);
      reject(new DOMException("Cancelled", "AbortError"));
      pump();
    };
    const entry = { background: !!opts.background, key: opts.key, go: () => {
      opts.signal?.removeEventListener("abort", cancel);
      void Promise.resolve().then(fn).then(resolve, reject).finally(() => { active--; pump(); });
    } };
    opts.signal?.addEventListener("abort", cancel, { once: true });
    waiting.push(entry); pump();
  });
}
