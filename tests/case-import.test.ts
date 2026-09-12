import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { v } from "convex/values";
import { convexTest } from "convex-test";
import { internalAction } from "../convex/_generated/server";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";

vi.mock("../convex/google", () => ({ accessTokenFor: async () => "fake-google-token" }));
const fields = { patientName: "Test Patient", dateOfBirth: "1990-01-01", referralDate: "2026-09-01", sessionsReferred: "6", planType: "Mental Health Treatment Plan", referrerName: "Test GP" };
const modules = {
  "../convex/cases.ts": () => import("../convex/cases"),
  "../convex/rebateData.ts": () => import("../convex/rebateData"),
  "../convex/googleData.ts": () => import("../convex/googleData"),
  "../convex/bookings.ts": () => import("../convex/bookings"),
  "../convex/ai.ts": async () => ({ extractMentalHealthPlan: internalAction({ args: { base64: v.string(), mime: v.string(), filename: v.string() }, handler: async () => fields }) }),
  "../convex/_generated/server.ts": () => import("../convex/_generated/server"),
};
let matches: number;
let labelled: boolean, receivedAt: number;
const writes: Array<Record<string, unknown>> = [];
beforeEach(() => {
  matches = 1; writes.length = 0;
  labelled = true; receivedAt = Date.now() + 60_000;
  vi.stubEnv("CLINIKO_API_KEY", "test-key");
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input);
    let response: unknown;
    if (url.hostname === "gmail.googleapis.com" && url.pathname.endsWith("/attachments/attachment")) response = { size: 4, data: btoa("test") };
    else if (url.hostname === "gmail.googleapis.com" && url.pathname.endsWith("/labels")) response = { labels: [{ id: "referrals", name: "HappyDays/Referrals", type: "user" }] };
    else if (url.hostname === "gmail.googleapis.com" && url.pathname.endsWith("/messages/message")) response = { id: "message", labelIds: labelled ? ["referrals"] : [], internalDate: String(receivedAt), payload: { filename: "referral.pdf", mimeType: "application/pdf", body: { attachmentId: "attachment" } } };
    else if (url.hostname === "api.au1.cliniko.com" && url.pathname === "/v1/patients") response = { patients: Array.from({ length: matches }, (_, i) => ({ id: `patient${i}`, first_name: "Test", last_name: "Patient", date_of_birth: "1990-01-01" })) };
    else if (url.hostname === "api.au1.cliniko.com" && url.pathname.startsWith("/v1/patients/")) response = { id: "patient0", first_name: "Test", last_name: "Patient" };
    else if (url.hostname === "api.au1.cliniko.com" && url.pathname === "/v1/patient_cases" && init?.method === "POST") { writes.push(JSON.parse(init.body as string)); response = { id: "new-case" }; }
    else throw new Error(`Unexpected network request ${url.pathname}`);
    return new Response(JSON.stringify(response));
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run((ctx) => ctx.db.insert("users", { clerkId: "staff", email: "luke@barbarafraser.net", name: "Luke", lastSeenAt: 0 }));
  await t.run((ctx) => ctx.db.insert("googleAccounts", { userId, email: "luke@barbarafraser.net", refreshTokenEnc: "fake", scopes: [], status: "connected", connectedAt: 0 }));
  return { t, staff: t.withIdentity({ subject: "staff" }) };
}
const attachment = { gmailMessageId: "message", attachmentId: "attachment", mime: "application/pdf", filename: "referral.pdf" };
test("automatically matches exact name and DOB, saves structured session limit and never self-verifies", async () => {
  const { t, staff } = await setup();
  await staff.action(api.cases.autoCreateFromPlan, attachment);
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ patient_id: "patient0", referral: true, referral_type: "medicare", max_sessions: 6, issue_date: "2026-09-01", include_cancelled_attendees: false, include_dna_attendees: false });
  expect(await t.run((ctx) => ctx.db.query("carePlanReviews").collect())).toHaveLength(0);
  await staff.action(api.cases.autoCreateFromPlan, attachment);
  expect(writes).toHaveLength(1);
});
test("ambiguous or missing patient matches never create a case", async () => {
  const { staff } = await setup();
  for (matches of [0, 2]) await expect(staff.action(api.cases.autoCreateFromPlan, attachment)).rejects.toThrow("unique exact");
  expect(writes).toHaveLength(0);
});
test("automatic inbound import is disabled by default", async () => {
  const { t } = await setup();
  const accountId = await t.run(async (ctx) => (await ctx.db.query("googleAccounts").first())!._id);
  await t.action(internal.cases.onNewInbound, { accountId, messages: [] });
  expect(fetch).not.toHaveBeenCalled();
});
test("opted-in inbound imports require a new labelled message and process it only once", async () => {
  const { t, staff } = await setup();
  const accountId = await t.run(async (ctx) => (await ctx.db.query("googleAccounts").first())!._id);
  const threadId = await t.run((ctx) => ctx.db.insert("threads", { key: "test", subject: "Referral", participants: [], mailboxes: [{ accountId, gmailThreadId: "thread" }], firstMessageAt: 0, lastMessageAt: 0, lastDirection: "in", repliedBy: [], bothIncluded: false, tagIds: [] }));
  const args = { accountId, messages: [{ threadId, gmailMessageId: "message", gmailThreadId: "thread" }] };
  await staff.mutation(api.rebateData.setAutoImport, { enabled: true });
  labelled = false;
  await t.action(internal.cases.onNewInbound, args);
  expect(writes).toHaveLength(0);
  labelled = true; receivedAt = 0;
  await t.action(internal.cases.onNewInbound, args);
  expect(writes).toHaveLength(0);
  receivedAt = Date.now() + 60_000;
  await t.action(internal.cases.onNewInbound, args);
  await t.action(internal.cases.onNewInbound, args);
  expect(writes).toHaveLength(1);
  expect(await t.run((ctx) => ctx.db.query("notifications").collect())).toHaveLength(1);
  expect(await t.run((ctx) => ctx.db.query("carePlanReviews").collect())).toHaveLength(0);
});
