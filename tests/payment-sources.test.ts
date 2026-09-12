import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
const modules = import.meta.glob("../convex/**/*.ts");
const ref = (kind: string, id: string) => ({ links: { self: `https://api.au1.cliniko.com/v1/${kind}/${id}` } });
beforeEach(() => { vi.stubEnv("BASIQ_API_KEY", "fake"); vi.stubEnv("CLINIKO_API_KEY", "fake"); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function setup() {
  const t = convexTest(schema, modules);
  await t.run(ctx => ctx.db.insert("users", { clerkId: "staff", email: "luke@barbarafraser.net", name: "Luke", lastSeenAt: 0 }));
  await t.run(ctx => ctx.db.insert("settings", { key: "bank.basiqUserId", value: "bank-user", updatedAt: 0 }));
  return t.withIdentity({ subject: "staff" });
}
test("bank reads all pages across accounts and does not treat unknown status as posted", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const u = new URL(input);
    const j = u.pathname === "/token" ? { access_token: "fake" } : u.pathname.endsWith("/accounts") ? { data: [{ id: "a1", name: "Practice" }, { id: "a2", name: "Other" }] } : u.searchParams.has("next") ? { data: [{ id: "t2", account: "a2", direction: "credit", amount: "250.0", postDate: "2026-09-13" }] } : { data: [{ id: "t1", account: "a1", direction: "credit", amount: "100", status: "posted", postDate: "2026-09-12" }], links: { next: "https://au-api.basiq.io/users/bank-user/transactions?next=2" } };
    return new Response(JSON.stringify(j));
  }));
  const staff = await setup(); const result = await staff.action(api.bank.transactions, {});
  expect(result.complete).toBe(true); expect(result.rows).toHaveLength(2);
  expect(result.rows[0]).toMatchObject({ id: "t2", amountCents: 25000, status: "unknown", accountName: "Other" });
});
test("bank pagination never sends credentials to an unexpected origin", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: string) => new Response(JSON.stringify(input.endsWith("/token") ? { access_token: "fake" } : input.endsWith("/accounts") ? { data: [] } : { data: [], links: { next: "https://example.com/steal" } }))));
  const staff = await setup(); await expect(staff.action(api.bank.transactions, {})).rejects.toThrow("Unexpected bank pagination");
  expect(vi.mocked(fetch).mock.calls.every(([url]) => String(url).startsWith("https://au-api.basiq.io/"))).toBe(true);
});
test("invoice names and booking dates resolve beyond 60 patients; paid and closed statuses are distinct", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const u = new URL(input);
    let j: unknown;
    if (u.pathname === "/v1/invoices") j = { invoices: Array.from({ length: 61 }, (_, n) => ({ id: String(n), number: n, status: n === 0 ? 20 : n === 1 ? 30 : 10, total_amount: "250", issue_date: "2026-09-12", patient: ref("patients", String(n)), booking: ref("bookings", String(n)) })) };
    else {
      const ids = u.searchParams.getAll("q[]").find(q => q.startsWith("id:="))!.slice(4).split(",");
      j = u.pathname === "/v1/patients" ? { patients: ids.map(id => ({ id, first_name: "Alice", preferred_first_name: "Ali", last_name: `Patient${id}` })) } : { bookings: ids.map(id => ({ id, starts_at: "2025-01-02T00:00:00Z" })) };
    }
    return new Response(JSON.stringify(j));
  }));
  const staff = await setup(); const result = await staff.action(api.bookings.clinikoInvoices, { days: 90 });
  expect(result).toHaveLength(61);
  expect(result[60]).toMatchObject({ patientName: "Ali Patient60", patientNames: ["Alice Patient60", "Ali Patient60"], appointmentAt: "2025-01-02T00:00:00Z", openAmount: 250 });
  expect(result[0]).toMatchObject({ statusCode: 20, openAmount: 0 }); expect(result[1]).toMatchObject({ statusCode: 30, openAmount: 0 });
});
