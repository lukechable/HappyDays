import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
import { SMART_LABELS } from "../convex/lib/smartMail";
vi.mock("../convex/google", () => ({ accessTokenFor: async () => "test-token" }));
const modules = import.meta.glob("../convex/**/*.ts");
beforeEach(() => vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ threads: [] })))));
afterEach(() => vi.unstubAllGlobals());
test("every Smart bucket requests the corresponding Gmail category ID and retains search/pagination", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run(ctx => ctx.db.insert("users", { clerkId: "staff", email: "luke@barbarafraser.net", name: "Luke", lastSeenAt: 0 }));
  await t.run(ctx => ctx.db.insert("googleAccounts", { userId, email: "luke@barbarafraser.net", refreshTokenEnc: "fake", scopes: [], status: "connected", connectedAt: 0 }));
  const staff = t.withIdentity({ subject: "staff" });
  for (const [view, label] of Object.entries(SMART_LABELS)) {
    await staff.action(api.mail.listThreads, { view, q: "is:unread", pageToken: "next-page" });
    const url = new URL(vi.mocked(fetch).mock.calls.at(-1)![0] as string);
    expect(url.searchParams.getAll("labelIds")).toEqual(["INBOX", label]);
    expect(url.searchParams.get("q")).toBe("is:unread");
    expect(url.searchParams.get("pageToken")).toBe("next-page");
  }
  expect(SMART_LABELS["smart:primary"]).toBe("CATEGORY_PERSONAL");
});

test("search includes sent mail regardless of the selected or collapsed folder", async () => {
  const t = convexTest(schema, modules);
  const userId = await t.run(ctx => ctx.db.insert("users", { clerkId: "staff", email: "luke@barbarafraser.net", name: "Luke", lastSeenAt: 0 }));
  await t.run(ctx => ctx.db.insert("googleAccounts", { userId, email: "luke@barbarafraser.net", refreshTokenEnc: "fake", scopes: [], status: "connected", connectedAt: 0 }));
  const staff = t.withIdentity({ subject: "staff" });
  for (const q of ["appointment", "in:sent appointment", "from:me"]) {
    await staff.action(api.mail.listThreads, { view: "search", q, labelId: "an-old-folder" });
    const url = new URL(vi.mocked(fetch).mock.calls.at(-1)![0] as string);
    expect(url.searchParams.getAll("labelIds")).toEqual([]);
    expect(url.searchParams.get("q")).toBe(q);
  }
});
