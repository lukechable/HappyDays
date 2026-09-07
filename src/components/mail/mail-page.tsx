"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useAction, useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { PenSquare, Search, RefreshCw, Archive, Trash2, MailOpen, Tag as TagIcon, X, Star, Inbox as InboxIcon, ShieldAlert, FolderInput, ListFilter } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { ListItem, MessageView } from "../../../convex/mail";
import type { Id } from "../../../convex/_generated/dataModel";
import { FolderList, SMART_TABS, DRAG_MIME, type DropTarget, type Label, type ViewKey } from "./folder-list";
import { ContextMenu, MenuItem, MenuSeparator, MenuHeading } from "./context-menu";
import { ThreadList } from "./thread-list";
import { ThreadView, type ThreadData } from "./thread-view";
import { FilterDialog } from "./filter-dialog";
import type { ComposeDraft } from "./compose";
import { quoteHtml, textToHtml, sanitiseForEditor } from "@/lib/sanitise";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/primitives";
import { useLive } from "@/lib/hooks";
import { readLive, subscribeLive, writeLive } from "@/lib/live-cache";
import { mailStore, threadText } from "@/lib/mail-store";
import { replaceSearch } from "@/lib/shallow";
import { cn, errorMessage } from "@/lib/utils";

/** The editor (TipTap, ~150 KB) is only needed when composing, so it stays out of the page's first load. */
const Compose = dynamic(() => import("./compose").then((m) => m.Compose), { ssr: false });

const EMPTY_TEXT: Record<string, string> = { inbox: "Inbox zero.", unread: "Nothing unread.", overdue: "Nothing overdue. Every shared thread has a reply.", assigned: "Nothing assigned to you.", starred: "No starred conversations.", drafts: "No drafts.", search: "No matches in Gmail.", trash: "Trash is empty.", spam: "No spam." };

/**
 * The mail client. Three panes: folders, conversations, reader. Everything shown comes from Gmail at the moment
 * you look; the only thing Happy Days adds is the metadata layer (tags, assignment, replied, matter).
 */
