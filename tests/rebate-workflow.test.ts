import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import type { Doc } from "../convex/_generated/dataModel";

const stripeMock = vi.hoisted(() => ({ retrieve: vi.fn() }));
vi.mock("stripe", () => ({ default: class { checkout = { sessions: { retrieve: stripeMock.retrieve } }; } }));

const modules = {
  "../convex/rebateData.ts": () => import("../convex/rebateData"),
  "../convex/rebates.ts": () => import("../convex/rebates"),
  "../convex/bookings.ts": () => import("../convex/bookings"),
  "../convex/cases.ts": () => import("../convex/cases"),
  "../convex/stripe.ts": () => import("../convex/stripe"),
  "../convex/_generated/server.ts": () => import("../convex/_generated/server"),
};
async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { clerkId: "staff", email: "luke@barbarafraser.net", name: "Luke", lastSeenAt: Date.now() }));
  return { t, staff: t.withIdentity({ subject: "staff" }), userId };
}
const link = (type: string, id: string) => ({ links: { self: `https://api.au1.cliniko.com/v1/${type}/${id}` } });
const now = Date.parse("2026-10-06T04:00:00Z");
const start = "2026-10-06T00:00:00Z";
let attended: boolean, paidStatus: number, appointmentStart: string, caseUpdated: string;
function mockCliniko() {
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    if (url.hostname === "api-au.medipass.io" && url.pathname === "/v3/auth/token") return new Response(JSON.stringify({ token: "short-lived-test-token" }));
    if (url.hostname !== "api.au1.cliniko.com") throw new Error("No live network access permitted in tests");
    expect(init?.headers).toBeDefined();
    const plan = { id: "case", name: "Referral", referral: true, referral_type: "medicare", max_sessions: 6, issue_date: "2026-09-01", updated_at: caseUpdated, patient: link("patients", "patient") };
    const appointment = { id: "appointment", starts_at: appointmentStart, ends_at: "2026-10-06T01:00:00Z", patient_arrived: attended, patient: link("patients", "patient"), practitioner: link("practitioners", "practitioner"), business: link("businesses", "business"), cancelled_at: null, did_not_arrive: false };
    const attendee = { id: "attendee", arrived: attended, booking: link("bookings", "appointment"), patient: link("patients", "patient"), patient_case: link("patient_cases", "case") };
    const data = url.pathname === "/v1/patients/patient" ? { id: "patient", first_name: "Test", last_name: "Patient", date_of_birth: "1990-01-01", medicare: "0000000000", medicare_reference_number: "1" }
      : url.pathname === "/v1/practitioner_reference_numbers" ? { practitioner_reference_numbers: [{ reference_number: "123456AB" }] }
      : url.pathname === "/v1/individual_appointments/appointment" ? appointment
      : url.pathname === "/v1/patient_cases/case" ? plan
      : url.pathname === "/v1/attendees" ? { attendees: [attendee] }
      : url.pathname === "/v1/patient_cases/case/bookings" ? { bookings: [appointment] }
      : url.pathname === "/v1/appointments/appointment/invoices" ? { invoices: [{ id: "invoice", status: paidStatus, total_amount: "240.00", patient: link("patients", "patient"), closed_at: "2026-10-06T01:00:00Z" }] }
      : null;
    if (!data) throw new Error(`Unexpected endpoint: ${url.pathname}`);
    return new Response(JSON.stringify(data), { status: 200 });
  }));
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); attended = true; paidStatus = 20; appointmentStart = start; caseUpdated = "v1"; vi.stubEnv("CLINIKO_API_KEY", "test-only"); mockCliniko(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("fixed go-live and authentication", () => {
  test("records the server time once and rejects later changes", async () => {
    const { t, staff } = await setup();
    await expect(t.mutation(api.rebateData.setGoLive, {})).rejects.toThrow();
    await staff.mutation(api.rebateData.setGoLive, {});
    expect((await staff.query(api.rebateData.config, {})).goLiveAt).toBe(now);
    await expect(staff.mutation(api.rebateData.setGoLive, {})).rejects.toThrow("fixed");
  });
  test("guest accounts cannot launch rebates", async () => {
    vi.stubEnv("GUEST_PASSWORD", "test-only");
    const { t } = await setup();
    await t.run((ctx) => ctx.db.insert("users", { clerkId: "guest", email: "guest@barbarafraser.net", name: "Guest", lastSeenAt: now }));
    await expect(t.withIdentity({ subject: "guest" }).mutation(api.rebateData.setGoLive, {})).rejects.toThrow("Guest");
  });
});

describe("live eligibility", () => {
  async function ready() {
    const x = await setup();
    await x.t.run((ctx) => ctx.db.insert("rebateLaunch", { goLiveAt: Date.parse("2026-10-01T00:00:00Z"), configuredBy: x.userId, configuredAt: now }));
    await x.staff.action(api.rebates.verifyReferral, { caseId: "case", patientId: "patient", expectedUpdatedAt: "v1" });
    return x;
  }
  test("re-reads attendance and payment, never treating a closed invoice as paid", async () => {
    const { staff } = await ready();
    const args = { appointmentId: "appointment", caseId: "case" };
    expect((await staff.action(api.rebates.check, args)).ready).toBe(true);
    attended = false;
    expect((await staff.action(api.rebates.check, args)).ready).toBe(false);
    attended = true; paidStatus = 30;
    const result = await staff.action(api.rebates.check, args);
    expect(result.paid).toBe(false);
    expect(result.ready).toBe(false);
  });
  test("late payment cannot make a pre-launch appointment eligible", async () => {
    const { staff } = await ready();
    appointmentStart = "2026-09-30T23:59:59Z";
    const result = await staff.action(api.rebates.check, { appointmentId: "appointment", caseId: "case" });
    expect(result.reasons.some((r) => r.includes("before HappyDays went live"))).toBe(true);
  });
  test("verifies full Stripe payment and blocks refunds, disputes, mismatches and deposits", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "fake-key");
    const { t, staff } = await ready();
    const bookingId = await t.run((ctx) => ctx.db.insert("bookingSessions", {
      businessId: "business", practitionerId: "practitioner", appointmentTypeId: "type",
      startsAt: start, endsAt: "2026-10-06T01:00:00Z", patient: { firstName: "Test", lastName: "Patient", email: "test@example.invalid" },
      amountCents: 24000, mode: "full", status: "booked", clinikoPatientId: "patient", clinikoAppointmentId: "appointment",
      stripeCheckoutSessionId: "checkout", createdAt: now, expiresAt: now,
    }));
    const charge = { paid: true, captured: true, refunded: false, amount_refunded: 0, disputed: false };
    const payment = { status: "succeeded", amount_received: 24000, latest_charge: charge };
    const session = { metadata: { bookingSessionId: bookingId as string }, payment_status: "paid", currency: "aud", amount_total: 24000, payment_intent: payment };
    stripeMock.retrieve.mockResolvedValue(session);
    const check = () => staff.action(api.rebates.check, { appointmentId: "appointment", caseId: "case" });
    expect((await check()).paid).toBe(true);
    charge.amount_refunded = 1;
    expect((await check()).paid).toBe(false);
    charge.amount_refunded = 0; charge.disputed = true;
    expect((await check()).paid).toBe(false);
    charge.disputed = false; session.metadata.bookingSessionId = "other-booking";
    expect((await check()).paid).toBe(false);
    session.metadata.bookingSessionId = bookingId; payment.amount_received = 10000;
    expect((await check()).paid).toBe(false);
    payment.amount_received = 24000; paidStatus = 10;
    expect((await check()).paid).toBe(true);
    await t.run((ctx) => ctx.db.patch(bookingId, { mode: "deposit" }));
    expect((await check()).paid).toBe(false);
  });
  test("case edits invalidate staff verification", async () => {
    const { staff } = await ready(); caseUpdated = "v2";
    expect((await staff.action(api.rebates.check, { appointmentId: "appointment", caseId: "case" })).reviewed).toBe(false);
  });
  test("submission rechecks changed attendance and never creates a token for ineligible sessions", async () => {
    vi.stubEnv("TYRO_ENV", "prod"); vi.stubEnv("TYRO_API_KEY", "fake-key"); vi.stubEnv("TYRO_APP_ID", "fake-app"); vi.stubEnv("TYRO_BUSINESS_ID", "fake-business");
    const { staff, t } = await ready();
    const args = { appointmentId: "appointment", caseId: "case", providerNumber: "123456AB", referrerProviderNumber: "123456CD", itemCode: "80010", entitlementConfirmed: true, noOtherClaimConfirmed: true, serviceConfirmed: true };
    attended = false;
    await expect(staff.action(api.rebates.prepare, args)).rejects.toThrow("Attendance");
    expect(await t.run((ctx) => ctx.db.query("rebateClaims").collect())).toHaveLength(0);
    attended = true;
    const result = await staff.action(api.rebates.prepare, args);
    expect(result.token).toBe("short-lived-test-token");
    expect(result.payload.funderData?.medicare?.isBulkBilled).toBe(false);
    expect(result.payload.claimableItems?.[0]?.price).toBe("240.00");
    await expect(staff.action(api.rebates.prepare, args)).rejects.toThrow("already exists");
    expect(await t.run((ctx) => ctx.db.query("rebateClaims").collect())).toHaveLength(1);
  });
  test("unauthenticated callers cannot read live patient data", async () => {
    const { t } = await setup();
    await expect(t.action(api.rebates.check, { appointmentId: "appointment", caseId: "case" })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("durable duplicate protection", () => {
  test("concurrent claim reservations create only one attempt", async () => {
    const { t, userId } = await setup();
    await t.run(async (ctx) => {
      await ctx.db.insert("rebateLaunch", { goLiveAt: now - 86400000, configuredAt: now, configuredBy: userId });
      await ctx.db.insert("carePlanReviews", { caseId: "case", patientId: "patient", caseUpdatedAt: "v1", reviewedAt: now, reviewedBy: userId });
    });
    const args = { appointmentId: "appointment", patientId: "patient", caseId: "case", invoiceId: "invoice", serviceDate: "2026-10-06", amountCents: 24000, itemCode: "80010", invoiceReference: "HD123", userId, caseUpdatedAt: "v1", startsAt: now - 3600000, maxSessions: 6 };
    const results = await Promise.allSettled([t.mutation(internal.rebateData.reserve, args), t.mutation(internal.rebateData.reserve, { ...args, invoiceReference: "HD456" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await t.run((ctx) => ctx.db.query("rebateClaims").collect())).toHaveLength(1);
    // Even a different appointment cannot reuse an allocation already reserved on this case.
    await expect(t.mutation(internal.rebateData.reserve, { ...args, appointmentId: "another", maxSessions: 1, invoiceReference: "HD789" })).rejects.toThrow("no remaining claim allocation");
  });
  test("polling rotates unresolved attempts and history can reach old claims", async () => {
    const { t, staff, userId } = await setup();
    await t.run(async (ctx) => {
      for (let i = 0; i < 230; i++) await ctx.db.insert("rebateClaims", {
        appointmentId: String(i), patientId: "patient", caseId: "case", invoiceId: String(i),
        serviceDate: "2026-10-06", amountCents: 24000, itemCode: "80010", invoiceReference: `HD${i}`,
        status: i < 30 ? "launching" : "approved", createdBy: userId, createdAt: now + i,
        updatedAt: now, eligibilityConfirmedAt: now,
      });
    });
    const first = await t.mutation(internal.rebateData.pending, {});
    expect(first).toHaveLength(25);
    const second = await t.mutation(internal.rebateData.pending, {});
    expect(new Set([...first, ...second].map((r) => r._id)).size).toBe(30);
    let cursor: string | null = null;
    const references: string[] = [];
    while (true) {
      const page: { page: Doc<"rebateClaims">[]; isDone: boolean; continueCursor: string } = await staff.query(api.rebateData.history, { paginationOpts: { cursor, numItems: 50 } });
      references.push(...page.page.map((c) => c.invoiceReference));
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    expect(references).toHaveLength(230);
    expect(references.at(-1)).toBe("HD0");
  });
  test("repeated and uncertain case imports cannot create a second case", async () => {
    const { t } = await setup();
    const job = await t.mutation(internal.rebateData.reserveCase, { key: "source", patientId: "patient" });
    await expect(t.mutation(internal.rebateData.reserveCase, { key: "source", patientId: "patient" })).rejects.toThrow("already started");
    await t.mutation(internal.rebateData.finishCase, { id: job.id, caseId: "case" });
    expect((await t.mutation(internal.rebateData.reserveCase, { key: "source", patientId: "patient" })).caseId).toBe("case");
    await expect(t.mutation(internal.rebateData.reserveCase, { key: "source", patientId: "wrong" })).rejects.toThrow("another patient");
  });
});
