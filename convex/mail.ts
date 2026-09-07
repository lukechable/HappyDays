import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { allowedEmails, currentUser, firstName, requireUser } from "./lib/auth";
import { audit } from "./lib/audit";
import { notify } from "./notifications";
import { accessTokenFor } from "./google";
import * as gmail from "./lib/gmail";
import type { GmailMessage, GmailThread } from "./lib/gmail";

/* ------------------------------------------------------------------ */
/*  Shapes the UI consumes. Everything comes straight from Gmail.     */
/* ------------------------------------------------------------------ */

const addressV = v.object({ name: v.string(), email: v.string() });

export type ListItem = {
  gmailThreadId: string;
  subject: string;
  snippet: string;
  senders: gmail.Address[];
  participants: string[];
  lastAt: number;
  unread: boolean;
  starred: boolean;
  important: boolean;
  hasAttachment: boolean;
  labelIds: string[];
  count: number;
  latestFromMe: boolean;
  latestIsDraft: boolean;
};

type IndexMessage = { gmailMessageId: string; gmailThreadId: string; rfcMessageId: string; inReplyTo?: string; references: string[]; from: string; to: string[]; cc: string[]; date: number; autoSubmitted: boolean; hasAttachments: boolean; isDraft: boolean };
type IndexThread = { gmailThreadId: string; subject: string; messages: IndexMessage[] };

const emailsOf = (value: string) => gmail.parseAddresses(value).map((a) => a.email);

function toIndex(t: GmailThread): IndexThread {
  const msgs = t.messages ?? [];
  return {
    gmailThreadId: t.id,
    subject: gmail.header(msgs[0], "Subject") || "(no subject)",
    messages: msgs.map((m) => ({
      gmailMessageId: m.id,
      gmailThreadId: t.id,
      rfcMessageId: gmail.normaliseMessageId(gmail.header(m, "Message-ID")) || `gmail:${m.id}`,
      inReplyTo: gmail.normaliseMessageId(gmail.header(m, "In-Reply-To")) || undefined,
      references: gmail.header(m, "References").split(/\s+/).filter(Boolean).map(gmail.normaliseMessageId),
      from: emailsOf(gmail.header(m, "From"))[0] ?? "",
      to: emailsOf(gmail.header(m, "To")),
      cc: emailsOf(gmail.header(m, "Cc")),
      date: Number(m.internalDate ?? 0) || Date.parse(gmail.header(m, "Date")) || 0,
      autoSubmitted: gmail.isAutoSubmitted(m),
      hasAttachments: hasRealAttachment(m),
      isDraft: (m.labelIds ?? []).includes("DRAFT"),
    })),
  };
}

function hasRealAttachment(m: GmailMessage): boolean {
  let found = false;
  const walk = (p: gmail.GmailPart | undefined) => { if (!p || found) return; if (p.filename && p.body?.attachmentId && !gmail.header(p, "Content-Disposition").toLowerCase().startsWith("inline")) { found = true; return; } p.parts?.forEach(walk); };
  walk(m.payload);
  return found;
}

function summarise(t: GmailThread, myEmail: string, orgEmails: Set<string>): ListItem {
  const msgs = (t.messages ?? []).filter((m) => !(m.labelIds ?? []).includes("DRAFT"));
  const all = t.messages ?? [];
  const latest = msgs[msgs.length - 1] ?? all[all.length - 1];
  const senders: gmail.Address[] = [];
  const participants = new Set<string>();
  for (const m of all) {
    const from = gmail.parseAddresses(gmail.header(m, "From"))[0];
    if (from && !senders.some((s) => s.email === from.email)) senders.push(from.email === myEmail ? { name: "me", email: from.email } : from);
    for (const a of [...gmail.parseAddresses(gmail.header(m, "From")), ...gmail.parseAddresses(gmail.header(m, "To")), ...gmail.parseAddresses(gmail.header(m, "Cc"))]) participants.add(a.email);
  }
  const labelIds = Array.from(new Set(all.flatMap((m) => m.labelIds ?? [])));
  return {
    gmailThreadId: t.id,
    subject: gmail.header(all[0], "Subject") || "(no subject)",
    snippet: decodeEntities(latest?.snippet ?? t.snippet ?? ""),
    senders,
    participants: Array.from(participants),
    lastAt: Number(latest?.internalDate ?? 0),
    unread: all.some((m) => (m.labelIds ?? []).includes("UNREAD")),
    starred: labelIds.includes("STARRED"),
    important: labelIds.includes("IMPORTANT"),
    hasAttachment: all.some(hasRealAttachment),
    labelIds,
    count: msgs.length,
    latestFromMe: latest ? orgEmails.has(emailsOf(gmail.header(latest, "From"))[0] ?? "") : false,
    latestIsDraft: all.length > 0 && (all[all.length - 1].labelIds ?? []).includes("DRAFT"),
  };
}

const decodeEntities = (s: string) => s.replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");

async function myAccount(ctx: ActionCtx): Promise<{ me: { _id: Id<"users">; email: string; name: string; prefs: Record<string, unknown> }; account: Doc<"googleAccounts">; token: string }> {
  const me = await ctx.runQuery(internal.googleData.meForAction, {});
  if (!me) throw new Error("Sign in first.");
  const account = await ctx.runQuery(internal.googleData.accountForUser, { userId: me._id });
  if (!account || account.status !== "connected") throw new Error("Connect your Google account in Settings first.");
  const token = await accessTokenFor(ctx, account._id);
  return { me, account, token };
}

