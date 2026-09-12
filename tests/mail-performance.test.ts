import { afterEach, expect, test, vi } from "vitest";
import { batchGetThreads } from "../convex/lib/gmail";
import { matchEft } from "../src/lib/eft-matching";
import { contentDisposition } from "../src/lib/download-headers";
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

test("an exhausted partial Gmail batch cannot silently skip mail", async () => {
  vi.useFakeTimers();
  let calls = 0;
  vi.stubGlobal("fetch", vi.fn(async () => {
    const parts = calls++ === 0
      ? 'Content-ID: <response-t0>\r\n\r\n{"id":"a"}\r\n--reply\r\nContent-ID: <response-t1>\r\n\r\n{"error":{"code":429}}'
      : 'Content-ID: <response-t0>\r\n\r\n{"error":{"code":429}}';
    return new Response(`--reply\r\n${parts}\r\n--reply--`, { headers: { "Content-Type": "multipart/mixed; boundary=reply" } });
  }));
  const assertion = expect(batchGetThreads("test-token", ["a", "b"])).rejects.toThrow("rate-limiting");
  await vi.runAllTimersAsync(); await assertion;
  expect(calls).toBe(5);
});

test("EFT date parsing grows with transactions plus invoices, not their product", () => {
  const spy = vi.spyOn(Intl.DateTimeFormat.prototype, "formatToParts");
  const invoices = Array.from({ length: 200 }, (_, n) => ({ id: `i${n}`, number: n, patientName: "Test Patient", total: 200, openAmount: 200, appointmentAt: "2026-09-01T00:00:00Z" }));
  const transactions = Array.from({ length: 1000 }, (_, n) => ({ id: `t${n}`, description: "Other person", amountCents: 10000, direction: "credit" as const, status: "posted", postDate: "2026-09-01", accountId: "test" }));
  matchEft(invoices, transactions);
  expect(spy).toHaveBeenCalledTimes(1200);
});

test("Unicode filenames and line breaks produce valid, injection-safe download headers", () => {
  const value = contentDisposition('Patient José 📝\r\nReport.pdf');
  expect(() => new Headers({ "Content-Disposition": value })).not.toThrow();
  expect(value).not.toMatch(/[\r\n]/);
  expect(value).toContain("Jos%C3%A9");
});

test("Cliniko pagination cannot send credentials to another origin", async () => {
  const { listBusinesses } = await import("../convex/lib/cliniko");
  vi.stubEnv("CLINIKO_API_KEY", "fake-test-key");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ businesses: [{ id: "1" }], links: { next: "https://attacker.example.test/collect" } }))));
  try {
    await expect(listBusinesses()).rejects.toThrow("Invalid Cliniko API link");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][1]?.redirect).toBe("error");
  } finally { vi.unstubAllEnvs(); }
});

test.each([500, 503, 403])("Gmail part failure %s is an error, never an empty mailbox", async code => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(`--reply\r\nContent-ID: <response-t0>\r\n\r\n${JSON.stringify({ error: { code, message: "Provider failure" } })}\r\n--reply--`, { headers: { "Content-Type": "multipart/mixed; boundary=reply" } })));
  await expect(batchGetThreads("test-token", ["a"])).rejects.toThrow();
});
test("missing or malformed Gmail batch parts cannot become empty results", async () => {
  for (const body of ["--reply--", "--reply\r\nContent-ID: <response-t0>\r\n\r\n{broken}\r\n--reply--"]) {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { headers: { "Content-Type": "multipart/mixed; boundary=reply" } })));
    await expect(batchGetThreads("test-token", ["a"])).rejects.toThrow();
  }
});
