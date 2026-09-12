import { afterEach, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { applyMailChange } from "../src/lib/mail-change";
import { errorMessage } from "../src/lib/utils";
import type { ListItem } from "../convex/mail";
vi.mock("../convex/google", () => ({ accessTokenFor: async () => "test-token" }));
const modules = import.meta.glob("../convex/**/*.ts");
afterEach(() => vi.unstubAllGlobals());
async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run(ctx => ctx.db.insert("users", { clerkId: "staff", email: "luke@barbarafraser.net", name: "Luke", lastSeenAt: 0 }));
  const accountId = await t.run(ctx => ctx.db.insert("googleAccounts", { userId, email: "test@example.test", refreshTokenEnc: "fake", scopes: [], status: "connected", connectedAt: 0 }));
  return { t, accountId, staff: t.withIdentity({ subject: "staff" }) };
}
test("partial bulk deletion reports exactly which rows changed, without falsely rolling them back", async () => {
  const { staff } = await setup();
  vi.stubGlobal("fetch", vi.fn(async (input: string) => input.includes("/first/") ? new Response(JSON.stringify({ id: "first" })) : new Response(JSON.stringify({ error: { message: "Temporary failure" } }), { status: 503 })));
  const result = await staff.action(api.mail.modify, { gmailThreadIds: ["first", "second", "third"], op: "trash" });
  expect(result.completedIds).toEqual(["first"]);
  expect(result.failedIds).toEqual(["second", "third"]);
  expect(fetch).toHaveBeenCalledTimes(2);
  const rows = ["first", "second", "third"].map(gmailThreadId => ({ gmailThreadId } as ListItem));
  expect(applyMailChange(rows, result.completedIds, "trash", "inbox").map(i => i.gmailThreadId)).toEqual(["second", "third"]);
  expect(applyMailChange(rows, [], "trash", "inbox")).toEqual(rows);
});
test("a large read-mark operation makes one batch request instead of concurrent writes", async () => {
  const { staff } = await setup();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
  await staff.action(api.mail.markMessageRead, { gmailMessageIds: Array.from({ length: 40 }, (_, n) => `message-${n}`), read: true });
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, options] = vi.mocked(fetch).mock.calls[0];
  expect(url).toContain("/messages/batchModify");
  expect(JSON.parse(options!.body as string).removeLabelIds).toEqual(["UNREAD"]);
});
test("Gmail quota is shared across tabs and uses the current thread-read costs", async () => {
  const { t, accountId } = await setup();
  const results = await Promise.all([t.mutation(internal.mailQuota.reserve, { accountId, cost: 810 }), t.mutation(internal.mailQuota.reserve, { accountId, cost: 810 })]);
  expect(results.filter(n => n === 0)).toHaveLength(1);
  expect(results.find(n => n > 0)).toBeGreaterThan(7000);
});
test("Gmail quota errors shown to users do not contain Convex stack traces", () => {
  const message = errorMessage(new Error('[CONVEX A(mail:modify)] [Request ID: example] Server Error Uncaught Error: Gmail is rate-limiting requests for a moment. Wait a few seconds and try again. at call (../../convex/lib/gmail.ts:55:4) Called by client'));
  expect(message).toBe("Gmail is temporarily busy. Please wait a moment and try again.");
});
