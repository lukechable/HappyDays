import { expect, test, vi } from "vitest";
import { gmailRead, promoteGmailRead } from "../src/lib/gmail-budget";
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
test("completed folder reads do not impose a second timed quota wait", async () => {
  vi.useFakeTimers();
  try {
    const called = vi.fn(async () => "mail");
    for (let i = 0; i < 6; i++) expect(await gmailRead(called)).toBe("mail");
    expect(called).toHaveBeenCalledTimes(6);
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
test("switching folders cancels queued obsolete reads and bounds active work", async () => {
  const a = deferred(), b = deferred();
  const first = gmailRead(() => a.promise), second = gmailRead(() => b.promise);
  const obsolete = vi.fn(async () => "wrong folder");
  const controller = new AbortController();
  const cancelled = gmailRead(obsolete, { signal: controller.signal });
  const assertion = expect(cancelled).rejects.toThrow("Cancelled");
  controller.abort(); await assertion;
  const current = vi.fn(async () => "current folder");
  const latest = gmailRead(current);
  await Promise.resolve();
  expect(current).not.toHaveBeenCalled();
  a.resolve(); await first;
  expect(await latest).toBe("current folder");
  b.resolve(); await second;
  expect(obsolete).not.toHaveBeenCalled();
});
test("clicking a queued background folder promotes it ahead of other preloads", async () => {
  const running = deferred();
  const first = gmailRead(() => running.promise, { background: true });
  const order: string[] = [];
  const later = gmailRead(async () => { order.push("later"); }, { background: true, key: "later" });
  const clicked = gmailRead(async () => { order.push("clicked"); }, { background: true, key: "clicked" });
  promoteGmailRead("clicked");
  await clicked;
  expect(order).toEqual(["clicked"]);
  running.resolve();
  await Promise.all([first, later]);
  expect(order).toEqual(["clicked", "later"]);
});
