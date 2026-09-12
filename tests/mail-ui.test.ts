// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, createElement as h, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getFunctionName } from "convex/server";
import { dropLive, readLive, writeLive } from "../src/lib/live-cache";
import type { ListItem } from "../convex/mail";
const state = vi.hoisted(() => ({ params: new URLSearchParams(), modify: vi.fn(), list: vi.fn(), navigate: vi.fn(), error: vi.fn(), reload: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => state.params }));
vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/link", () => ({ default: () => null }));
vi.mock("convex/react", () => ({ useAction: (ref: Parameters<typeof getFunctionName>[0]) => getFunctionName(ref) === "mail:modify" ? state.modify : state.list, useMutation: () => state.reload }));
vi.mock("convex-helpers/react/cache/hooks", () => ({ useQuery: (ref: Parameters<typeof getFunctionName>[0]) => getFunctionName(ref) === "users:me" ? { google: { status: "connected" }, prefs: {}, badges: {} } : getFunctionName(ref) === "signaturesEmail:mine" ? [] : {} }));
vi.mock("../src/lib/hooks", () => ({ useCacheScope: () => "fixture", useNow: () => Date.now(), useMediaQuery: () => false, useStored: (_key: string, value: unknown) => useState(value), useLive: () => ({ data: [], reload: state.reload }) }));
vi.mock("../src/lib/gmail-budget", () => ({ gmailRead: (fn: () => Promise<unknown>) => fn(), promoteGmailRead: vi.fn() }));
vi.mock("../src/lib/shallow", () => ({ replaceSearch: state.navigate }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: state.error, success: vi.fn() }) }));
vi.mock("../src/components/ui/button", () => ({ Button: ({ children, disabled, onClick, ...props }: { children: React.ReactNode; disabled?: boolean; onClick?: React.MouseEventHandler; "aria-label"?: string }) => h("button", { disabled, onClick, "aria-label": props["aria-label"] }, children) }));
vi.mock("../src/components/primitives", () => ({ Empty: () => null }));
vi.mock("../src/components/mail/folder-list", () => ({ FolderList: () => null, VIEWS: [{ key: "inbox", label: "Inbox" }, { key: "overdue", label: "Overdue" }], SMART_TABS: [], DRAG_MIME: "text/plain" }));
vi.mock("../src/components/mail/context-menu", () => ({ ContextMenu: () => null, MenuItem: () => null, MenuSeparator: () => null, MenuHeading: () => null }));
vi.mock("../src/components/mail/thread-view", () => ({ ThreadView: () => null }));
vi.mock("../src/components/mail/filter-dialog", () => ({ FilterDialog: () => null }));
vi.mock("../src/components/mail/thread-list", () => ({ ThreadList: ({ items, checked, onToggleCheck, error, loading, hasMore, onMore }: { error?: string; loading: boolean; hasMore: boolean; onMore: () => void; items: ListItem[]; checked: Set<string>; onToggleCheck: (id: string, shift: boolean) => void }) => h("div", {}, error && h("div", { role: "alert" }, error), loading && h("div", { role: "status" }, "Loading mailbox"), hasMore && h("button", { onClick: onMore }, "Load more"), ...items.map(i => h("input", { key: i.gmailThreadId, type: "checkbox", "data-thread": i.gmailThreadId, checked: checked.has(i.gmailThreadId), onChange: () => onToggleCheck(i.gmailThreadId, false) }))) }));
import { ensureMailbox, mailboxKey } from "../src/lib/mailbox-cache";
import { MailPage } from "../src/components/mail/mail-page";
let root: Root;
let container: HTMLDivElement;
function rows() { return [...container.querySelectorAll<HTMLInputElement>("[data-thread]")]; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  dropLive(""); vi.clearAllMocks(); state.params = new URLSearchParams("view=unread");
  state.list.mockResolvedValue({ items: ["first", "second", "third"].map(gmailThreadId => ({ gmailThreadId, labelIds: ["INBOX"], unread: true })), missing: 0 });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(h(MailPage)));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); dropLive(""); });
