import { afterEach, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
vi.mock("../convex/lib/cliniko", () => ({ availableTimes: vi.fn(async () => []) }));
const modules = import.meta.glob("../convex/**/*.ts");
afterEach(() => vi.unstubAllEnvs());
async function setup() {
  const t = convexTest(schema, modules);
  vi.stubEnv("APP_URL", "https://practice.example.test");
  await t.mutation(internal.settings.setInternal, { key: "cliniko.refCache", value: { businesses: [{ id: "1", show_in_online_bookings: true }], practitioners: [{ id: "2", active: true, show_in_online_bookings: true }], types: [{ id: "3", duration_in_minutes: 60 }], at: Date.now() } });
  await t.run(ctx => ctx.db.insert("appointmentPricing", { clinikoAppointmentTypeId: "3", name: "Consultation", durationMinutes: 60, mode: "full", feeCents: 20000, bookableOnline: true, updatedAt: 0 }));
  return t;
}
test("public availability rejects private selections and unbounded date ranges", async () => {
  const t = await setup();
  const from = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await expect(t.action(api.bookings.publicAvailability, { businessId: "private", practitionerId: "2", appointmentTypeId: "3", from, to: from })).rejects.toThrow("valid appointment");
  await expect(t.action(api.bookings.publicAvailability, { businessId: "1", practitionerId: "2", appointmentTypeId: "3", from, to: "2035-01-01" })).rejects.toThrow("date range");
});
test("checkout rejects arbitrary redirect origins and unavailable appointments before creating a session", async () => {
  const t = await setup();
  const args = { businessId: "1", practitionerId: "2", appointmentTypeId: "3", startsAt: new Date(Date.now() + 86_400_000).toISOString(), patient: { firstName: "Test", lastName: "Patient", email: "test@example.test" }, origin: "https://attacker.example.test" };
  await expect(t.action(api.bookings.startPublicBooking, args)).rejects.toThrow("practice website");
  await expect(t.action(api.bookings.startPublicBooking, { ...args, origin: "https://practice.example.test" })).rejects.toThrow("no longer available");
  expect(await t.run(ctx => ctx.db.query("bookingSessions").collect())).toEqual([]);
});
