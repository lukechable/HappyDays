import { afterEach, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import type { GenericDatabaseWriter, GenericDataModel } from "convex/server";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
const modules = import.meta.glob("../convex/**/*.ts");
afterEach(() => vi.unstubAllEnvs());
async function setup() {
  const t = convexTest(schema, modules);
  const user = await t.run(ctx => ctx.db.insert("users", { clerkId: "staff", email: "luke@barbarafraser.net", name: "Luke", lastSeenAt: 0, prefs: { pushActivity: false } }));
  return { t, user, staff: t.withIdentity({ subject: "staff" }) };
}
test("internal settings cannot be enumerated, read or overwritten by a signed-in client", async () => {
  const { t, staff } = await setup();
  for (const key of ["guest.keypair", "guest.failures", "google.oauthState:staff", "bank.basiqUserId", "cliniko.refCache"]) {
    await t.mutation(internal.settings.setInternal, { key, value: "private-test-data" });
    await expect(staff.query(api.settings.get, { key })).rejects.toThrow("server-only");
    await expect(staff.mutation(api.settings.set, { key, value: "overwrite" })).rejects.toThrow("server-only");
  }
  await staff.mutation(api.settings.set, { key: "practice.name", value: "Practice" });
  expect(await staff.query(api.settings.all, {})).toEqual({ "practice.name": "Practice" });
  await expect(t.query(api.settings.all, {})).rejects.toThrow();
  await expect(staff.mutation(api.settings.set, { key: "practice.hours", value: { start: 99 } })).rejects.toThrow();
});

test("guest attempt limit is atomic and failed concurrent requests cannot bypass it", async () => {
  const { t } = await setup();
  const results = await Promise.allSettled(Array.from({ length: 15 }, () => t.mutation(internal.guestData.attempt, {})));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(10);
  expect(results.filter(r => r.status === "rejected")).toHaveLength(5);
});

test("guest key rotation installs exactly one new server-only key under concurrency", async () => {
  const { t } = await setup();
  await t.mutation(internal.settings.setInternal, { key: "guest.keypair", value: { privatePem: "old" } });
  const pairs = await Promise.all(["a", "b"].map(kid => t.mutation(internal.guestData.installKeys, { pair: { version: 2, kid, privatePem: kid, publicJwk: { kid } } })));
  expect(pairs[0]).toEqual(pairs[1]);
  expect(pairs[0].version).toBe(2);
});

async function signingFixture() {
  const { t, user } = await setup();
  const fileId = await t.run(async ctx => ctx.db.insert("files", { name: "Private.pdf", mime: "application/pdf", size: 4, storageId: await ctx.storage.store(new Blob(["test"], { type: "application/pdf" })), sha256: "test", uploadedBy: user, tagIds: [], isReport: false, version: 1, createdAt: 0 }));
  const id = await t.run(ctx => ctx.db.insert("signatureRequests", { token: "secret-test-token", signerName: "Patient", signerEmail: "patient@example.test", fileId, fields: [], status: "viewed", audit: [], createdBy: user, createdAt: Date.now() - 1000, expiresAt: Date.now() + 60_000 }));
  return { t, id, token: "secret-test-token" };
}

test.each(["expired", "cancelled", "declined"])("%s signing links cannot expose files or change request state", async state => {
  const { t, id, token } = await signingFixture();
  await t.run(ctx => ctx.db.patch(id, state === "expired" ? { expiresAt: Date.now() - 1 } : { status: state as "cancelled" | "declined" }));
  const result = await t.query(api.signatures.publicByToken, { token });
  expect(result?.status).toBe(state);
  expect(result?.fileUrl).toBeNull(); expect(result?.signedUrl).toBeNull(); expect(result?.signerName).toBe("");
  await t.mutation(api.signatures.publicViewed, { token });
  await t.mutation(api.signatures.publicDecline, { token, reason: "replay" });
  await expect(t.mutation(api.signatures.publicUploadUrl, { token })).rejects.toThrow("no longer active");
  expect(await t.run(ctx => ctx.db.query("notifications").collect())).toEqual([]);
});

test("signed upload uses actual storage metadata and rejects a forged PDF", async () => {
  const { t, token } = await signingFixture();
  const storageId = await t.run(ctx => ctx.storage.store(new Blob(["<script>bad</script>"], { type: "text/html" })));
  await expect(t.mutation(api.signatures.publicComplete, { token, storageId, size: 20, sha256: "invented" })).rejects.toThrow("new PDF");
  const pdf = await t.run(async ctx => {
    const storageId = await ctx.storage.store(new Blob(["%PDF-1.7 test"], { type: "application/pdf" }));
    // convex-test stores bytes/checksum but omits the HTTP upload content type.
    await (ctx.db as GenericDatabaseWriter<GenericDataModel>).patch(storageId, { contentType: "application/pdf" });
    return (await ctx.db.system.get(storageId))!;
  });
  await expect(t.mutation(api.signatures.publicComplete, { token, storageId: pdf._id, size: pdf.size, sha256: "invented" })).rejects.toThrow("checksum");
  await t.mutation(api.signatures.publicComplete, { token, storageId: pdf._id, size: pdf.size, sha256: pdf.sha256 });
  expect((await t.query(api.signatures.publicByToken, { token }))?.status).toBe("signed");
});

test("legacy payment webhooks are claimed once and uncertain external writes are not replayed", async () => {
  const { t } = await setup();
  const session = { businessId: "1", practitionerId: "2", appointmentTypeId: "3", startsAt: "2026-10-01T00:00:00Z", endsAt: "2026-10-01T01:00:00Z", patient: { firstName: "Test", lastName: "Patient", email: "test@example.test" }, mode: "full" as const, amountCents: 20000, expiresAt: Date.now() + 60_000 };
  const id = await t.run(ctx => ctx.db.insert("bookingSessions", { ...session, status: "pending", createdAt: Date.now() }));
  const claims = await Promise.all([t.mutation(internal.bookings.claimPaid, { id, checkoutId: "cs_test" }), t.mutation(internal.bookings.claimPaid, { id, checkoutId: "cs_test" })]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  await t.mutation(internal.bookings.finishSession, { id, status: "failed", error: "Network result uncertain" });
  expect(await t.mutation(internal.bookings.claimPaid, { id, checkoutId: "cs_test" })).toBeNull();
});
