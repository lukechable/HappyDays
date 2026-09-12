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
vi.mock("../src/lib/hooks", () => ({ useCacheScope: () => "fixture", useMediaQuery: () => false, useStored: (_key: string, value: unknown) => useState(value), useLive: () => ({ data: [], reload: state.reload }) }));
vi.mock("../src/lib/gmail-budget", () => ({ COST: { list: 810, thread: 40 }, gmailRead: (_cost: number, fn: () => Promise<unknown>) => fn() }));
vi.mock("../src/lib/shallow", () => ({ replaceSearch: state.navigate }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: state.error, success: vi.fn() }) }));
vi.mock("../src/components/ui/button", () => ({ Button: ({ children, disabled, onClick, ...props }: { children: React.ReactNode; disabled?: boolean; onClick?: React.MouseEventHandler; "aria-label"?: string }) => h("button", { disabled, onClick, "aria-label": props["aria-label"] }, children) }));
vi.mock("../src/components/primitives", () => ({ Empty: () => null }));
vi.mock("../src/components/mail/folder-list", () => ({ FolderList: () => null, VIEWS: [{ key: "inbox", label: "Inbox" }, { key: "overdue", label: "Overdue" }], SMART_TABS: [], DRAG_MIME: "text/plain" }));
vi.mock("../src/components/mail/context-menu", () => ({ ContextMenu: () => null, MenuItem: () => null, MenuSeparator: () => null, MenuHeading: () => null }));
vi.mock("../src/components/mail/thread-view", () => ({ ThreadView: () => null }));
vi.mock("../src/components/mail/filter-dialog", () => ({ FilterDialog: () => null }));
vi.mock("../src/components/mail/thread-list", () => ({ ThreadList: ({ items, checked, onToggleCheck }: { items: ListItem[]; checked: Set<string>; onToggleCheck: (id: string, shift: boolean) => void }) => h("div", {}, ...items.map(i => h("input", { key: i.gmailThreadId, type: "checkbox", "data-thread": i.gmailThreadId, checked: checked.has(i.gmailThreadId), onChange: () => onToggleCheck(i.gmailThreadId, false) }))) }));
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
