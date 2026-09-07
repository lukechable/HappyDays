"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAction, useMutation, useQuery } from "convex/react";
import { PenSquare, Search, RefreshCw, Archive, Trash2, MailOpen, Tag as TagIcon, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { ListItem, MessageView } from "../../../convex/mail";
import type { Id } from "../../../convex/_generated/dataModel";
import { FolderList, SMART_TABS, type Label, type ViewKey } from "./folder-list";
import { ThreadList } from "./thread-list";
import { ThreadView, type ThreadData } from "./thread-view";
import { Compose, type ComposeDraft } from "./compose";
import { quoteHtml, textToHtml, sanitiseForEditor } from "@/lib/sanitise";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/primitives";
import { cn, errorMessage } from "@/lib/utils";

const EMPTY_TEXT: Record<string, string> = { inbox: "Inbox zero.", unread: "Nothing unread.", overdue: "Nothing overdue. Every shared thread has a reply.", assigned: "Nothing assigned to you.", starred: "No starred conversations.", drafts: "No drafts.", search: "No matches in Gmail.", trash: "Trash is empty.", spam: "No spam." };

/**
 * The mail client. Three panes: folders, conversations, reader. Everything shown comes from Gmail at the moment
 * you look; the only thing Happy Days adds is the metadata layer (tags, assignment, replied, matter).
 */
export function MailPage() {
  const params = useSearchParams();
  const router = useRouter();
  const me = useQuery(api.users.me);
  const view = (params.get("view") as ViewKey | null) ?? "inbox";
  const labelId = params.get("label") ?? undefined;
  const q = params.get("q") ?? undefined;
  const selectedId = params.get("thread") ?? undefined;
  const setParams = useCallback((next: Record<string, string | undefined>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(next)) { if (v === undefined || v === "") p.delete(k); else p.set(k, v); }
    router.replace(`/mail${p.size ? `?${p}` : ""}`, { scroll: false });
  }, [params, router]);

  const listThreads = useAction(api.mail.listThreads);
  const getThread = useAction(api.mail.getThread);
  const modify = useAction(api.mail.modify);
  const markRead = useAction(api.mail.markMessageRead);
  const labelsAction = useAction(api.mail.labels);
  const reportSent = useMutation(api.files.reportSentByEmail);

  const connected = me?.google?.status === "connected";
  const listKey = JSON.stringify({ view, labelId, q, connected });
  const [list, setList] = useState<{ key: string; items: ListItem[]; nextToken?: string; error?: string; missing: number; tick: number }>({ key: "", items: [], missing: 0, tick: 0 });
  const [tick, setTick] = useState(0);
  const [appending, setAppending] = useState(false);
  const [labels, setLabels] = useState<Label[] | undefined>();
  const [threadState, setThreadState] = useState<{ id: string; thread?: ThreadData; error?: string }>({ id: "" });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [focused, setFocused] = useState(0);
  const [compose, setCompose] = useState<ComposeDraft | null>(null);
  const [searchText, setSearchText] = useState(q ?? "");
  const lastChecked = useRef<string | null>(null);
  const listFresh = list.key === listKey && list.tick === tick;
  const items = list.key === listKey ? list.items : [];
  const nextToken = listFresh ? list.nextToken : undefined;
  const listLoading = connected && !listFresh;
  const listError = listFresh ? list.error : undefined;
  const missing = listFresh ? list.missing : 0;
  const thread = threadState.id === selectedId ? threadState.thread : undefined;
  const threadError = threadState.id === selectedId ? threadState.error : undefined;
  const threadLoading = !!selectedId && threadState.id !== selectedId;
  const setItems = (fn: (cur: ListItem[]) => ListItem[]) => setList((cur) => ({ ...cur, items: fn(cur.items) }));
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

  const refreshLabels = useCallback(() => { if (connected) labelsAction({}).then(setLabels).catch(() => undefined); }, [connected, labelsAction]);

  useEffect(() => {
    if (!connected) return;
    let live = true;
    const args = JSON.parse(listKey) as { view: ViewKey; labelId?: string; q?: string };
    listThreads({ view: args.view, labelId: args.labelId, q: args.q }).then((r) => { if (!live) return; setList({ key: listKey, items: r.items, nextToken: r.nextPageToken, missing: r.missing ?? 0, tick }); setChecked(new Set()); setFocused(0); }).catch((e: unknown) => { if (live) setList({ key: listKey, items: [], error: errorMessage(e), missing: 0, tick }); });
    return () => { live = false; };
  }, [listKey, tick, connected, listThreads]);
  useEffect(() => { refreshLabels(); }, [refreshLabels]);

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
    getThread({ gmailThreadId: selectedId }).then((t) => {
      if (!live) return;
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
      else if (op === "labels" && payload) { await modify({ gmailThreadIds: ids, add: payload.add, remove: payload.remove }); if (thread && ids.includes(thread.gmailThreadId)) setThread({ ...thread, labelIds: [...thread.labelIds.filter((l) => !payload.remove.includes(l)), ...payload.add] }); if (view === "label" && labelId && payload.remove.includes(labelId)) setItems((cur) => cur.filter((i) => !ids.includes(i.gmailThreadId))); refreshLabels(); }
      setChecked(new Set());
      if (op === "trash" && view === "trash") toast.success("Deleted forever");
    } catch (e) { setList(prev); toast.error(errorMessage(e)); }
  };

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

  const defaultSignature = useMemo(() => { if (!signatures || !compose) return undefined; return (compose.mode === "new" ? signatures.find((s) => s.isDefaultNew) : signatures.find((s) => s.isDefaultReply))?.html ?? signatures[0]?.html; }, [signatures, compose]);

  const title = view === "label" ? labels?.find((l) => l.id === labelId)?.name ?? "Folder" : view === "search" ? `Search: ${q}` : view.startsWith("smart:") ? "Smart inbox" : view.charAt(0).toUpperCase() + view.slice(1).replace(/([A-Z])/g, " $1");

  if (me && !connected) {
    return <div className="p-8"><Empty title="Connect Gmail to use mail" body={me.google?.status === "needs_reauth" ? "Google revoked access. Reconnect from Settings and everything comes back." : "Happy Days reads and sends through your own Google Workspace account. Nothing is copied."} action={<Button render={<Link href="/settings?tab=google" />}>Open Settings</Button>} /></div>;
  }

  const selectedIds = checked.size ? Array.from(checked) : selectedId ? [selectedId] : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:h-[calc(100svh-56px)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Button size="sm" onClick={() => setCompose({ mode: "new", to: [], cc: [], bcc: [], subject: "", html: "" })}><PenSquare className="size-3.5" />Compose</Button>
        <form className="relative min-w-0 flex-1 max-w-xl" onSubmit={(e) => { e.preventDefault(); if (searchText.trim()) setParams({ view: "search", q: searchText.trim(), thread: undefined, label: undefined }); else setParams({ view: "inbox", q: undefined }); }}>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-quaternary" />
          <input id="mail-search" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search all mail (Gmail syntax works: from:, has:attachment, newer_than:7d)" className="h-8 w-full rounded-full border border-border bg-card pl-8 pr-8 text-sm outline-none focus:border-input" />
          {q && <button type="button" onClick={() => { setSearchText(""); setParams({ view: "inbox", q: undefined, thread: undefined }); }} className="absolute right-2 top-1/2 -translate-y-1/2 text-fg-tertiary" aria-label="Clear search"><X className="size-3.5" /></button>}
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
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[200px_minmax(320px,400px)_minmax(0,1fr)]">
        <aside className="hidden min-h-0 border-r border-border bg-surface-2/60 lg:block"><FolderList view={view} labelId={labelId} labels={labels} badges={{ overdue: me?.badges.overdue ?? 0, assigned: me?.badges.assigned ?? 0 }} onSelect={(v, l) => { setParams({ view: v === "inbox" ? undefined : v, label: l, q: undefined, thread: undefined }); }} onLabelsChanged={refreshLabels} /></aside>
        <section className={cn("flex min-h-0 flex-col border-r border-border", selectedId && "hidden lg:flex")}>
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
            <ThreadList items={items} meta={meta} selectedId={selectedId} focusedIndex={focused} checked={checked} onOpen={open} onToggleCheck={toggleCheck} onStar={(i) => act([i.gmailThreadId], i.starred ? "unstar" : "star")} loading={listLoading || appending} error={listError} hasMore={!!nextToken} onMore={() => void loadMore()} emptyText={EMPTY_TEXT[view] ?? "Nothing here."} myFirst={me?.first} />
          </div>
        </section>
        <section className={cn("min-h-0 bg-surface/60", !selectedId && "hidden lg:block")}>
          <ThreadView thread={selectedId ? thread : undefined} meta={selectedId ? meta[selectedId] : undefined} labels={labels ?? []} loading={threadLoading} error={threadError} myFirst={me?.first} showImagesDefault={me?.prefs.showImages ?? false} onAction={(op, payload) => selectedId && act([selectedId], op, payload)} onReply={startCompose} onClose={closeThread} />
        </section>
      </div>

      {compose && signatures !== undefined && <Compose key={`${compose.mode}-${compose.inReplyTo ?? compose.draftId ?? "new"}`} draft={compose} signatureHtml={defaultSignature} signatureAbove={me?.prefs.signatureAbove ?? true} onClose={() => setCompose(null)} onSent={(r) => { const matterId = compose.matterId; setCompose(null); reload(); if (selectedId) getThread({ gmailThreadId: selectedId }).then(setThread).catch(() => undefined); if (matterId && r.attachments > 0) toast("Was that the report?", { description: "Mark the matter’s report as delivered by email.", action: { label: "Yes, delivered", onClick: () => reportSent({ matterId: matterId as Id<"matters"> }).then(() => toast.success("Marked delivered")).catch((e: unknown) => toast.error(errorMessage(e))) } }); }} />}
      {view === "search" && q && <span className="sr-only">Showing Gmail results for {q}</span>}
      <TagIcon className="hidden" />
    </div>
  );
}
