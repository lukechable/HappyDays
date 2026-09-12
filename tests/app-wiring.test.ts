import { afterEach, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { taskDueBy, taskOverdue } from "../convex/lib/taskViews";
import { invoiceFlag } from "../convex/lib/invoiceFlags";
import { isActive, navItemFor } from "../src/lib/nav";
const modules = import.meta.glob("../convex/**/*.ts");
afterEach(() => vi.useRealTimers());
async function setup() {
  const t = convexTest(schema, modules);
  const userId = await t.run(ctx => ctx.db.insert("users", { clerkId: "staff", email: "luke@barbarafraser.net", name: "Luke", lastSeenAt: 0, prefs: { pushActivity: false } }));
  const accountId = await t.run(ctx => ctx.db.insert("googleAccounts", { userId, email: "test@example.test", refreshTokenEnc: "fake", scopes: [], status: "connected", connectedAt: 0 }));
  const staff = t.withIdentity({ subject: "staff" });
  return { t, userId, accountId, staff };
}
test("overdue dashboard, badge and paginated mailbox agree beyond the former cutoff", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-13T02:00:00Z"));
  const { t, staff, userId, accountId } = await setup();
  await t.run(async ctx => {
    for (let n = 0; n < 160; n++) await ctx.db.insert("threads", {
      key: `thread-${n}`, subject: `Thread ${n}`, participants: [], mailboxes: n === 159 ? [] : [{ accountId, gmailThreadId: `gmail-${n}` }],
      firstMessageAt: 1, lastMessageAt: n, lastInboundAt: n, lastDirection: "in", repliedBy: [], tagIds: [], bothIncluded: true,
      ...(n < 100 ? { snoozedUntil: Date.now() + 86400000 } : n === 100 ? { repliedByEmails: ["staff@example.test"] } : n === 101 ? { autoRepliedAt: 10 } : {}),
    });
  });
  const summary = await staff.query(api.mail.overdueSummary, {});
  expect(summary).toMatchObject({ total: 58, missing: 1 });
  expect(summary.items).toHaveLength(6);
  expect((await staff.query(api.users.me, {}))?.badges.overdue).toBe(58);
  const ids: string[] = [];
  let pageToken: string | undefined;
  do {
    const page = await t.query(internal.mail.threadIdsForView, { view: "overdue", accountId, userId, pageToken });
    expect(page.total).toBe(57); expect(page.missing).toBe(1);
    ids.push(...page.gmailThreadIds); pageToken = page.nextPageToken;
  } while (pageToken);
  expect(new Set(ids).size).toBe(57);
  expect(ids).toContain("gmail-102");
  expect(ids.slice(0, 6)).toEqual(summary.items.map(x => x.gmailThreadId));
});
test("Melbourne all-day tasks remain due today until the next local day", () => {
  const dueAt = Date.parse("2026-09-12T14:00:00Z"); // 13 September Melbourne
  const task = { dueAt, allDay: true, status: "open" };
  const now = Date.parse("2026-09-13T12:00:00Z");
  expect(taskDueBy(task, now)).toBe(true);
  expect(taskOverdue(task, now)).toBe(false);
  expect(taskOverdue(task, Date.parse("2026-09-13T14:00:00Z"))).toBe(true);
  expect(taskOverdue({ ...task, allDay: false }, now)).toBe(true);
  expect(taskDueBy({ dueAt: Date.parse("2026-10-04T12:30:00Z") }, Date.parse("2026-09-27T12:30:00Z"), 7)).toBe(true);
});
test("task counts, completed visibility, matter filtering and calendar moves stay connected", async () => {
  const { t, staff, userId } = await setup();
  const matterId = await staff.mutation(api.matters.save, { name: "Fixture matter", parties: [], clinikoPatientIds: [] });
  const listId = await staff.mutation(api.tasks.saveList, { name: "Fixture list", color: "blue" });
  const id = await staff.mutation(api.tasks.save, { title: "Fixture task", notes: "Retain these notes", matterId, listId, assigneeId: userId, allDay: true, priority: "high" });
  await staff.mutation(api.tasks.reschedule, { id, dueAt: 12345 });
  expect(await t.run(ctx => ctx.db.get(id))).toMatchObject({ notes: "Retain these notes", listId, matterId, assigneeId: userId, priority: "high", dueAt: 12345 });
  expect((await staff.query(api.tasks.lists, {})).smart.all).toBe((await staff.query(api.tasks.list, { view: "all" })).length);
  expect((await staff.query(api.users.me, {}))?.badges.tasks).toBe(1);
  await staff.mutation(api.tasks.linkMatter, { id, matterId: null });
  expect(await staff.query(api.tasks.list, { view: "all", matterId })).toHaveLength(0);
  await staff.mutation(api.tasks.setStatus, { id, status: "done" });
  expect(await staff.query(api.tasks.list, { view: "all" })).toHaveLength(0);
  expect(await staff.query(api.tasks.list, { view: "done" })).toHaveLength(1);
  expect(await staff.query(api.tasks.list, { view: "all", includeDone: true })).toHaveLength(1);
});
test("report alerts exclude unlinked, closed, void and draft invoices", async () => {
  const { staff, t } = await setup();
  const matterId = await staff.mutation(api.matters.save, { name: "Fixture matter", parties: [], clinikoPatientIds: [] });
  for (const status of ["paid", "void", "draft", "open"]) await t.mutation(internal.money.upsertInvoice, { invoice: { stripeId: status, amountDueCents: 100, amountPaidCents: status === "paid" ? 100 : 0, currency: "aud", status, matterId, createdAt: 1 } });
  await t.mutation(internal.money.upsertInvoice, { invoice: { stripeId: "unlinked", amountDueCents: 100, amountPaidCents: 100, currency: "aud", status: "paid", createdAt: 1 } });
  expect((await staff.query(api.money.table, {})).counts.paidNotDelivered).toBe(1);
  expect((await staff.query(api.users.me, {}))?.badges.paidNotDelivered).toBe(1);
  await staff.mutation(api.matters.setStatus, { id: matterId, status: "delivered" });
  const table = await staff.query(api.money.table, {});
  expect(table.counts).toMatchObject({ paidNotDelivered: 0, deliveredUnpaid: 1 });
  expect(table.rows.filter(x => x.flag === "delivered_unpaid").map(x => x.stripeId)).toEqual(["open"]);
  await staff.mutation(api.matters.setStatus, { id: matterId, status: "report_due" });
  expect((await staff.query(api.money.table, {})).counts.paidNotDelivered).toBe(1);
  expect(invoiceFlag("paid", { status: "closed" })).toBe("complete");
});
test("matter file counts follow current links, search stays scoped and unlink actually persists", async () => {
  const { t, staff, userId } = await setup();
  const a = await staff.mutation(api.matters.save, { name: "A", parties: [], clinikoPatientIds: [] });
  const b = await staff.mutation(api.matters.save, { name: "B", parties: [], clinikoPatientIds: [] });
  const storageId = await t.run(ctx => ctx.storage.store(new Blob(["fixture"])));
  const fileId = await staff.mutation(api.files.register, { storageId, name: "Fixture report.pdf", mime: "application/pdf", size: 7, sha256: "fixture", matterId: a });
  await t.run(ctx => ctx.db.insert("matterLinks", { matterId: b, kind: "file", refId: fileId, createdAt: 0 }));
  expect((await staff.query(api.matters.list, {})).find(m => m._id === b)?.counts.files).toBe(0);
  expect(await staff.query(api.files.list, { matterId: b, q: "Fixture" })).toHaveLength(0);
  await staff.mutation(api.files.update, { id: fileId, matterId: b });
  expect((await staff.query(api.matters.list, {})).find(m => m._id === b)?.counts.files).toBe(1);
  await staff.mutation(api.files.update, { id: fileId, matterId: null });
  expect((await t.run(ctx => ctx.db.get(fileId)))?.matterId).toBeUndefined();
  await t.mutation(internal.money.upsertInvoice, { invoice: { stripeId: "remove-fixture", amountDueCents: 100, amountPaidCents: 0, currency: "aud", status: "open", matterId: b, createdAt: 1 } });
  await t.run(ctx => ctx.db.insert("courtItems", { kind: "affidavit", title: "Fixture", status: "requested", matterId: b, createdBy: userId, createdAt: 0, updatedAt: 0 }));
  await staff.mutation(api.matters.remove, { id: b });
  expect((await t.run(async ctx => (await ctx.db.query("stripeInvoices").collect())[0])).matterId).toBeUndefined();
  expect((await t.run(async ctx => (await ctx.db.query("courtItems").collect())[0])).matterId).toBeUndefined();
});
test("opening an overdue thread preserves the correct navigation label and selection", () => {
  expect(navItemFor("/mail", "?thread=fixture&view=overdue").label).toBe("Overdue");
  expect(isActive({ href: "/mail?view=overdue", label: "Overdue", blurb: "" }, "/mail", "?thread=fixture&view=overdue")).toBe(true);
  expect(isActive({ href: "/mail", label: "Inbox", blurb: "" }, "/mail", "?view=overdue&thread=fixture")).toBe(false);
  expect(navItemFor("/money/transactions", "?kind=bank").label).toBe("Transactions");
});
