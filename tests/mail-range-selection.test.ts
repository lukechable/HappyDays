// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { act, createElement as h, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getFunctionName } from "convex/server";
import { dropLive } from "../src/lib/live-cache";
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
import { MailPage } from "../src/components/mail/mail-page";
let root: Root;
let container: HTMLDivElement;
const mail = (id: string): ListItem => ({ gmailThreadId: id, subject: id, snippet: "Fixture", senders: [{ name: "Sender", email: "sender@example.test" }], participants: [], lastAt: 1, unread: false, starred: false, important: false, hasAttachment: false, labelIds: ["INBOX"], count: 1, latestFromMe: false, latestIsDraft: false });
const ids = ["first", "second", "third", "fourth", "fifth", "sixth"];
const options = () => [...container.querySelectorAll<HTMLElement>('[role="option"]')];
const checkedIndices = () => options().flatMap((r, i) => r.querySelector<HTMLInputElement>('input[type="checkbox"]')?.checked ? [i] : []);
async function clickRow(index: number, shiftKey = false) { await act(async () => { options()[index].dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey })); }); }
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  dropLive(""); vi.clearAllMocks(); state.params = new URLSearchParams("view=inbox");
  state.list.mockResolvedValue({ items: ids.map(mail), missing: 0 });
  state.modify.mockResolvedValue({ completedIds: [], failedIds: [] });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => root.render(h(MailPage)));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); dropLive(""); });
test("click a message then Shift-click farther down selects the inclusive range for bulk Delete", async () => {
  await clickRow(1);
  expect(state.navigate).toHaveBeenLastCalledWith("/mail", { thread: "second" });
  expect(checkedIndices()).toEqual([]);
  await clickRow(4, true);
  expect(checkedIndices()).toEqual([1, 2, 3, 4]);
  expect(options().filter(r => r.getAttribute("aria-selected") === "true")).toHaveLength(4);
  expect(state.navigate).toHaveBeenCalledTimes(1); // Selection does not open the endpoint email.
  expect(container.textContent).toContain("4 selected");
  await act(async () => [...container.querySelectorAll("button")].find(b => b.textContent === "Delete")!.click());
  expect(state.modify).toHaveBeenCalledWith({ gmailThreadIds: ["second", "third", "fourth", "fifth"], op: "trash" });
});
test("Shift-clicking upward and extending downward retains the original anchor", async () => {
  await clickRow(3);
  await clickRow(1, true);
  expect(checkedIndices()).toEqual([1, 2, 3]);
  await clickRow(5, true);
  expect(checkedIndices()).toEqual([1, 2, 3, 4, 5]);
});
test("a checkbox can end a range begun by clicking the message row", async () => {
  await clickRow(4);
  await act(async () => options()[1].querySelector('input')!.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })));
  expect(checkedIndices()).toEqual([1, 2, 3, 4]);
  expect(state.navigate).toHaveBeenCalledTimes(1);
});
test("scrolling and loading another page keeps the first click as the range anchor", async () => {
  state.params = new URLSearchParams("view=sent");
  state.list.mockResolvedValueOnce({ items: ids.map(mail), nextPageToken: "next", missing: 0 });
  await act(async () => root.render(h(MailPage)));
  await clickRow(2);
  const scroller = container.querySelector<HTMLElement>('[role="listbox"]')!;
  scroller.scrollTop = 2000;
  scroller.dispatchEvent(new Event("scroll"));
  state.list.mockResolvedValueOnce({ items: ["seventh", "eighth", "ninth"].map(mail), missing: 0 });
  await act(async () => [...container.querySelectorAll("button")].find(b => b.textContent === "Load more")!.click());
  await clickRow(8, true);
  expect(checkedIndices()).toEqual([2, 3, 4, 5, 6, 7, 8]);
});
test("range anchors do not carry into a different mailbox even when it contains the same threads", async () => {
  await clickRow(1);
  state.params = new URLSearchParams("view=sent");
  await act(async () => root.render(h(MailPage)));
  await clickRow(4, true);
  expect(checkedIndices()).toEqual([4]);
});
test("Shift-mousedown selects mail without selecting the page text", async () => {
  const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true, shiftKey: true });
  options()[4].dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
});