/* ------------------------------------------------------------------ */
/*  Views                                                              */
/* ------------------------------------------------------------------ */

export const VIEWS = ["inbox", "unread", "smart:primary", "smart:newsletter", "smart:notification", "smart:social", "overdue", "assigned", "starred", "sent", "drafts", "archive", "spam", "trash", "label", "search", "matter", "all"] as const;

/** One page of a mailbox view, straight from Gmail. Headers are indexed as a side effect so meta queries can join. */
export const listThreads = action({
  args: { view: v.string(), labelId: v.optional(v.string()), q: v.optional(v.string()), pageToken: v.optional(v.string()) },
  handler: async (ctx, { view, labelId, q, pageToken }): Promise<{ items: ListItem[]; nextPageToken?: string; estimate: number; missing?: number }> => {
    const { me, account, token } = await myAccount(ctx);
    const orgEmails = new Set(allowedEmails().concat(account.email));
    let ids: string[] = [];
    let nextPageToken: string | undefined;
    let estimate = 0;
    let missing = 0;
    const gq = (base: string) => [base, q].filter(Boolean).join(" ");
    const page = async (opts: { labelIds?: string[]; q?: string }) => { const r = await gmail.listThreadIds(token, { ...opts, pageToken, maxResults: 25 }); ids = r.ids; nextPageToken = r.nextPageToken; estimate = r.estimate; };
    switch (view) {
      case "inbox": await page({ labelIds: ["INBOX"], q: q || undefined }); break;
      case "unread": await page({ labelIds: ["INBOX", "UNREAD"], q: q || undefined }); break;
      case "smart:primary": await page({ q: gq("in:inbox category:primary") }); break;
      case "smart:newsletter": await page({ q: gq("in:inbox category:promotions") }); break;
      case "smart:notification": await page({ q: gq("in:inbox category:updates") }); break;
      case "smart:social": await page({ q: gq("in:inbox (category:social OR category:forums)") }); break;
      case "starred": await page({ labelIds: ["STARRED"], q: q || undefined }); break;
      case "sent": await page({ labelIds: ["SENT"], q: q || undefined }); break;
      case "drafts": await page({ labelIds: ["DRAFT"], q: q || undefined }); break;
      case "archive": await page({ q: gq("-in:inbox -in:trash -in:spam -in:draft") }); break;
      case "spam": await page({ labelIds: ["SPAM"], q: q || undefined }); break;
      case "trash": await page({ labelIds: ["TRASH"], q: q || undefined }); break;
      case "all": await page({ q: gq("-in:trash -in:spam") }); break;
      case "label": if (!labelId) throw new Error("Pick a folder."); await page({ labelIds: [labelId], q: q || undefined }); break;
      case "search": if (!q) return { items: [], estimate: 0 }; await page({ q }); break;
      case "overdue": case "assigned": case "matter": {
        const rows = await ctx.runQuery(internal.mail.threadIdsForView, { view, accountId: account._id, userId: me._id, matterId: view === "matter" ? (labelId as Id<"matters"> | undefined) : undefined });
        ids = rows.gmailThreadIds; missing = rows.missing; estimate = ids.length;
        break;
      }
      default: throw new Error(`Unknown view ${view}`);
    }
    if (!ids.length) return { items: [], nextPageToken, estimate, missing };
    const threads = await gmail.batchGetThreads(token, ids, "metadata");
    const items = threads.map((t) => summarise(t, account.email, orgEmails));
    await ctx.runMutation(internal.mail.indexHeaders, { accountId: account._id, threads: threads.map(toIndex) });
    return { items, nextPageToken, estimate, missing };
  },
});

/** Threads that live in Convex first (overdue, assigned, matter), mapped to this account's Gmail thread ids. */
export const threadIdsForView = internalQuery({
  args: { view: v.string(), accountId: v.id("googleAccounts"), userId: v.id("users"), matterId: v.optional(v.id("matters")) },
  handler: async (ctx, { view, accountId, userId, matterId }) => {
    const user = await ctx.db.get(userId);
    const hours = user?.prefs?.overdueHours ?? 48;
    let threads: Doc<"threads">[] = [];
    if (view === "overdue") {
      threads = (await ctx.db.query("threads").withIndex("by_overdue", (q) => q.eq("bothIncluded", true).eq("lastDirection", "in").lt("lastInboundAt", Date.now() - hours * 3_600_000)).order("desc").take(100)).filter((t) => !t.repliedBy.length && !(t.snoozedUntil && t.snoozedUntil > Date.now()));
    } else if (view === "assigned") {
      threads = await ctx.db.query("threads").withIndex("by_assignee", (q) => q.eq("assignedTo", userId).eq("assignmentDoneAt", undefined)).order("desc").take(100);
    } else if (view === "matter" && matterId) {
      threads = await ctx.db.query("threads").withIndex("by_matter", (q) => q.eq("matterId", matterId)).order("desc").take(200);
    }
    threads.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    const gmailThreadIds: string[] = [];
    let missing = 0;
    for (const t of threads) {
      const mine = t.mailboxes.find((m) => m.accountId === accountId);
      if (mine) gmailThreadIds.push(mine.gmailThreadId); else missing++;
    }
    return { gmailThreadIds: gmailThreadIds.slice(0, 50), missing };
  },
});

