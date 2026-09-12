import { afterEach, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api } from "../convex/_generated/api";
vi.mock("../convex/google", () => ({ accessTokenFor: async () => "test-token" }));
const modules = import.meta.glob("../convex/**/*.ts");
afterEach(() => vi.unstubAllGlobals());
test.each(["inbox", "unread", "starred", "sent", "drafts", "archive", "spam", "trash", "smart:primary", "smart:newsletter", "smart:notification", "smart:social", "smart:forums", "label", "search", "all"])("%s loads actual conversations through Gmail listing and batch reading", async view => {
  const t = convexTest(schema, modules);
  const userId = await t.run(ctx => ctx.db.insert("users", { clerkId: "staff", email: "luke@barbarafraser.net", name: "Luke", lastSeenAt: 0 }));
  await t.run(ctx => ctx.db.insert("googleAccounts", { userId, email: "luke@barbarafraser.net", refreshTokenEnc: "fake", scopes: [], status: "connected", connectedAt: 0 }));
  vi.stubGlobal("fetch", vi.fn(async (input: string) => {
    const url = new URL(input);
    if (url.pathname === "/gmail/v1/users/me/threads") {
      if (["spam", "trash"].includes(view) && url.searchParams.get("includeSpamTrash") !== "true") return new Response(JSON.stringify({ resultSizeEstimate: 0 }));
      return new Response(JSON.stringify({ threads: [{ id: "fixture-thread" }], resultSizeEstimate: 2, nextPageToken: "page-two" }));
    }
    expect(url.pathname).toBe("/batch/gmail/v1");
    const thread = { id: "fixture-thread", messages: [{ id: "fixture-message", threadId: "fixture-thread", internalDate: "1750000000000", labelIds: view === "drafts" ? ["DRAFT"] : ["INBOX"], snippet: "Fixture preview", payload: { headers: [{ name: "Subject", value: "Fixture subject" }, { name: "From", value: "Fixture <fixture@example.test>" }, { name: "To", value: "luke@barbarafraser.net" }, { name: "Message-ID", value: "<fixture@example.test>" }] } }] };
    return new Response(`--reply\r\nContent-Type: application/http\r\nContent-ID: <response-t0>\r\n\r\nHTTP/1.1 200 OK\r\n\r\n${JSON.stringify(thread)}\r\n--reply--`, { headers: { "Content-Type": "multipart/mixed; boundary=reply" } });
  }));
  const result = await t.withIdentity({ subject: "staff" }).action(api.mail.listThreads, { view, ...(view === "label" ? { labelId: "Label_fixture" } : view === "search" ? { q: "fixture" } : {}) });
  expect(result.items).toHaveLength(1);
  expect(result.items[0]).toMatchObject({ gmailThreadId: "fixture-thread", subject: "Fixture subject", snippet: "Fixture preview", latestIsDraft: view === "drafts" });
  expect(result.nextPageToken).toBe("page-two");
  expect(result.estimate).toBe(2);
});
