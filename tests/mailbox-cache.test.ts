// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, expect, test, vi } from "vitest";
import { dropLive, readLive, writeLive } from "../src/lib/live-cache";
import { mailStore, scopedMailStore } from "../src/lib/mail-store";
import { ensureMailbox, mailboxKey, restoreMailboxes, updateMailboxCaches, type MailboxData } from "../src/lib/mailbox-cache";
import type { ListItem } from "../convex/mail";
const item = (id: string, labelIds: string[] = []): ListItem => ({ gmailThreadId: id, labelIds } as ListItem);
afterEach(async () => { dropLive(""); await mailStore.clear(); });
test("startup restores all saved folders only for the signed-in account", async () => {
  for (const view of ["sent", "drafts", "trash"]) await scopedMailStore("mine").putList(mailboxKey("mine", { view }), { items: [item(view)], missing: 0, fetchedAt: 123 });
  await scopedMailStore("other").putList(mailboxKey("other", { view: "inbox" }), { items: [item("private")], missing: 0, fetchedAt: 123 });
  await restoreMailboxes("mine", new AbortController().signal);
  for (const view of ["sent", "drafts", "trash"]) expect(readLive<MailboxData>(mailboxKey("mine", { view })).data?.items[0].gmailThreadId).toBe(view);
  expect(readLive(mailboxKey("other", { view: "inbox" })).data).toBeUndefined();
});
test("a recent device copy avoids a Gmail read after restart", async () => {
  const key = mailboxKey("mine", { view: "sent" });
  await scopedMailStore("mine").putList(key, { items: [item("saved")], nextToken: "next", missing: 0, fetchedAt: Date.now() });
  const list = vi.fn();
  await ensureMailbox("mine", { view: "sent" }, list);
  expect(list).not.toHaveBeenCalled();
  expect(readLive<MailboxData>(key).data?.nextToken).toBe("next");
  expect(readLive(key).inflight).toBeUndefined();
});
test("sign-out prevents a pending read from restoring mail to memory or disk", async () => {
  let finish!: (value: { items: ListItem[] }) => void;
  let started!: () => void;
  const start = new Promise<void>(r => { started = r; });
  const pending = ensureMailbox("mine", { view: "sent" }, () => { started(); return new Promise(r => { finish = r; }); });
  await start;
  dropLive("");
  finish({ items: [item("must-not-return")] });
  await pending;
  expect(readLive(mailboxKey("mine", { view: "sent" })).data).toBeUndefined();
  expect(await scopedMailStore("mine").getLists()).toEqual([]);
});
test("confirmed changes retain and update saved folders across restart without touching another account", async () => {
  const key = mailboxKey("mine", { view: "starred" });
  const data = { items: [item("changed", ["STARRED"]), item("keep", ["STARRED"])], missing: 0 };
  writeLive(key, { data, fetchedAt: Date.now() });
  writeLive(mailboxKey("other", { view: "starred" }), { data, fetchedAt: Date.now() });
  await scopedMailStore("mine").putList(key, { ...data, fetchedAt: Date.now() });
  await updateMailboxCaches("mine", ["changed"], "unstar");
  expect(readLive<MailboxData>(key).data?.items.map(i => i.gmailThreadId)).toEqual(["keep"]);
  expect(readLive<MailboxData>(mailboxKey("other", { view: "starred" })).data?.items).toHaveLength(2);
  dropLive("");
  await restoreMailboxes("mine", new AbortController().signal);
  expect(readLive<MailboxData>(key).data?.items.map(i => i.gmailThreadId)).toEqual(["keep"]);
});
