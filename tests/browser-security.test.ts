// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import "fake-indexeddb/auto";
import { sanitiseEmailHtml, textToHtml } from "../src/lib/sanitise";
import { mailStore, scopedMailStore } from "../src/lib/mail-store";
import { dropLive, fetchLive, readLive } from "../src/lib/live-cache";
import { exportCsv } from "../src/lib/export";
afterEach(() => { vi.restoreAllMocks(); dropLive(""); });

test("plain-text links cannot inject attributes", () => {
  const doc = new DOMParser().parseFromString(textToHtml('https://example.test/"onclick="alert(1)'), "text/html");
  expect(doc.querySelector("a")?.hasAttribute("onclick")).toBe(false);
});
test("remote CSS trackers stay blocked even alongside fixed positioning", () => {
  const result = sanitiseEmailHtml('<div style="background-image:url(https://tracker.test/pixel);position:fixed;cursor:url(https://tracker.test/cursor),auto">Message</div>', { showImages: false, cidMap: {} });
  expect(result.html).not.toContain("tracker.test");
  expect(result.html).toContain("position: static");
  expect(result.blockedImages).toBeGreaterThan(0);
});
test("local mail search and message bodies are isolated by account", async () => {
  await mailStore.clear();
  const a = scopedMailStore("account-a"), b = scopedMailStore("account-b");
  await a.putThread("shared-thread-id", { private: "A" }, "confidential report");
  expect(await b.getThread("shared-thread-id")).toBeUndefined();
  expect(await b.search("confidential")).toEqual([]);
  expect((await a.search("confidential"))[0].id).toBe("shared-thread-id");
  await b.putThread("shared-thread-id", { private: "B" }, "different report");
  expect((await a.getThread<{ private: string }>("shared-thread-id"))?.data.private).toBe("A");
  await mailStore.clear();
  expect(await a.getThread("shared-thread-id")).toBeUndefined();
});
test("a request finishing after sign-out cannot repopulate the session cache", async () => {
  let finish!: (value: string) => void;
  const request = fetchLive("test:private", () => new Promise<string>(resolve => { finish = resolve; }));
  dropLive(""); finish("private"); await request;
  expect(readLive("test:private").data).toBeUndefined();
});
test("CSV exports neutralize spreadsheet formula injection", () => {
  const blobs: Blob[] = [];
  vi.stubGlobal("Blob", class { constructor(parts: string[]) { blobs.push(parts as unknown as Blob); } });
  vi.stubGlobal("URL", { createObjectURL: () => "blob:test", revokeObjectURL: () => {} });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  exportCsv({ title: "Test", filename: "test", columns: [{ key: "name", label: "Name" }], rows: [{ name: '=HYPERLINK("https://attacker.test")' }] });
  expect(String(blobs[0])).toContain("'=HYPERLINK");
  vi.unstubAllGlobals();
});