/* ------------------------------------------------------------------ */
/*  Reading one conversation                                           */
/* ------------------------------------------------------------------ */

export type MessageView = {
  gmailMessageId: string;
  rfcMessageId: string;
  references: string[];
  from: gmail.Address;
  to: gmail.Address[];
  cc: gmail.Address[];
  bcc: gmail.Address[];
  replyTo?: string;
  subject: string;
  date: number;
  snippet: string;
  labelIds: string[];
  unread: boolean;
  isDraft: boolean;
  fromMe: boolean;
  fromOrg: boolean;
  html?: string;
  text?: string;
  attachments: gmail.Attachment[];
  autoSubmitted: boolean;
};

export const getThread = action({
  args: { gmailThreadId: v.string() },
  handler: async (ctx, { gmailThreadId }): Promise<{ gmailThreadId: string; subject: string; messages: MessageView[]; labelIds: string[] }> => {
    const { account, token } = await myAccount(ctx);
    const orgEmails = new Set(allowedEmails().concat(account.email));
    const t = await gmail.getThread(token, gmailThreadId, "full");
    const messages: MessageView[] = (t.messages ?? []).map((m) => {
      const body = gmail.parseBody(m.payload);
      const from = gmail.parseAddresses(gmail.header(m, "From"))[0] ?? { name: "", email: "" };
      return {
        gmailMessageId: m.id,
        rfcMessageId: gmail.normaliseMessageId(gmail.header(m, "Message-ID")),
        references: gmail.header(m, "References").split(/\s+/).filter(Boolean).map(gmail.normaliseMessageId),
        from,
        to: gmail.parseAddresses(gmail.header(m, "To")),
        cc: gmail.parseAddresses(gmail.header(m, "Cc")),
        bcc: gmail.parseAddresses(gmail.header(m, "Bcc")),
        replyTo: gmail.header(m, "Reply-To") || undefined,
        subject: gmail.header(m, "Subject"),
        date: Number(m.internalDate ?? 0),
        snippet: decodeEntities(m.snippet ?? ""),
        labelIds: m.labelIds ?? [],
        unread: (m.labelIds ?? []).includes("UNREAD"),
        isDraft: (m.labelIds ?? []).includes("DRAFT"),
        fromMe: from.email === account.email,
        fromOrg: orgEmails.has(from.email),
        html: body.html,
        text: body.text,
        attachments: body.attachments,
        autoSubmitted: gmail.isAutoSubmitted(m),
      };
    });
    await ctx.runMutation(internal.mail.indexHeaders, { accountId: account._id, threads: [toIndex(t)] });
    return { gmailThreadId, subject: messages[0]?.subject || "(no subject)", messages, labelIds: Array.from(new Set(messages.flatMap((m) => m.labelIds))) };
  },
});

/* ------------------------------------------------------------------ */
/*  Labels                                                             */
/* ------------------------------------------------------------------ */

export const labels = action({
  args: {},
  handler: async (ctx) => {
    const { token } = await myAccount(ctx);
    const all = await gmail.listLabels(token);
    // Gmail only returns counts on labels.get; fetch them for the ones the rail shows.
    const wanted = all.filter((l) => l.type === "user" || ["INBOX", "STARRED", "DRAFT", "SPAM", "TRASH", "SENT"].includes(l.id));
    const detailed = await Promise.all(wanted.map((l) => gmail.getLabel(token, l.id).catch(() => l)));
    return detailed.map((l) => ({ id: l.id, name: l.name, type: l.type, unread: l.threadsUnread ?? 0, total: l.messagesTotal ?? 0, color: l.color, hidden: l.labelListVisibility === "labelHide" })).sort((a, b) => a.name.localeCompare(b.name));
  },
});

export const createLabel = action({
  args: { name: v.string() },
  handler: async (ctx, { name }) => { const { token } = await myAccount(ctx); const l = await gmail.createLabel(token, name.trim()); return { id: l.id, name: l.name }; },
});
export const renameLabel = action({
  args: { id: v.string(), name: v.string() },
  handler: async (ctx, { id, name }) => { const { token } = await myAccount(ctx); await gmail.renameLabel(token, id, name.trim()); },
});
export const deleteLabel = action({
  args: { id: v.string() },
  handler: async (ctx, { id }) => { const { token } = await myAccount(ctx); await gmail.deleteLabel(token, id); },
});

/* ------------------------------------------------------------------ */
/*  Actions on threads (archive, star, read, move, trash)              */
/* ------------------------------------------------------------------ */

export const modify = action({
  args: { gmailThreadIds: v.array(v.string()), add: v.optional(v.array(v.string())), remove: v.optional(v.array(v.string())), op: v.optional(v.union(v.literal("trash"), v.literal("untrash"), v.literal("deleteForever"))) },
  handler: async (ctx, { gmailThreadIds, add = [], remove = [], op }) => {
    const { token } = await myAccount(ctx);
    for (const id of gmailThreadIds) {
      if (op === "trash") await gmail.trashThread(token, id);
      else if (op === "untrash") await gmail.untrashThread(token, id);
      else if (op === "deleteForever") await gmail.deleteThreadForever(token, id);
      else if (add.length || remove.length) await gmail.modifyThread(token, id, add, remove);
    }
  },
});