test("Delete from a focused checkbox keeps pending rows stable and preserves failed selections", async () => {
  const pending = deferred<{ completedIds: string[]; failedIds: string[]; error?: string }>();
  state.modify.mockReturnValue(pending.promise);
  await act(async () => { rows()[0].click(); rows()[1].click(); });
  rows()[1].focus();
  await act(async () => { rows()[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true })); });
  expect(state.modify).toHaveBeenCalledWith({ gmailThreadIds: ["first", "second"], op: "trash" });
  expect(rows()).toHaveLength(3);
  expect(rows().filter(r => r.checked)).toHaveLength(2);
  const deleteButton = [...container.querySelectorAll("button")].find(b => b.textContent === "Delete")!;
  expect(deleteButton.disabled).toBe(true);
  await act(async () => { rows()[1].dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true })); });
  expect(state.modify).toHaveBeenCalledTimes(1);
  await act(async () => pending.resolve({ completedIds: ["first"], failedIds: ["second"], error: "Gmail is rate-limiting requests" }));
  expect(rows().map(r => r.dataset.thread)).toEqual(["second", "third"]);
  expect(rows().filter(r => r.checked).map(r => r.dataset.thread)).toEqual(["second"]);
  expect(state.error.mock.calls[0][0]).not.toContain("CONVEX");
});
test("finishing deletion after switching folders does not cancel the new folder's response", async () => {
  const deletion = deferred<{ completedIds: string[]; failedIds: string[] }>();
  state.modify.mockReturnValue(deletion.promise);
  await act(async () => { rows()[0].click(); });
  await act(async () => { rows()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true })); });
  const newFolder = deferred<{ items: { gmailThreadId: string; labelIds: string[] }[] }>();
  state.list.mockReturnValue(newFolder.promise); state.params = new URLSearchParams("view=sent");
  await act(async () => root.render(h(MailPage)));
  await act(async () => deletion.resolve({ completedIds: ["first"], failedIds: [] }));
  await act(async () => newFolder.resolve({ items: [{ gmailThreadId: "sent-message", labelIds: ["SENT"] }] }));
  expect(rows().map(r => r.dataset.thread)).toEqual(["sent-message"]);
  expect(rows()[0].checked).toBe(false);
  expect(state.navigate).not.toHaveBeenCalled();
});

test("a failed mailbox read is not cached as a successful empty folder when switching back", async () => {
  state.list.mockImplementation(async ({ view }: { view: string }) => {
    if (view === "inbox") throw new Error("Mailbox temporarily unavailable");
    return { items: [{ gmailThreadId: "overdue-mail", labelIds: [] }], missing: 0 };
  });
  state.params = new URLSearchParams("view=inbox");
  await act(async () => root.render(h(MailPage)));
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Mailbox temporarily unavailable");
  state.params = new URLSearchParams("view=overdue");
  await act(async () => root.render(h(MailPage)));
  const recovered = deferred<{ items: { gmailThreadId: string; labelIds: string[] }[] }>();
  state.list.mockReturnValue(recovered.promise);
  state.params = new URLSearchParams("view=inbox");
  await act(async () => root.render(h(MailPage)));
  expect(state.list.mock.calls.filter(([args]) => args.view === "inbox")).toHaveLength(2);
  expect(container.querySelector('[role="status"]')).not.toBeNull();
  await act(async () => recovered.resolve({ items: [{ gmailThreadId: "inbox-recovered", labelIds: ["INBOX"] }] }));
  expect(rows().map(r => r.dataset.thread)).toEqual(["inbox-recovered"]);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});
test("overdue pagination does not add the same other-mailbox count twice", async () => {
  state.list.mockResolvedValueOnce({ items: [{ gmailThreadId: "overdue-first", labelIds: [] }], missing: 1, nextPageToken: "20" });
  state.params = new URLSearchParams("view=overdue");
  await act(async () => root.render(h(MailPage)));
  state.list.mockResolvedValueOnce({ items: [{ gmailThreadId: "overdue-second", labelIds: [] }], missing: 1 });
  await act(async () => [...container.querySelectorAll("button")].find(b => b.textContent === "Load more")!.click());
  expect(container.textContent).toContain("1 not in your mailbox");
  expect(rows()).toHaveLength(2);
});
test("returning to a recently loaded folder displays its cached conversations immediately", async () => {
  state.list.mockResolvedValueOnce({ items: [{ gmailThreadId: "sent-fixture", labelIds: ["SENT"] }], missing: 0 });
  state.params = new URLSearchParams("view=sent");
  await act(async () => root.render(h(MailPage)));
  const calls = state.list.mock.calls.length;
  state.params = new URLSearchParams("view=unread");
  await act(async () => root.render(h(MailPage)));
  expect(rows().map(r => r.dataset.thread)).toEqual(["first", "second", "third"]);
  expect(state.list).toHaveBeenCalledTimes(calls);
  expect(container.querySelector('[role="status"]')).toBeNull();
});

