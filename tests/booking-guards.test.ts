import { afterEach, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
vi.mock("../convex/lib/cliniko", async importOriginal => ({ ...await importOriginal<typeof import("../convex/lib/cliniko")>(), availableTimes: vi.fn(async () => []), listUsers: vi.fn(async () => [{ id: "1", first_name: "Active", last_name: "Staff", email: "active@example.test", active: true }, { id: "2", first_name: "Inactive", last_name: "Staff", email: "inactive@example.test", active: false }]), me: vi.fn(async () => ({ first_name: "Active", last_name: "Staff" })) }));
const modules = import.meta.glob("../convex/**/*.ts");
afterEach(() => vi.unstubAllEnvs());
async function setup() {
  const t = convexTest(schema, modules);
  vi.stubEnv("APP_URL", "https://practice.example.test");
  await t.mutation(internal.settings.setInternal, { key: "cliniko.refCache", value: { businesses: [{ id: "1", show_in_online_bookings: true }], practitioners: [{ id: "2", active: true, show_in_online_bookings: true }], types: [{ id: "3", duration_in_minutes: 60 }], at: Date.now() } });
  return t;
}
test("online booking uses only the configured Cliniko booking page", async () => {
  const t = await setup();
  vi.stubEnv("CLINIKO_SUBDOMAIN", "example-practice");
  vi.stubEnv("CLINIKO_SHARD", "au1");
  expect(await t.query(api.bookings.publicBookingLink, {})).toEqual({ url: "https://example-practice.au1.cliniko.com/bookings" });
});

test("inactive Cliniko users are excluded from the settings response", async () => {
  const t = await setup();
  await t.run(ctx => ctx.db.insert("users", { clerkId: "staff", email: "luke@barbarafraser.net", name: "Luke", lastSeenAt: 0 }));
  const result = await t.withIdentity({ subject: "staff" }).action(api.bookings.clinikoUsers, {});
  expect(result.users.map(u => u.id)).toEqual(["1"]);
});