export const markMessageRead = action({
  args: { gmailMessageIds: v.array(v.string()), read: v.boolean() },
  handler: async (ctx, { gmailMessageIds, read }) => {
    const { token } = await myAccount(ctx);
    await Promise.all(gmailMessageIds.map((id) => gmail.modifyMessage(token, id, read ? [] : ["UNREAD"], read ? ["UNREAD"] : [])));
  },
});

/* ------------------------------------------------------------------ */
/*  Compose, reply, forward, drafts                                    */
/* ------------------------------------------------------------------ */

const outgoingArgs = {
  to: v.array(addressV),
  cc: v.optional(v.array(addressV)),
  bcc: v.optional(v.array(addressV)),
  subject: v.string(),
  html: v.string(),
  gmailThreadId: v.optional(v.string()),
  inReplyTo: v.optional(v.string()),
  references: v.optional(v.array(v.string())),
  attachments: v.optional(v.array(v.object({ filename: v.string(), mime: v.string(), base64: v.string() }))),
  /** Forwarding: attachments copied from an existing message without the browser downloading them. */
  forwardAttachments: v.optional(v.array(v.object({ gmailMessageId: v.string(), attachmentId: v.string(), filename: v.string(), mime: v.string() }))),
  draftId: v.optional(v.string()),
};

async function buildOutgoing(ctx: ActionCtx, token: string, account: Doc<"googleAccounts">, me: { name: string; email: string }, a: { to: gmail.Address[]; cc?: gmail.Address[]; bcc?: gmail.Address[]; subject: string; html: string; inReplyTo?: string; references?: string[]; attachments?: gmail.OutgoingAttachment[]; forwardAttachments?: Array<{ gmailMessageId: string; attachmentId: string; filename: string; mime: string }> }) {
  const attachments: gmail.OutgoingAttachment[] = [...(a.attachments ?? [])];
  for (const f of a.forwardAttachments ?? []) {
    const data = await gmail.getAttachment(token, f.gmailMessageId, f.attachmentId);
    attachments.push({ filename: f.filename, mime: f.mime, base64: data.data.replace(/-/g, "+").replace(/_/g, "/") });
  }
  return gmail.buildRaw({
    from: { name: me.name, email: account.email },
    to: a.to, cc: a.cc, bcc: a.bcc,
    subject: a.subject,
    html: a.html,
    inReplyTo: a.inReplyTo,
    references: a.references,
    attachments,
    extraHeaders: { "X-Mailer": "Happy Days" },
  });
}

export const send = action({
  args: outgoingArgs,
  handler: async (ctx, a): Promise<{ gmailMessageId: string; gmailThreadId: string }> => {
    const { me, account, token } = await myAccount(ctx);
    const raw = await buildOutgoing(ctx, token, account, me, a);
    if (a.draftId) { try { await gmail.deleteDraft(token, a.draftId); } catch { /* already gone */ } }
    const sent = await gmail.sendRaw(token, raw, a.gmailThreadId);
    const full = await gmail.getThread(token, sent.threadId, "metadata");
    await ctx.runMutation(internal.mail.indexHeaders, { accountId: account._id, threads: [toIndex(full)] });
    await ctx.runMutation(internal.mail.logSend, { userId: me._id, gmailThreadId: sent.threadId, to: a.to.map((t) => t.email), subject: a.subject });
    return { gmailMessageId: sent.id, gmailThreadId: sent.threadId };
  },
});

export const saveDraft = action({
  args: outgoingArgs,
  handler: async (ctx, a): Promise<{ draftId: string; gmailThreadId?: string }> => {
    const { me, account, token } = await myAccount(ctx);
    const raw = await buildOutgoing(ctx, token, account, me, a);
    const d = a.draftId ? await gmail.updateDraft(token, a.draftId, raw, a.gmailThreadId) : await gmail.createDraft(token, raw, a.gmailThreadId);
    return { draftId: d.id, gmailThreadId: d.message?.threadId };
  },
});

export const discardDraft = action({
  args: { draftId: v.string() },
  handler: async (ctx, { draftId }) => { const { token } = await myAccount(ctx); await gmail.deleteDraft(token, draftId); },
});

/** Find the draft record for a message shown in a thread (Gmail exposes drafts as messages with the DRAFT label). */
export const draftForMessage = action({
  args: { gmailMessageId: v.string() },
  handler: async (ctx, { gmailMessageId }): Promise<{ draftId: string; to: gmail.Address[]; cc: gmail.Address[]; bcc: gmail.Address[]; subject: string; html: string } | null> => {
    const { token } = await myAccount(ctx);
    const drafts = (await gmail.listDrafts(token)).drafts ?? [];
    const hit = drafts.find((d) => d.message.id === gmailMessageId);
    if (!hit) return null;
    const d = await gmail.getDraft(token, hit.id);
    const body = gmail.parseBody(d.message.payload);
    return { draftId: d.id, to: gmail.parseAddresses(gmail.header(d.message, "To")), cc: gmail.parseAddresses(gmail.header(d.message, "Cc")), bcc: gmail.parseAddresses(gmail.header(d.message, "Bcc")), subject: gmail.header(d.message, "Subject"), html: body.html ?? `<p>${(body.text ?? "").replace(/\n/g, "<br>")}</p>` };
  },
});