export function MailPage() {
  const params = useSearchParams();
  const me = useQuery(api.users.me);
  const view = (params.get("view") as ViewKey | null) ?? "inbox";
  const labelId = params.get("label") ?? undefined;
  const q = params.get("q") ?? undefined;
  const selectedId = params.get("thread") ?? undefined;
  // Folder, thread and search changes are URL changes; done shallowly so none of them costs a server round trip.
  const setParams = useCallback((next: Record<string, string | undefined>) => replaceSearch("/mail", next), []);

  const listThreads = useAction(api.mail.listThreads);
  const getThread = useAction(api.mail.getThread);
  const modify = useAction(api.mail.modify);
  const markRead = useAction(api.mail.markMessageRead);
  const labelsLive = useLive(api.mail.labels, me?.google?.status === "connected" ? {} : "skip", { ttlMs: 300_000 });
  const reportSent = useMutation(api.files.reportSentByEmail);
  const updatePrefs = useMutation(api.users.updatePrefs);
  const [paneOverride, setPaneOverride] = useState<"below" | "right" | null>(null);

  const connected = me?.google?.status === "connected";
  const listKey = JSON.stringify({ view, labelId, q, connected });
  const [list, setList] = useState<{ key: string; items: ListItem[]; nextToken?: string; error?: string; missing: number; tick: number }>({ key: "", items: [], missing: 0, tick: 0 });
  const [tick, setTick] = useState(0);
  const [appending, setAppending] = useState(false);
  const labels = labelsLive.data as Label[] | undefined;
  const [threadState, setThreadState] = useState<{ id: string; thread?: ThreadData; error?: string }>({ id: "" });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState(0);
  const [compose, setCompose] = useState<ComposeDraft | null>(null);
  const [searchText, setSearchText] = useState(q ?? "");
  const lastChecked = useRef<string | null>(null);
  const listCacheKey = `mail:list:${listKey}`;
  const cachedList = useSyncExternalStore(subscribeLive, () => readLive<{ items: ListItem[]; nextToken?: string; missing: number }>(listCacheKey), () => readLive<{ items: ListItem[]; nextToken?: string; missing: number }>(""));
  const listFresh = list.key === listKey && list.tick === tick;
  const items = list.key === listKey ? list.items : cachedList.data?.items ?? [];
  const nextToken = listFresh ? list.nextToken : cachedList.data?.nextToken;
  const listLoading = connected && !listFresh && !cachedList.data;
  const listError = listFresh ? list.error : undefined;
  const missing = listFresh ? list.missing : cachedList.data?.missing ?? 0;
  const thread = threadState.id === selectedId ? threadState.thread : undefined;
  const threadError = threadState.id === selectedId ? threadState.error : undefined;
  const threadLoading = !!selectedId && threadState.id !== selectedId;
  const setItems = (fn: (cur: ListItem[]) => ListItem[]) => setList((cur) => { const next = { ...cur, key: listKey, items: fn(cur.key === listKey ? cur.items : items) }; writeLive(listCacheKey, { data: { items: next.items, nextToken: next.nextToken, missing: next.missing } }); return next; });
  const setThread = (t: ThreadData | undefined) => setThreadState((cur) => ({ ...cur, thread: t }));

  const meta = useQuery(api.mail.meta, connected && items.length ? { gmailThreadIds: items.map((i) => i.gmailThreadId) } : "skip") ?? {};
  const signatures = useQuery(api.signaturesEmail.mine);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const loadMore = async () => {
    if (!connected || !nextToken || appending) return;
    setAppending(true);
    try { const r = await listThreads({ view, labelId, q, pageToken: nextToken }); setList((cur) => ({ ...cur, items: [...cur.items, ...r.items], nextToken: r.nextPageToken })); }
    catch (e) { toast.error(errorMessage(e)); }
    finally { setAppending(false); }
  };

  const refreshLabels = labelsLive.reload;

  // Device copy → memory: the list appears instantly even after a browser restart.
  useEffect(() => {
    if (!connected || readLive(listCacheKey).data) return;
    let live = true;
    void mailStore.getList<ListItem>(listCacheKey).then((r) => { if (live && r && !readLive(listCacheKey).data) writeLive(listCacheKey, { data: { items: r.items, nextToken: r.nextToken, missing: r.missing }, fetchedAt: 0 }); });
    return () => { live = false; };
  }, [connected, listCacheKey]);

  // Gmail push landed (the account's last sync moved): refresh the list we are looking at, quietly.
  const lastSyncAt = me?.google?.lastSyncAt;
  const lastSeenSync = useRef(lastSyncAt);
  useEffect(() => { if (lastSyncAt && lastSeenSync.current && lastSyncAt !== lastSeenSync.current) setTick((t) => t + 1); lastSeenSync.current = lastSyncAt; }, [lastSyncAt]);

  useEffect(() => {
    if (!connected) return;
    // A list seen in the last minute is shown as is; older ones show instantly and refresh behind the scenes.
    const cached = readLive<{ items: ListItem[] }>(listCacheKey);
    if (tick === 0 && cached.fetchedAt && Date.now() - cached.fetchedAt < 60_000) return; // shown from the cache already
    // The shell may already be fetching this list (Prefetch); show its result rather than asking Gmail twice.
    if (tick === 0 && cached.inflight) { let live = true; void cached.inflight.then(() => { if (live && !readLive(listCacheKey).fetchedAt) setTick((t) => t + 1); }); return () => { live = false; }; }
    let live = true;
    const args = JSON.parse(listKey) as { view: ViewKey; labelId?: string; q?: string };
    listThreads({ view: args.view, labelId: args.labelId, q: args.q }).then((r) => {
      if (!live) return;
      const data = { items: r.items, nextToken: r.nextPageToken, missing: r.missing ?? 0 };
      writeLive(listCacheKey, { data, fetchedAt: Date.now() });
      if (args.view !== "search") void mailStore.putList(listCacheKey, { ...data, fetchedAt: Date.now() });
      setList({ key: listKey, items: r.items, nextToken: r.nextPageToken, missing: r.missing ?? 0, tick }); setChecked(new Set()); setFocused(0);
      // Warm the first few conversations so opening them is instant.
      const warm = r.items.slice(0, 6);
      (async () => { for (const it of warm) { if (!live) return; if (await mailStore.hasThread(it.gmailThreadId)) continue; try { const t = await getThread({ gmailThreadId: it.gmailThreadId }); writeLive(`mail:thread:${it.gmailThreadId}`, { data: t, fetchedAt: Date.now() }); await mailStore.putThread(it.gmailThreadId, t, threadText(t)); } catch { /* skip */ } await new Promise((res) => setTimeout(res, 400)); } })();
    }).catch((e: unknown) => { if (live) setList({ key: listKey, items: cached.data?.items ?? [], error: errorMessage(e), missing: 0, tick }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey, tick, connected, listThreads]);

  // Fetch the editor chunk in the background so Compose and Reply open without a wait.
  useEffect(() => { const t = setTimeout(() => { void import("./compose"); }, 2000); return () => clearTimeout(t); }, []);

  // Other pages (PDF tools, Files) hand a prepared message over via sessionStorage and ?compose=handoff.
  useEffect(() => {
    if (params.get("compose") !== "handoff") return;
    try {
      const raw = sessionStorage.getItem("hd-compose");
      if (raw) { const d = JSON.parse(raw) as ComposeDraft; sessionStorage.removeItem("hd-compose"); setTimeout(() => setCompose({ ...d, mode: d.mode ?? "new", to: d.to ?? [], cc: d.cc ?? [], bcc: d.bcc ?? [] }), 0); }
    } catch { /* ignore */ }
    setParams({ compose: undefined });
  }, [params, setParams]);

  useEffect(() => {
    if (!selectedId || !connected) return;
    let live = true;
    const cachedThread = readLive<ThreadData>(`mail:thread:${selectedId}`);
    const useCached = cachedThread.data && cachedThread.fetchedAt && Date.now() - cachedThread.fetchedAt < 120_000;
    const fromDevice = async () => { const d = await mailStore.getThread<ThreadData>(selectedId); if (d && live) setThreadState({ id: selectedId, thread: d.data }); return d; };
    (useCached ? Promise.resolve(cachedThread.data as ThreadData) : fromDevice().then(async (d) => { const t = await getThread({ gmailThreadId: selectedId }); if (!d || JSON.stringify(d.data.messages.map((m) => m.gmailMessageId)) !== JSON.stringify(t.messages.map((m) => m.gmailMessageId)) || d.data.labelIds.join() !== t.labelIds.join()) void mailStore.putThread(selectedId, t, threadText(t)); return t; })).then((t) => {
      if (!live) return;
      if (!useCached) writeLive(`mail:thread:${selectedId}`, { data: t, fetchedAt: Date.now() });
      setThreadState({ id: selectedId, thread: t });
      const unread = t.messages.filter((m) => m.unread).map((m) => m.gmailMessageId);
      if (unread.length) { void markRead({ gmailMessageIds: unread, read: true }); setList((cur) => ({ ...cur, items: cur.items.map((i) => (i.gmailThreadId === selectedId ? { ...i, unread: false } : i)) })); }
    }).catch((e: unknown) => { if (live) setThreadState({ id: selectedId, error: errorMessage(e) }); });
    return () => { live = false; };
  }, [selectedId, connected, getThread, markRead]);

  const toggleCheck = (id: string, shift: boolean) => {
    setChecked((s) => {
      const n = new Set(s);
      if (shift && lastChecked.current) { const a = items.findIndex((i) => i.gmailThreadId === lastChecked.current); const b = items.findIndex((i) => i.gmailThreadId === id); if (a >= 0 && b >= 0) for (let i = Math.min(a, b); i <= Math.max(a, b); i++) n.add(items[i].gmailThreadId); }
      else if (n.has(id)) n.delete(id); else n.add(id);
      lastChecked.current = id;
      return n;
    });
  };

  const open = (id: string) => { setParams({ thread: id }); const i = items.findIndex((x) => x.gmailThreadId === id); if (i >= 0) setFocused(i); };
  const closeThread = () => { setParams({ thread: undefined }); };

  const act = async (ids: string[], op: "archive" | "unarchive" | "trash" | "untrash" | "star" | "unstar" | "unread" | "spam" | "labels", payload?: { add: string[]; remove: string[] }) => {
    if (!ids.length) return;
    const removeFromList = op === "archive" || op === "trash" || op === "spam" || (op === "unarchive" && view === "archive") || (op === "untrash" && view === "trash");
    const prev = list;
    if (removeFromList) { setItems((cur) => cur.filter((i) => !ids.includes(i.gmailThreadId))); if (ids.includes(selectedId ?? "")) closeThread(); }
    if (op === "star" || op === "unstar") setItems((cur) => cur.map((i) => (ids.includes(i.gmailThreadId) ? { ...i, starred: op === "star" } : i)));
    if (op === "unread") { setItems((cur) => cur.map((i) => (ids.includes(i.gmailThreadId) ? { ...i, unread: true } : i))); if (ids.includes(selectedId ?? "")) closeThread(); }
    try {
      if (op === "archive") await modify({ gmailThreadIds: ids, remove: ["INBOX"] });
      else if (op === "unarchive") await modify({ gmailThreadIds: ids, add: ["INBOX"], remove: ["TRASH", "SPAM"] });
      else if (op === "trash") await modify({ gmailThreadIds: ids, op: view === "trash" ? "deleteForever" : "trash" });
      else if (op === "untrash") await modify({ gmailThreadIds: ids, op: "untrash" });
      else if (op === "star") await modify({ gmailThreadIds: ids, add: ["STARRED"] });
      else if (op === "unstar") await modify({ gmailThreadIds: ids, remove: ["STARRED"] });
      else if (op === "unread") await modify({ gmailThreadIds: ids, add: ["UNREAD"] });
      else if (op === "spam") await modify({ gmailThreadIds: ids, add: ["SPAM"], remove: ["INBOX"] });
      else if (op === "labels" && payload) {
        await modify({ gmailThreadIds: ids, add: payload.add, remove: payload.remove });
        if (thread && ids.includes(thread.gmailThreadId)) setThread({ ...thread, labelIds: [...thread.labelIds.filter((l) => !payload.remove.includes(l)), ...payload.add] });
        const leaves = (view === "label" && labelId && payload.remove.includes(labelId)) || (payload.remove.includes("INBOX") && (view === "inbox" || view === "unread" || view.startsWith("smart:")));
        if (leaves) { setItems((cur) => cur.filter((i) => !ids.includes(i.gmailThreadId))); if (ids.includes(selectedId ?? "")) closeThread(); }
        else setItems((cur) => cur.map((i) => (ids.includes(i.gmailThreadId) ? { ...i, labelIds: [...i.labelIds.filter((l) => !payload.remove.includes(l)), ...payload.add] } : i)));
        refreshLabels();
      }
      setChecked(new Set());
      if (op === "trash" && view === "trash") toast.success("Deleted forever");
    } catch (e) { setList(prev); toast.error(errorMessage(e)); }
  };

  /** "Move to folder": add the label and take the conversation out of the inbox, the way Gmail's Move to works. */
  const moveTo = async (ids: string[], label: Label) => {
    await act(ids, "labels", { add: [label.id], remove: ["INBOX"] });
    toast.success(ids.length === 1 ? `Moved to ${label.name}` : `Moved ${ids.length} conversations to ${label.name}`);
  };
  const onDropThreads = (target: DropTarget, ids: string[]) => {
    if (target.labelId) { const l = labels?.find((x) => x.id === target.labelId); if (l) void moveTo(ids, l); return; }
    switch (target.view) {
      case "inbox": void act(ids, "unarchive"); break;
      case "starred": void act(ids, "star"); break;
      case "archive": void act(ids, "archive"); break;
      case "spam": void act(ids, "spam"); break;
      case "trash": void act(ids, "trash"); break;
    }
  };
  const onDragStart = (e: React.DragEvent, item: ListItem) => {
    const ids = checked.has(item.gmailThreadId) ? Array.from(checked) : [item.gmailThreadId];
    e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids));
    e.dataTransfer.effectAllowed = "move";
    const ghost = document.createElement("div");
    ghost.className = "fixed left-[-9999px] top-0 max-w-[280px] truncate rounded-lg bg-foreground px-3 py-1.5 text-xs font-medium text-background shadow-float";
    ghost.textContent = ids.length === 1 ? item.subject || "(no subject)" : `${ids.length} conversations`;
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 14, 14);
    setTimeout(() => ghost.remove(), 0);
  };
  const [menu, setMenu] = useState<{ x: number; y: number; ids: string[]; item: ListItem } | null>(null);
  const [menuQ, setMenuQ] = useState("");
  const [filterFor, setFilterFor] = useState<{ ids: string[]; item: ListItem } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const onContextMenu = (e: React.MouseEvent, item: ListItem) => {
    e.preventDefault();
    const ids = checked.has(item.gmailThreadId) ? Array.from(checked) : [item.gmailThreadId];
    setMenuQ("");
    setMenu({ x: e.clientX, y: e.clientY, ids, item });
  };
  const menuFolders = (labels ?? []).filter((l) => l.type === "user" && !l.hidden && l.name.toLowerCase().includes(menuQ.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name));

  const startCompose = (mode: "reply" | "replyAll" | "forward", m: MessageView) => {
    if (!thread || !me) return;
    const myEmail = me.google?.email ?? me.email;
    const bodyHtml = sanitiseForEditor(m.html ?? textToHtml(m.text ?? ""));
    const fromLabel = `${m.from.name} <${m.from.email}>`;
    if (mode === "forward") {
      setCompose({ mode, to: [], cc: [], bcc: [], subject: /^fwd?:/i.test(m.subject) ? m.subject : `Fwd: ${m.subject}`, html: quoteHtml({ from: fromLabel, date: m.date, to: m.to.map((a) => a.email).join(", "), subject: m.subject, html: bodyHtml, mode: "forward" }), gmailThreadId: thread.gmailThreadId, references: [...m.references, m.rfcMessageId].filter(Boolean), forwardAttachments: m.attachments.filter((a) => a.attachmentId && !a.inline).map((a) => ({ gmailMessageId: m.gmailMessageId, attachmentId: a.attachmentId, filename: a.filename, mime: a.mime, size: a.size })), sourceText: m.text ?? m.snippet, sourceFrom: fromLabel });
      return;
    }
    const replyTo = m.replyTo ? [{ name: m.from.name, email: m.replyTo.replace(/.*<([^>]+)>.*/, "$1").toLowerCase() }] : [m.from];
    const to = m.fromMe ? m.to : replyTo;
    const cc = mode === "replyAll" ? [...(m.fromMe ? [] : m.to), ...m.cc].filter((a) => a.email !== myEmail && !to.some((t) => t.email === a.email)).filter((a, i, arr) => arr.findIndex((b) => b.email === a.email) === i) : [];
    setCompose({ mode, to, cc, bcc: [], subject: /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`, html: quoteHtml({ from: fromLabel, date: m.date, html: bodyHtml, mode: "reply" }), gmailThreadId: thread.gmailThreadId, inReplyTo: m.rfcMessageId, references: [...m.references, m.rfcMessageId].filter(Boolean), sourceText: m.text ?? m.snippet, sourceFrom: fromLabel, matterId: meta[thread.gmailThreadId]?.matter?._id });
  };

  // Keyboard shortcuts, Gmail-style.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (compose || e.metaKey || e.ctrlKey || e.altKey || t.closest("input, textarea, [contenteditable=true], [role=dialog]")) return;
      const cur = items[focused];
      const key = e.key;
      if (key === "j" || key === "ArrowDown") { e.preventDefault(); setFocused((f) => Math.min(items.length - 1, f + 1)); }
      else if (key === "k" || key === "ArrowUp") { e.preventDefault(); setFocused((f) => Math.max(0, f - 1)); }
      else if (key === "Enter" && cur) open(cur.gmailThreadId);
      else if (key === "Escape") closeThread();
      else if (key === "c") { e.preventDefault(); setCompose({ mode: "new", to: [], cc: [], bcc: [], subject: "", html: "" }); }
      else if (key === "/") { e.preventDefault(); document.getElementById("mail-search")?.focus(); }
      else if (key === "e" && (selectedId || cur)) void act(selectedId ? [selectedId] : [cur!.gmailThreadId], "archive");
      else if (key === "#" && (selectedId || cur)) void act(selectedId ? [selectedId] : [cur!.gmailThreadId], "trash");
      else if (key === "s" && cur) void act([cur.gmailThreadId], cur.starred ? "unstar" : "star");
      else if (key === "u" && (selectedId || cur)) void act(selectedId ? [selectedId] : [cur!.gmailThreadId], "unread");
      else if (key === "x" && cur) toggleCheck(cur.gmailThreadId, false);
      else if ((key === "r" || key === "a" || key === "f") && thread) { const last = thread.messages.filter((m) => !m.isDraft).at(-1); if (last) startCompose(key === "r" ? "reply" : key === "a" ? "replyAll" : "forward", last); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // intentionally re-bound every render: handlers close over fresh state

  // Local search: instant matches from the device copy while typing; Enter still runs the Gmail search.
  const [localSearch, setLocalSearch] = useState<{ q: string; hits: Array<{ id: string; text: string }> }>({ q: "", hits: [] });
  const localHits = localSearch.q === searchText.trim() ? localSearch.hits : [];
  useEffect(() => {
    const q2 = searchText.trim(); if (q2.length < 2) return;
    let live = true; const t = setTimeout(() => { void mailStore.search(q2, 20).then((h) => { if (live) setLocalSearch({ q: q2, hits: h }); }); }, 150);
    return () => { live = false; clearTimeout(t); };
  }, [searchText]);

  const defaultSignature = useMemo(() => { if (!signatures || !compose) return undefined; return (compose.mode === "new" ? signatures.find((s) => s.isDefaultNew) : signatures.find((s) => s.isDefaultReply))?.html ?? signatures[0]?.html; }, [signatures, compose]);

  const title = view === "label" ? labels?.find((l) => l.id === labelId)?.name ?? "Folder" : view === "search" ? `Search: ${q}` : view.startsWith("smart:") ? "Smart inbox" : view.charAt(0).toUpperCase() + view.slice(1).replace(/([A-Z])/g, " $1");

  if (me && !connected) {
    return <div className="p-8"><Empty title="Connect Gmail to use mail" body={me.google?.status === "needs_reauth" ? "Google revoked access. Reconnect from Settings and everything comes back." : "Happy Days reads and sends through your own Google Workspace account. Nothing is copied."} action={<Button render={<Link href="/settings?tab=google" />}>Open Settings</Button>} /></div>;
  }

  const selectedIds = checked.size ? Array.from(checked) : selectedId ? [selectedId] : [];
  // Reading pane under the list (Outlook's default) unless this user has moved it to the right. Saved per user.
  const pane = paneOverride ?? me?.prefs.readingPane ?? "below";
  const togglePane = () => { const next = pane === "below" ? "right" : "below"; setPaneOverride(next); updatePrefs({ prefs: { readingPane: next } }).catch((e: unknown) => toast.error(errorMessage(e))); };

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:h-[calc(100svh-48px)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Button size="sm" onClick={() => setCompose({ mode: "new", to: [], cc: [], bcc: [], subject: "", html: "" })}><PenSquare className="size-3.5" />Compose</Button>
        <form className="relative min-w-0 flex-1 max-w-xl" onSubmit={(e) => { e.preventDefault(); if (searchText.trim()) setParams({ view: "search", q: searchText.trim(), thread: undefined, label: undefined }); else setParams({ view: "inbox", q: undefined }); }}>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-quaternary" />
          <input id="mail-search" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search all mail (Gmail syntax works: from:, has:attachment, newer_than:7d)" className="h-8 w-full rounded-full border border-border bg-card pl-8 pr-8 text-sm outline-none focus:border-input" />
          {q && <button type="button" onClick={() => { setSearchText(""); setParams({ view: "inbox", q: undefined, thread: undefined }); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-tertiary" aria-label="Clear search"><X className="size-3.5" /></button>}
          {localHits.length > 0 && searchText.trim() !== q && (
            <div className="absolute left-0 top-full z-30 mt-1 w-full rounded-xl bg-popover p-1 shadow-md ring-1 ring-border">
              <div className="px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-fg-tertiary">On this device · Enter to search all of Gmail</div>
              {localHits.slice(0, 8).map((h) => { const line = h.text.split("\n")[0]; return <button key={h.id} type="button" onMouseDown={(e) => { e.preventDefault(); setParams({ thread: h.id }); setSearchText(""); }} className="block w-full truncate rounded-md px-2 py-1 text-left text-[13px] hover:bg-muted">{line}</button>; })}
            </div>
          )}
        </form>
        {checked.size > 0 && (
          <div className="flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs">
            <span className="num px-1 font-medium">{checked.size} selected</span>
            <Button size="xs" variant="ghost" onClick={() => act(selectedIds, "archive")}><Archive className="size-3.5" />Archive</Button>
            <Button size="xs" variant="ghost" onClick={() => act(selectedIds, "trash")}><Trash2 className="size-3.5" />Delete</Button>
            <Button size="xs" variant="ghost" onClick={() => act(selectedIds, "unread")}><MailOpen className="size-3.5" />Unread</Button>
            <Button size="xs" variant="ghost" onClick={() => setChecked(new Set())}><X className="size-3.5" /></Button>
          </div>
        )}
        <Button size="sm" variant="ghost" onClick={() => { reload(); refreshLabels(); }} aria-label="Refresh" title="Refresh"><RefreshCw className={cn("size-3.5", listLoading && "animate-spin")} /></Button>
        <Button size="sm" variant="ghost" className="hd-press hidden lg:inline-flex" onClick={togglePane} aria-label={pane === "below" ? "Move the reading pane to the right" : "Move the reading pane below the list"} title={pane === "below" ? "Reading pane: below the list. Click for right." : "Reading pane: on the right. Click for below."}><ReadingPaneIcon pane={pane} /></Button>
      </div>

      <div className={cn("grid min-h-0 flex-1 grid-cols-1", pane === "right" ? "lg:grid-cols-[200px_minmax(320px,400px)_minmax(0,1fr)]" : "lg:grid-cols-[200px_minmax(0,1fr)]")}>
        <aside className="hidden min-h-0 border-r border-border bg-surface-2/60 lg:block"><FolderList view={view} labelId={labelId} labels={labels} badges={{ overdue: me?.badges.overdue ?? 0, assigned: me?.badges.assigned ?? 0 }} onSelect={(v, l) => { setParams({ view: v === "inbox" ? undefined : v, label: l, q: undefined, thread: undefined }); }} onLabelsChanged={refreshLabels} onDropThreads={onDropThreads} /></aside>
        <div className={cn("contents", pane === "below" && "lg:grid lg:min-h-0 lg:grid-rows-[minmax(0,7fr)_minmax(0,13fr)]")}>
        <section key={`list-${pane}`} className={cn("flex min-h-0 flex-col", pane === "right" ? "border-r border-border" : "lg:min-h-0 lg:border-b lg:border-border", selectedId && "hidden lg:flex")}>
          <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5">
            <span className="truncate text-[13px] font-medium">{title}</span>
            {missing > 0 && <span className="text-[11px] text-fg-tertiary" title="These threads exist only in the other mailbox">{missing} not in your mailbox</span>}
            <label className="ml-auto flex items-center gap-1 text-[11px] text-fg-tertiary"><input type="checkbox" className="size-3.5 accent-foreground" checked={items.length > 0 && checked.size === items.length} onChange={(e) => setChecked(e.target.checked ? new Set(items.map((i) => i.gmailThreadId)) : new Set())} />all</label>
          </div>
          {view.startsWith("smart:") && (
            <div className="flex shrink-0 gap-1 border-b border-border px-2 py-1">
              {SMART_TABS.map((t) => <button key={t.key} type="button" onClick={() => setParams({ view: t.key, thread: undefined })} className={cn("rounded-full px-2.5 py-0.5 text-xs", view === t.key ? "bg-foreground text-background" : "text-fg-secondary hover:bg-muted")}>{t.label}</button>)}
            </div>
          )}
          <div className="min-h-0 flex-1">
            <ThreadList layout={pane === "below" ? "table" : "column"} items={items} meta={meta} selectedId={selectedId} focusedIndex={focused} checked={checked} onOpen={open} onToggleCheck={toggleCheck} onStar={(i) => act([i.gmailThreadId], i.starred ? "unstar" : "star")} loading={listLoading || appending} error={listError} hasMore={!!nextToken} onMore={() => void loadMore()} emptyText={EMPTY_TEXT[view] ?? "Nothing here."} myFirst={me?.first} labels={labels} onContextMenu={onContextMenu} onDragStart={onDragStart} />
          </div>
        </section>
        {/* Below (Outlook's layout): the list is a table across the top 35%, the reading pane fills the rest. Right: a column. */}
        <section key={`pane-${pane}`} className={cn("min-h-0 bg-surface/60", pane === "below" ? "hd-slide-up" : "hd-slide-left", !selectedId && "hidden lg:block")}>
          <ThreadView thread={selectedId ? thread : undefined} meta={selectedId ? meta[selectedId] : undefined} labels={labels ?? []} loading={threadLoading} error={threadError} myFirst={me?.first} showImagesDefault={me?.prefs.showImages ?? false} onAction={(op, payload) => selectedId && act([selectedId], op, payload)} onReply={startCompose} onClose={closeThread} />
        </section>
        </div>
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={closeMenu}>
          <MenuHeading>{menu.ids.length === 1 ? "Conversation" : `${menu.ids.length} conversations`}</MenuHeading>
          <div className="px-1 pb-1"><input autoFocus value={menuQ} onChange={(e) => setMenuQ(e.target.value)} placeholder="Move to folder…" className="h-7 w-full rounded-md border border-input bg-card px-2 text-xs" onKeyDown={(e) => { if (e.key === "Enter" && menuFolders[0]) { void moveTo(menu.ids, menuFolders[0]); closeMenu(); } }} /></div>
          <div className="max-h-44 overflow-y-auto [scrollbar-width:thin]">
            {menuFolders.length === 0 && <p className="px-2 py-1.5 text-xs text-fg-tertiary">{labels?.some((l) => l.type === "user") ? "No folder matches." : "No folders yet."}</p>}
            {menuFolders.map((l) => <MenuItem key={l.id} icon={FolderInput} onSelect={() => { void moveTo(menu.ids, l); closeMenu(); }}><span className="inline-flex items-center gap-1.5"><span className="inline-block size-2 rounded-full" style={{ background: l.color?.backgroundColor ?? "var(--fg-quaternary)" }} />{l.name}</span></MenuItem>)}
          </div>
          <MenuSeparator />
          {menu.item.labelIds.includes("INBOX") ? <MenuItem icon={Archive} onSelect={() => { void act(menu.ids, "archive"); closeMenu(); }} shortcut="e">Archive</MenuItem> : <MenuItem icon={InboxIcon} onSelect={() => { void act(menu.ids, "unarchive"); closeMenu(); }}>Move to inbox</MenuItem>}
          <MenuItem icon={Star} onSelect={() => { void act(menu.ids, menu.item.starred ? "unstar" : "star"); closeMenu(); }} shortcut="s">{menu.item.starred ? "Unstar" : "Star"}</MenuItem>
          <MenuItem icon={MailOpen} onSelect={() => { void act(menu.ids, "unread"); closeMenu(); }} shortcut="u">Mark unread</MenuItem>
          <MenuItem icon={ListFilter} onSelect={() => { setFilterFor({ ids: menu.ids, item: menu.item }); closeMenu(); }}>Filter messages like these…</MenuItem>
          <MenuItem icon={ShieldAlert} onSelect={() => { void act(menu.ids, "spam"); closeMenu(); }}>Report spam</MenuItem>
          <MenuItem icon={Trash2} onSelect={() => { void act(menu.ids, "trash"); closeMenu(); }} shortcut="#" danger>{view === "trash" ? "Delete forever" : "Move to trash"}</MenuItem>
        </ContextMenu>
      )}
      {filterFor && <FilterDialog item={filterFor.item} ids={filterFor.ids} myEmail={me?.email} folders={(labels ?? []).filter((l) => l.type === "user" && !l.hidden).sort((a, b) => a.name.localeCompare(b.name))} onSearch={(fq) => { setSearchText(fq); setParams({ view: "search", q: fq, thread: undefined, label: undefined }); }} onMove={moveTo} onClose={() => setFilterFor(null)} />}
      {compose && signatures !== undefined && <Compose key={`${compose.mode}-${compose.inReplyTo ?? compose.draftId ?? "new"}`} draft={compose} signatureHtml={defaultSignature} signatureAbove={me?.prefs.signatureAbove ?? true} onClose={() => setCompose(null)} onSent={(r) => { const matterId = compose.matterId; setCompose(null); reload(); if (selectedId) getThread({ gmailThreadId: selectedId }).then(setThread).catch(() => undefined); if (matterId && r.attachments > 0) toast("Was that the report?", { description: "Mark the matter’s report as delivered by email.", action: { label: "Yes, delivered", onClick: () => reportSent({ matterId: matterId as Id<"matters"> }).then(() => toast.success("Marked delivered")).catch((e: unknown) => toast.error(errorMessage(e))) } }); }} />}
      {view === "search" && q && <span className="sr-only">Showing Gmail results for {q}</span>}
      <TagIcon className="hidden" />
    </div>
  );
}

/**
 * The split-panel glyph from the Claude desktop app: a rounded square with one divider. The divider turns a
 * quarter turn between upright (reading pane on the right) and flat (reading pane below), so the icon always shows
 * the layout that is on screen and the change reads as one motion.
 */
function ReadingPaneIcon({ pane }: { pane: "below" | "right" }) {
  return (
    <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="3.5" />
      <line x1="12" y1="3" x2="12" y2="21" className="hd-pane-divider" style={{ transform: pane === "below" ? "rotate(90deg)" : "rotate(0deg)" }} />
    </svg>
  );
}
