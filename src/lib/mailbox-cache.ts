"use client";

import type { ListItem } from "../../convex/mail";
import { gmailRead, promoteGmailRead } from "./gmail-budget";
import { liveEntries, readLive, writeLive } from "./live-cache";
import { scopedMailStore } from "./mail-store";
import { applyMailChange, type MailChange } from "./mail-change";
import { errorMessage } from "./utils";

export type MailboxArgs = { view: string; labelId?: string; q?: string };
export type MailboxData = { items: ListItem[]; nextToken?: string; missing: number };
type ListMailbox = (args: MailboxArgs) => Promise<{ items: ListItem[]; nextPageToken?: string; missing?: number }>;
const foreground = new Set<string>();
export const MAILBOX_VIEWS = ["inbox", "unread", "overdue", "assigned", "starred", "sent", "drafts", "archive", "spam", "trash", "smart:primary", "smart:newsletter", "smart:notification", "smart:social", "smart:forums", "all"];

// Keep the existing device keys so an upgrade does not throw away already loaded mail.
export function mailboxKey(scope: string, { view, labelId, q }: MailboxArgs, connected = true) {
  return `mail:list:${JSON.stringify({ cacheVersion: 3, view, labelId, q, connected, scope, ...(view.startsWith("smart:") ? { smartVersion: 2 } : {}) })}`;
}

/** Restore every saved folder at app startup, before its button is clicked. */
export async function restoreMailboxes(scope: string, signal: AbortSignal) {
  const lists = await scopedMailStore(scope).getLists();
  if (signal.aborted) return;
  for (const r of lists) {
    if (!r.key.startsWith("mail:list:") || readLive(r.key).data) continue;
    writeLive<MailboxData>(r.key, { data: { items: r.items as ListItem[], nextToken: r.nextToken, missing: r.missing }, fetchedAt: r.fetchedAt });
  }
}

/**
 * One read per folder shared by startup, pointer intent and navigation. A request
 * belongs to the cache, not to the mounted folder: leaving never discards its result.
 * Refreshing preserves the last successful page, including known empty folders.
 */
export function ensureMailbox(scope: string, args: MailboxArgs, list: ListMailbox, options: { background?: boolean; force?: boolean } = {}): Promise<void> {
  const key = mailboxKey(scope, args);
  const cached = readLive<MailboxData>(key);
  if (cached.inflight) {
    if (!options.background) { foreground.add(key); promoteGmailRead(key); }
    return cached.inflight;
  }
  const ttl = options.background ? 300_000 : 60_000;
  if (!options.force && cached.data && !cached.error && cached.fetchedAt && Date.now() - cached.fetchedAt < ttl) return Promise.resolve();
  const device = scopedMailStore(scope);
  const current = () => readLive(key).inflight === pending;
  const pending: Promise<void> = Promise.resolve().then(async () => {
    if (!cached.data && args.view !== "search") {
      const saved = await device.getList<ListItem>(key);
      if (saved && current() && !readLive(key).data) {
        writeLive<MailboxData>(key, { data: { items: saved.items, nextToken: saved.nextToken, missing: saved.missing }, fetchedAt: saved.fetchedAt });
        if (!options.force && Date.now() - saved.fetchedAt < ttl) return;
      }
    }
    if (!current()) return;
    const result = await gmailRead(() => {
      if (!current()) throw new DOMException("Cancelled", "AbortError");
      return list(args);
    }, { background: options.background && !foreground.has(key), key });
    if (!current()) return; // A mutation or sign-out invalidated this read.
    const data = { items: result.items, nextToken: result.nextPageToken, missing: result.missing ?? 0 };
    const fetchedAt = Date.now();
    writeLive<MailboxData>(key, { data, fetchedAt, error: undefined });
    if (args.view !== "search") void device.putList(key, { ...data, fetchedAt });
  }).catch((error: unknown) => {
    if (current() && !(error instanceof DOMException && error.name === "AbortError")) writeLive(key, { error: errorMessage(error), fetchedAt: undefined });
  }).finally(() => {
    foreground.delete(key);
    if (current()) writeLive(key, { inflight: undefined });
  });
  writeLive(key, { inflight: pending, error: undefined });
  return pending;
}

/** Keep prepared folders usable after confirmed changes instead of emptying the cache. */
export function updateMailboxCaches(scope: string, completed: string[], op: MailChange, payload?: { add: string[]; remove: string[] }) {
  const update = (key: string, items: unknown[]) => {
    try {
      const args = JSON.parse(key.slice("mail:list:".length)) as MailboxArgs & { scope: string };
      return args.scope === scope ? applyMailChange(items as ListItem[], completed, op, args.view, args.labelId, payload) : items;
    } catch { return items; }
  };
  for (const [key, slot] of liveEntries<MailboxData>("mail:list:")) {
    if (!slot.data) continue;
    try { if (JSON.parse(key.slice("mail:list:".length)).scope !== scope) continue; } catch { continue; }
    writeLive(key, { data: { ...slot.data, items: update(key, slot.data.items) as ListItem[] }, fetchedAt: 0, inflight: undefined });
  }
  return scopedMailStore(scope).invalidate(completed, op === "trash" || op === "spam", update);
}