export const logSend = internalMutation({
  args: { userId: v.id("users"), gmailThreadId: v.string(), to: v.array(v.string()), subject: v.string() },
  handler: async (ctx, { userId, gmailThreadId, to, subject }) => { await audit(ctx, { userId, action: "mail.send", subjectKind: "thread", subjectId: gmailThreadId, detail: `${subject} → ${to.join(", ")}` }); },
});

/* ------------------------------------------------------------------ */
/*  The header index                                                   */
/* ------------------------------------------------------------------ */

const indexMessageV = v.object({ gmailMessageId: v.string(), gmailThreadId: v.string(), rfcMessageId: v.string(), inReplyTo: v.optional(v.string()), references: v.array(v.string()), from: v.string(), to: v.array(v.string()), cc: v.array(v.string()), date: v.number(), autoSubmitted: v.boolean(), hasAttachments: v.boolean(), isDraft: v.boolean() });

/** Upsert threads and message headers seen in Gmail. Idempotent; safe to call on every list and read. */
export const indexHeaders = internalMutation({
  args: { accountId: v.id("googleAccounts"), threads: v.array(v.object({ gmailThreadId: v.string(), subject: v.string(), messages: v.array(indexMessageV) })) },
  handler: async (ctx, { accountId, threads }) => {
    const orgUsers = (await ctx.db.query("users").collect()).filter((u) => allowedEmails().includes(u.email.toLowerCase()));
    const accounts = await ctx.db.query("googleAccounts").collect();
    const emailToUser = new Map<string, Id<"users">>();
    for (const u of orgUsers) emailToUser.set(u.email.toLowerCase(), u._id);
    for (const a of accounts) emailToUser.set(a.email.toLowerCase(), a.userId);
    const orgEmails = new Set(emailToUser.keys());
    const touched = new Set<Id<"threads">>();
    const newInbound: Array<{ threadId: Id<"threads">; gmailMessageId: string; gmailThreadId: string }> = [];

    for (const t of threads) {
      const msgs = t.messages.filter((m) => !m.isDraft);
      if (!msgs.length) continue;
      let threadId = (await ctx.db.query("threadLookup").withIndex("by_account_gmail", (q) => q.eq("accountId", accountId).eq("gmailThreadId", t.gmailThreadId)).unique())?.threadId;
      if (!threadId) {
        // Same conversation seen from the other mailbox? Match on any Message-ID or reference.
        const candidates = Array.from(new Set(msgs.flatMap((m) => [m.rfcMessageId, ...(m.inReplyTo ? [m.inReplyTo] : []), ...m.references])));
        for (const rfc of candidates) {
          const hit = await ctx.db.query("messageIndex").withIndex("by_rfc", (q) => q.eq("rfcMessageId", rfc)).first();
          if (hit) { threadId = hit.threadId; break; }
        }
      }
      if (!threadId) {
        const earliest = [...msgs].sort((a, b) => a.date - b.date)[0];
        threadId = await ctx.db.insert("threads", { key: earliest.rfcMessageId, subject: t.subject, participants: [], mailboxes: [{ accountId, gmailThreadId: t.gmailThreadId }], firstMessageAt: earliest.date, lastMessageAt: earliest.date, lastDirection: "in", repliedBy: [], bothIncluded: false, tagIds: [] });
        await ctx.db.insert("threadLookup", { accountId, gmailThreadId: t.gmailThreadId, threadId });
      } else {
        const thread = (await ctx.db.get(threadId))!;
        if (!thread.mailboxes.some((m) => m.accountId === accountId && m.gmailThreadId === t.gmailThreadId)) {
          await ctx.db.patch(threadId, { mailboxes: [...thread.mailboxes.filter((m) => m.accountId !== accountId), { accountId, gmailThreadId: t.gmailThreadId }] });
          const lk = await ctx.db.query("threadLookup").withIndex("by_account_gmail", (q) => q.eq("accountId", accountId).eq("gmailThreadId", t.gmailThreadId)).unique();
          if (!lk) await ctx.db.insert("threadLookup", { accountId, gmailThreadId: t.gmailThreadId, threadId });
        }
      }
      for (const m of msgs) {
        const existing = await ctx.db.query("messageIndex").withIndex("by_account_gmailId", (q) => q.eq("accountId", accountId).eq("gmailMessageId", m.gmailMessageId)).unique();
        if (existing) continue;
        const from = m.from.toLowerCase();
        const direction = orgEmails.has(from) ? "out" : "in";
        await ctx.db.insert("messageIndex", { threadId, accountId, gmailMessageId: m.gmailMessageId, gmailThreadId: m.gmailThreadId, rfcMessageId: m.rfcMessageId, from, to: m.to, cc: m.cc, date: m.date, direction, sentByUserId: emailToUser.get(from), autoSubmitted: m.autoSubmitted, hasAttachments: m.hasAttachments });
        if (direction === "in" && !m.autoSubmitted) newInbound.push({ threadId, gmailMessageId: m.gmailMessageId, gmailThreadId: m.gmailThreadId });
      }
      touched.add(threadId);
    }
    for (const threadId of touched) await recompute(ctx, threadId, orgEmails);
    return newInbound;
  },
});