test("a folder prepared before its first click renders without a network wait", async () => {
  await act(async () => ensureMailbox("fixture", { view: "drafts" }, async () => ({ items: [{ gmailThreadId: "prepared-draft", labelIds: ["DRAFT"] } as ListItem] }), { background: true }));
  state.list.mockReturnValue(new Promise(() => {}));
  const calls = state.list.mock.calls.length;
  state.params = new URLSearchParams("view=drafts");
  await act(async () => root.render(h(MailPage)));
  expect(rows().map(r => r.dataset.thread)).toEqual(["prepared-draft"]);
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(state.list).toHaveBeenCalledTimes(calls);
});
test("leaving a loading folder still caches its response for an instant return", async () => {
  const pending = deferred<{ items: ListItem[] }>();
  state.list.mockReturnValueOnce(pending.promise);
  state.params = new URLSearchParams("view=sent");
  await act(async () => root.render(h(MailPage)));
  state.params = new URLSearchParams("view=unread");
  await act(async () => root.render(h(MailPage)));
  await act(async () => pending.resolve({ items: [{ gmailThreadId: "finished-after-leaving", labelIds: ["SENT"] } as ListItem] }));
  const calls = state.list.mock.calls.length;
  state.params = new URLSearchParams("view=sent");
  await act(async () => root.render(h(MailPage)));
  expect(rows().map(r => r.dataset.thread)).toEqual(["finished-after-leaving"]);
  expect(state.list).toHaveBeenCalledTimes(calls);
});
test("navigation joins an in-flight preload and renders its result without a duplicate read", async () => {
  const pending = deferred<{ items: ListItem[] }>();
  const preload = vi.fn(() => pending.promise);
  let loading!: Promise<void>;
  await act(async () => { loading = ensureMailbox("fixture", { view: "archive" }, preload, { background: true }); });
  const calls = state.list.mock.calls.length;
  state.params = new URLSearchParams("view=archive");
  await act(async () => root.render(h(MailPage)));
  await act(async () => { pending.resolve({ items: [{ gmailThreadId: "prepared-archive", labelIds: [] as string[] } as ListItem] }); await loading; });
  expect(rows().map(r => r.dataset.thread)).toEqual(["prepared-archive"]);
  expect(preload).toHaveBeenCalledTimes(1);
  expect(state.list).toHaveBeenCalledTimes(calls);
});
test.each([{ items: [] as ListItem[] }, { items: [{ gmailThreadId: "old-mail", labelIds: [] as string[] } as ListItem] }])("stale cached folders stay visible during refresh, including empty ones (%j)", async ({ items }) => {
  await act(async () => writeLive(mailboxKey("fixture", { view: "spam" }), { data: { items, missing: 0 }, fetchedAt: 1 }));
  state.list.mockReturnValue(new Promise(() => {}));
  state.params = new URLSearchParams("view=spam");
  await act(async () => root.render(h(MailPage)));
  expect(rows()).toHaveLength(items.length);
  expect(container.querySelector('[role="status"]')).toBeNull();
  expect(readLive(mailboxKey("fixture", { view: "spam" })).inflight).toBeDefined();
});
test("a confirmed mail action keeps unrelated prepared folders available immediately", async () => {
  await act(async () => ensureMailbox("fixture", { view: "sent" }, async () => ({ items: [{ gmailThreadId: "keep-sent", labelIds: ["SENT"] } as ListItem] })));
  state.modify.mockResolvedValue({ completedIds: ["first"], failedIds: [] });
  await act(async () => { rows()[0].click(); });
  await act(async () => rows()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true })));
  state.list.mockReturnValue(new Promise(() => {}));
  state.params = new URLSearchParams("view=sent");
  await act(async () => root.render(h(MailPage)));
  expect(rows().map(r => r.dataset.thread)).toEqual(["keep-sent"]);
  expect(container.querySelector('[role="status"]')).toBeNull();
});