/** Derive who replied, when the last inbound arrived, and whether both users are on the thread. */
async function recompute(ctx: { db: import("./_generated/server").DatabaseWriter }, threadId: Id<"threads">, orgEmails: Set<string>) {
  const rows = await ctx.db.query("messageIndex").withIndex("by_thread", (q) => q.eq("threadId", threadId)).collect();
  const byRfc = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!byRfc.has(r.rfcMessageId)) byRfc.set(r.rfcMessageId, r);
  const unique = Array.from(byRfc.values()).sort((a, b) => a.date - b.date);
  if (!unique.length) return;
  const participants = new Set<string>();
  for (const r of unique) { participants.add(r.from); r.to.forEach((e) => participants.add(e)); r.cc.forEach((e) => participants.add(e)); }
  const inbound = unique.filter((r) => r.direction === "in");
  const lastInbound = inbound[inbound.length - 1];
  const lastInboundAt = lastInbound?.date;
  const repliedBy = Array.from(new Set(unique.filter((r) => r.direction === "out" && r.sentByUserId && (lastInboundAt === undefined || r.date > lastInboundAt)).map((r) => r.sentByUserId!)));
  const orgOnThread = Array.from(orgEmails).filter((e) => participants.has(e));
  const users = new Set<string>();
  // Both users included = at least two distinct org identities on the thread (a user may appear under one address).
  for (const e of orgOnThread) users.add(e.split("@")[0].toLowerCase());
  const last = unique[unique.length - 1];
  await ctx.db.patch(threadId, {
    participants: Array.from(participants),
    firstMessageAt: unique[0].date,
    lastMessageAt: last.date,
    lastInboundAt,
    lastDirection: last.direction,
    repliedBy,
    bothIncluded: users.size >= 2,
  });
}

/** Backfill after connecting: headers for recent inbox and sent mail so overdue and replied pills work from day one. */
export const indexRecent = internalAction({
  args: { accountId: v.id("googleAccounts"), days: v.number() },
  handler: async (ctx, { accountId, days }) => {
    const token = await accessTokenFor(ctx, accountId);
    let pageToken: string | undefined;
    let pages = 0;
    do {
      const r = await gmail.listThreadIds(token, { q: `newer_than:${days}d -in:spam -in:trash`, pageToken, maxResults: 50 });
      const threads = await gmail.batchGetThreads(token, r.ids, "metadata");
      await ctx.runMutation(internal.mail.indexHeaders, { accountId, threads: threads.map(toIndex) });
      pageToken = r.nextPageToken;
      pages++;
    } while (pageToken && pages < 20);
    await ctx.runMutation(internal.googleData.patchAccount, { accountId, patch: { lastSyncAt: Date.now() } });
  },
});

/** Incremental sync from Gmail's history log. Triggered by Pub/Sub push, and hourly as a fallback. */
export const syncHistory = internalAction({
  args: { accountId: v.id("googleAccounts") },
  handler: async (ctx, { accountId }) => {
    const account = await ctx.runQuery(internal.googleData.accountById, { accountId });
    if (!account || account.status !== "connected") return;
    const token = await accessTokenFor(ctx, accountId);
    if (!account.historyId) { const p = await gmail.profile(token); await ctx.runMutation(internal.googleData.patchAccount, { accountId, patch: { historyId: p.historyId } }); return; }
    const threadIds = new Set<string>();
    let pageToken: string | undefined;
    let newest = account.historyId;
    try {
      do {
        const h = await gmail.listHistory(token, account.historyId, pageToken);
        for (const item of h.history ?? []) for (const a of item.messagesAdded ?? []) threadIds.add(a.message.threadId);
        newest = h.historyId ?? newest;
        pageToken = h.nextPageToken;
      } while (pageToken);
    } catch (e) {
      // 404 means the history id is too old; re-anchor and backfill a week.
      if (e instanceof gmail.GmailError && e.status === 404) {
        const p = await gmail.profile(token);
        await ctx.runMutation(internal.googleData.patchAccount, { accountId, patch: { historyId: p.historyId } });
        await ctx.runAction(internal.mail.indexRecent, { accountId, days: 7 });
        return;
      }
      throw e;
    }
    const ids = Array.from(threadIds);
    let newInbound: Array<{ threadId: Id<"threads">; gmailMessageId: string; gmailThreadId: string }> = [];
    for (let i = 0; i < ids.length; i += 50) {
      const threads = await gmail.batchGetThreads(token, ids.slice(i, i + 50), "metadata");
      newInbound = newInbound.concat(await ctx.runMutation(internal.mail.indexHeaders, { accountId, threads: threads.map(toIndex) }));
    }
    await ctx.runMutation(internal.googleData.patchAccount, { accountId, patch: { historyId: newest, lastSyncAt: Date.now() } });
    if (newInbound.length) await ctx.scheduler.runAfter(0, internal.autoReply.onNewInbound, { accountId, messages: newInbound });
  },
});

export const syncAll = internalAction({
  args: {},
  handler: async (ctx) => {
    const accounts = await ctx.runQuery(internal.googleData.connectedAccounts, {});
    for (const a of accounts) { try { await ctx.runAction(internal.mail.syncHistory, { accountId: a._id }); } catch (e) { console.error("sync failed", a.email, e); } }
  },
});

/* ------------------------------------------------------------------ */
/*  Reactive metadata the list and reader join onto Gmail data         */
/* ------------------------------------------------------------------ */

export type ThreadMeta = {
  threadId: Id<"threads">;
  tags: Array<{ _id: Id<"tags">; name: string; color: Doc<"tags">["color"] }>;
  suggestedTags: Array<{ _id: Id<"tags">; name: string; color: Doc<"tags">["color"] }>;
  repliedBy: Array<{ userId: Id<"users">; first: string }>;
  assignedTo?: { userId: Id<"users">; first: string };
  assignedBy?: { userId: Id<"users">; first: string };
  assignmentNote?: string;
  assignmentDone: boolean;
  matter?: { _id: Id<"matters">; name: string };
  aiSummary?: string;
  bothIncluded: boolean;
  overdue: boolean;
  taskCount: number;
  otherMailboxHasIt: boolean;
};

export const meta = query({
  args: { gmailThreadIds: v.array(v.string()) },
  handler: async (ctx, { gmailThreadIds }): Promise<Record<string, ThreadMeta>> => {
    const user = await currentUser(ctx);
    if (!user) return {};
    const account = await ctx.db.query("googleAccounts").withIndex("by_user", (q) => q.eq("userId", user._id)).first();
    if (!account) return {};
    const hours = user.prefs?.overdueHours ?? 48;
    const users = new Map((await ctx.db.query("users").collect()).map((u) => [u._id, firstName(u)]));
    const tags = new Map((await ctx.db.query("tags").collect()).map((t) => [t._id, t]));
    const out: Record<string, ThreadMeta> = {};
    for (const gid of gmailThreadIds) {
      const lk = await ctx.db.query("threadLookup").withIndex("by_account_gmail", (q) => q.eq("accountId", account._id).eq("gmailThreadId", gid)).unique();
      if (!lk) continue;
      const t = await ctx.db.get(lk.threadId);
      if (!t) continue;
      const matter = t.matterId ? await ctx.db.get(t.matterId) : null;
      const tasks = await ctx.db.query("tasks").withIndex("by_thread", (q) => q.eq("sourceThreadId", t._id)).collect();
      const pick = (ids: Id<"tags">[]) => ids.map((id) => tags.get(id)).filter((x): x is Doc<"tags"> => !!x).map((x) => ({ _id: x._id, name: x.name, color: x.color }));
      out[gid] = {
        threadId: t._id,
        tags: pick(t.tagIds),
        suggestedTags: pick((t.aiSuggestedTagIds ?? []).filter((id) => !t.tagIds.includes(id))),
        repliedBy: t.repliedBy.map((id) => ({ userId: id, first: users.get(id) ?? "?" })),
        assignedTo: t.assignedTo && !t.assignmentDoneAt ? { userId: t.assignedTo, first: users.get(t.assignedTo) ?? "?" } : undefined,
        assignedBy: t.assignedBy && !t.assignmentDoneAt ? { userId: t.assignedBy, first: users.get(t.assignedBy) ?? "?" } : undefined,
        assignmentNote: t.assignmentDoneAt ? undefined : t.assignmentNote,
        assignmentDone: !!t.assignmentDoneAt,
        matter: matter ? { _id: matter._id, name: matter.name } : undefined,
        aiSummary: t.aiSummary,
        bothIncluded: t.bothIncluded,
        overdue: t.bothIncluded && t.lastDirection === "in" && !t.repliedBy.length && !!t.lastInboundAt && t.lastInboundAt < Date.now() - hours * 3_600_000,
        taskCount: tasks.filter((x) => x.status !== "done").length,
        otherMailboxHasIt: t.mailboxes.some((m) => m.accountId !== account._id),
      };
    }
    return out;
  },
});

export const setTags = mutation({
  args: { threadId: v.id("threads"), tagIds: v.array(v.id("tags")) },
  handler: async (ctx, { threadId, tagIds }) => {
    const user = await requireUser(ctx);
    const t = await ctx.db.get(threadId);
    if (!t) throw new Error("Thread not found");
    await ctx.db.patch(threadId, { tagIds, aiSuggestedTagIds: (t.aiSuggestedTagIds ?? []).filter((id) => !tagIds.includes(id)) });
    await audit(ctx, { userId: user._id, action: "mail.tag", subjectKind: "thread", subjectId: threadId });
  },
});

export const assign = mutation({
  args: { threadId: v.id("threads"), toUserId: v.optional(v.id("users")), note: v.optional(v.string()), subject: v.optional(v.string()) },
  handler: async (ctx, { threadId, toUserId, note, subject }) => {
    const user = await requireUser(ctx);
    const t = await ctx.db.get(threadId);
    if (!t) throw new Error("Thread not found");
    if (!toUserId) { await ctx.db.patch(threadId, { assignedTo: undefined, assignedBy: undefined, assignedAt: undefined, assignmentNote: undefined, assignmentDoneAt: undefined }); return; }
    await ctx.db.patch(threadId, { assignedTo: toUserId, assignedBy: user._id, assignedAt: Date.now(), assignmentNote: note, assignmentDoneAt: undefined });
    if (toUserId !== user._id) {
      const mine = t.mailboxes.find((m) => m.accountId !== undefined);
      await notify(ctx, { userId: toUserId, kind: "mail.assigned", title: `${firstName(user)} asked you to follow up`, body: [subject ?? t.subject, note].filter(Boolean).join(" — "), href: mine ? `/mail?view=assigned` : "/mail?view=assigned" });
    }
    await audit(ctx, { userId: user._id, action: "mail.assign", subjectKind: "thread", subjectId: threadId, detail: note });
  },
});

export const finishAssignment = mutation({
  args: { threadId: v.id("threads") },
  handler: async (ctx, { threadId }) => {
    const user = await requireUser(ctx);
    const t = await ctx.db.get(threadId);
    if (!t) return;
    await ctx.db.patch(threadId, { assignmentDoneAt: Date.now() });
    if (t.assignedBy && t.assignedBy !== user._id) await notify(ctx, { userId: t.assignedBy, kind: "mail.assignmentDone", title: `${firstName(user)} finished a follow-up`, body: t.subject, href: "/mail" });
  },
});

export const setMatter = mutation({
  args: { threadId: v.id("threads"), matterId: v.optional(v.id("matters")) },
  handler: async (ctx, { threadId, matterId }) => {
    const user = await requireUser(ctx);
    await ctx.db.patch(threadId, { matterId });
    if (matterId) await ctx.db.insert("matterLinks", { matterId, kind: "thread", refId: threadId, createdAt: Date.now() });
    else { const links = await ctx.db.query("matterLinks").withIndex("by_ref", (q) => q.eq("kind", "thread").eq("refId", threadId)).collect(); await Promise.all(links.map((l) => ctx.db.delete(l._id))); }
    await audit(ctx, { userId: user._id, action: "mail.matter", subjectKind: "thread", subjectId: threadId, detail: matterId });
  },
});

export const snooze = mutation({
  args: { threadId: v.id("threads"), until: v.optional(v.number()) },
  handler: async (ctx, { threadId, until }) => { await requireUser(ctx); await ctx.db.patch(threadId, { snoozedUntil: until }); },
});

/** Address book: every address seen in the index, most recent first. Feeds compose autocomplete. */
export const contacts = query({
  args: { q: v.string() },
  handler: async (ctx, { q }) => {
    const user = await currentUser(ctx);
    if (!user) return [];
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];
    const threads = await ctx.db.query("threads").withIndex("by_lastMessage").order("desc").take(400);
    const seen = new Map<string, number>();
    for (const t of threads) for (const p of t.participants) if (p.includes(needle) && !seen.has(p)) seen.set(p, t.lastMessageAt);
    return Array.from(seen.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([email]) => ({ email, name: email.split("@")[0] }));
  },
});

/** Everything in the index for one thread: powers the assignment, matter and task panels and the subpoena review. */
export const threadDetail = query({
  args: { threadId: v.id("threads") },
  handler: async (ctx, { threadId }) => {
    await requireUser(ctx);
    const t = await ctx.db.get(threadId);
    if (!t) return null;
    const tasks = await ctx.db.query("tasks").withIndex("by_thread", (q) => q.eq("sourceThreadId", threadId)).collect();
    const log = await ctx.db.query("autoReplyLog").withIndex("by_thread", (q) => q.eq("threadId", threadId)).collect();
    return { ...t, tasks, autoReplies: log };
  },
});

/** "Suggest a reply" in the compose window: Claude drafts in the practice's voice; nothing is sent. */
export const suggestReply = action({
  args: { subject: v.string(), from: v.string(), text: v.string(), instruction: v.optional(v.string()) },
  handler: async (ctx, a): Promise<string> => {
    const me = await ctx.runQuery(internal.googleData.meForAction, {});
    if (!me) throw new Error("Sign in first.");
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set on the Convex deployment.");
    return await ctx.runAction(internal.ai.draftReply, { subject: a.subject, from: a.from, text: a.text.slice(0, 8000), instruction: a.instruction, signOff: me.name.split(" ")[0] });
  },
});

/** Send a message from the practice: uses the first connected Google account. For automated mail (intake forms). */
export const sendFromPractice = internalAction({
  args: { to: addressV, subject: v.string(), html: v.string() },
  handler: async (ctx, a) => {
    const accounts = await ctx.runQuery(internal.googleData.connectedAccounts, {});
    const account = accounts[0];
    if (!account) throw new Error("No connected Google account to send from.");
    const owner = await ctx.runQuery(internal.googleData.ownerName, { accountId: account._id });
    const token = await accessTokenFor(ctx, account._id);
    const raw = gmail.buildRaw({ from: { name: owner ?? "Barbara Fraser & Associates", email: account.email }, to: [a.to], subject: a.subject, html: a.html, extraHeaders: { "X-Mailer": "Happy Days" } });
    const sent = await gmail.sendRaw(token, raw);
    return { gmailMessageId: sent.id, gmailThreadId: sent.threadId };
  },
});
