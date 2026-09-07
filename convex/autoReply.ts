import { internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { allowedEmails, requireUser } from "./lib/auth";
import { audit } from "./lib/audit";
import { accessTokenFor } from "./google";
import * as gmail from "./lib/gmail";
import { fileByRules } from "./labelRules";

/* ------------------------------ rule CRUD ------------------------------ */

const ruleFields = {
  name: v.string(),
  enabled: v.boolean(),
  trigger: v.union(v.literal("first"), v.literal("followUp"), v.literal("any")),
  contentMode: v.union(v.literal("none"), v.literal("keywords"), v.literal("ai")),
  keywords: v.array(v.string()),
  aiPrompt: v.optional(v.string()),
  senderDomains: v.array(v.string()),
  businessHoursOnly: v.boolean(),
  mode: v.union(v.literal("send"), v.literal("draft")),
  subjectTemplate: v.optional(v.string()),
  bodyTemplate: v.string(),
  addTagIds: v.array(v.id("tags")),
  assignTo: v.optional(v.id("users")),
  stopAfterMatch: v.boolean(),
  appliesToAccountIds: v.array(v.id("googleAccounts")),
};

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const rules = await ctx.db.query("autoReplyRules").withIndex("by_order").collect();
    const out = [];
    for (const r of rules) {
      const recent = await ctx.db.query("autoReplyLog").withIndex("by_rule", (q) => q.eq("ruleId", r._id)).order("desc").take(20);
      out.push({ ...r, sent: recent.filter((l) => l.action === "sent").length, drafted: recent.filter((l) => l.action === "drafted").length, lastAt: recent[0]?.at });
    }
    return out;
  },
});

export const save = mutation({
  args: { id: v.optional(v.id("autoReplyRules")), ...ruleFields },
  handler: async (ctx, { id, ...fields }) => {
    const user = await requireUser(ctx);
    if (id) { await ctx.db.patch(id, fields); await audit(ctx, { userId: user._id, action: "autoReply.update", subjectKind: "rule", subjectId: id }); return id; }
    const count = (await ctx.db.query("autoReplyRules").collect()).length;
    const newId = await ctx.db.insert("autoReplyRules", { ...fields, order: count, createdBy: user._id });
    await audit(ctx, { userId: user._id, action: "autoReply.create", subjectKind: "rule", subjectId: newId });
    return newId;
  },
});

export const remove = mutation({
  args: { id: v.id("autoReplyRules") },
  handler: async (ctx, { id }) => { const user = await requireUser(ctx); await ctx.db.delete(id); await audit(ctx, { userId: user._id, action: "autoReply.delete", subjectKind: "rule", subjectId: id }); },
});

export const reorder = mutation({
  args: { ids: v.array(v.id("autoReplyRules")) },
  handler: async (ctx, { ids }) => { await requireUser(ctx); await Promise.all(ids.map((id, i) => ctx.db.patch(id, { order: i }))); },
});

export const log = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("autoReplyLog").order("desc").take(limit ?? 50);
    const rules = new Map((await ctx.db.query("autoReplyRules").collect()).map((r) => [r._id, r.name]));
    const out = [];
    for (const r of rows) { const t = await ctx.db.get(r.threadId); out.push({ ...r, rule: rules.get(r.ruleId) ?? "(deleted rule)", subject: t?.subject ?? "" }); }
    return out;
  },
});

/* ------------------------------ evaluation ------------------------------ */

type Hours = { tz?: string; start?: number; end?: number; days?: number[] };
type RuleContext = { rules: Doc<"autoReplyRules">[]; thread: Doc<"threads"> | null; index: Doc<"messageIndex">[]; logs: Doc<"autoReplyLog">[]; account: Doc<"googleAccounts"> | null; owner: Doc<"users"> | null; hours: Hours | undefined; tags: Doc<"tags">[] };

export const context = internalQuery({
  args: { accountId: v.id("googleAccounts"), threadId: v.id("threads") },
  handler: async (ctx, { accountId, threadId }): Promise<RuleContext> => {
    const rules = (await ctx.db.query("autoReplyRules").withIndex("by_order").collect()).filter((r) => r.enabled && (r.appliesToAccountIds.length === 0 || r.appliesToAccountIds.includes(accountId)));
    const thread = await ctx.db.get(threadId);
    const index = await ctx.db.query("messageIndex").withIndex("by_thread", (q) => q.eq("threadId", threadId)).collect();
    const logs = await ctx.db.query("autoReplyLog").withIndex("by_thread", (q) => q.eq("threadId", threadId)).collect();
    const account = await ctx.db.get(accountId);
    const owner = account ? await ctx.db.get(account.userId) : null;
    const hoursSetting = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", "practice.hours")).unique();
    const tags = await ctx.db.query("tags").collect();
    return { rules, thread, index, logs, account, owner, hours: (hoursSetting?.value as Hours | undefined) ?? undefined, tags };
  },
});

export const record = internalMutation({
  args: { ruleId: v.id("autoReplyRules"), threadId: v.id("threads"), accountId: v.id("googleAccounts"), inboundGmailMessageId: v.string(), action: v.union(v.literal("sent"), v.literal("drafted"), v.literal("skipped")), reason: v.optional(v.string()), addTagIds: v.optional(v.array(v.id("tags"))), assignTo: v.optional(v.id("users")), aiSummary: v.optional(v.string()), suggestedTagIds: v.optional(v.array(v.id("tags"))) },
  handler: async (ctx, a) => {
    await ctx.db.insert("autoReplyLog", { ruleId: a.ruleId, threadId: a.threadId, accountId: a.accountId, inboundGmailMessageId: a.inboundGmailMessageId, action: a.action, reason: a.reason, at: Date.now() });
    const t = await ctx.db.get(a.threadId);
    if (!t) return;
    const patch: Partial<Doc<"threads">> = {};
    if (a.addTagIds?.length) patch.tagIds = Array.from(new Set([...t.tagIds, ...a.addTagIds]));
    if (a.assignTo && !t.assignedTo) { patch.assignedTo = a.assignTo; patch.assignedAt = Date.now(); patch.assignmentNote = "Assigned by an auto-reply rule"; }
    if (a.aiSummary) patch.aiSummary = a.aiSummary;
    if (a.action === "sent") patch.autoRepliedAt = Date.now();
    if (a.suggestedTagIds) patch.aiSuggestedTagIds = a.suggestedTagIds;
    if (Object.keys(patch).length) await ctx.db.patch(a.threadId, patch);
  },
});

export const annotate = internalMutation({
  args: { threadId: v.id("threads"), aiSummary: v.optional(v.string()), suggestedTagIds: v.optional(v.array(v.id("tags"))), smartCategory: v.optional(v.union(v.literal("primary"), v.literal("newsletter"), v.literal("notification"), v.literal("receipt"), v.literal("calendar"), v.literal("social"))) },
  handler: async (ctx, { threadId, ...patch }) => { await ctx.db.patch(threadId, patch); },
});

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const merge = (template: string, vars: Record<string, string>) => template.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_, k: string) => escapeHtml(vars[k.toLowerCase()] ?? ""));

function withinHours(hours: Hours | undefined, at: number): boolean {
  const tz = hours?.tz ?? "Australia/Melbourne";
  const d = new Date(at);
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: tz, hour: "numeric", hour12: false, weekday: "short" }).formatToParts(d);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((p) => p.type === "weekday")?.value ?? "Mon");
  const days = hours?.days ?? [1, 2, 3, 4, 5];
  return days.includes(wd) && hour >= (hours?.start ?? 9) && hour < (hours?.end ?? 17);
}

/**
 * Runs after history sync indexes new inbound mail. For each message, the first matching rule wins (unless it
 * says continue). Guard rails: no replies to bulk or auto-submitted mail, none to ourselves, one auto-reply per
 * thread per sender per 7 days, and everything is logged whether it fired or not.
 */
export const onNewInbound = internalAction({
  args: { accountId: v.id("googleAccounts"), messages: v.array(v.object({ threadId: v.id("threads"), gmailMessageId: v.string(), gmailThreadId: v.string() })) },
  handler: async (ctx, { accountId, messages }) => {
    for (const m of messages) {
      try { await evaluateOne(ctx, accountId, m); } catch (e) { console.error("auto-reply failed", m.gmailMessageId, e); }
    }
  },
});

async function evaluateOne(ctx: ActionCtx, accountId: Id<"googleAccounts">, m: { threadId: Id<"threads">; gmailMessageId: string; gmailThreadId: string }) {
  const c: RuleContext = await ctx.runQuery(internal.autoReply.context, { accountId, threadId: m.threadId });
  if (!c.thread || !c.account || !c.owner) return;
  const token = await accessTokenFor(ctx, accountId);
  const msg = await gmail.getMessage(token, m.gmailMessageId, "full");
  const from = gmail.parseAddresses(gmail.header(msg, "From"))[0];
  if (!from) return;
  // Folder rules run for every inbound message, including bulk mail, before any reply guard rails.
  try { await fileByRules(ctx, { accountId, threadId: m.threadId, gmailThreadId: m.gmailThreadId, senderEmail: from.email, subject: gmail.header(msg, "Subject"), matterId: c.thread.matterId, existingLabelIds: msg.labelIds ?? [], token }); }
  catch (e) { console.error("auto-file failed", m.gmailMessageId, e); }
  const orgEmailsEarly = new Set(allowedEmails().concat(c.account.email));
  if (!orgEmailsEarly.has(from.email) && !gmail.isAutoSubmitted(msg) && c.owner.prefs?.pushMail !== false) {
    await ctx.scheduler.runAfter(0, internal.push.sendToUser, { userId: c.owner._id, title: from.name || from.email, body: gmail.header(msg, "Subject") || "(no subject)", href: `/mail?thread=${encodeURIComponent(m.gmailThreadId)}`, tag: `mail-${m.gmailThreadId}` });
  }
  const orgEmails = new Set(allowedEmails().concat(c.account.email));
  if (orgEmails.has(from.email) || gmail.isAutoSubmitted(msg)) return;
  const body = gmail.parseBody(msg.payload);
  const text = (body.text ?? gmail.htmlToText(body.html ?? "")).slice(0, 6000);
  const subject = gmail.header(msg, "Subject");
  const thisDate = Number(msg.internalDate ?? Date.now());
  const earlier = c.index.filter((r) => r.date < thisDate && r.gmailMessageId !== m.gmailMessageId);
  const isFirst = earlier.length === 0;

  // Classification runs once per new inbound message regardless of rules, so tags and summaries show up in the list.
  if (process.env.ANTHROPIC_API_KEY && c.tags.length) {
    try {
      const ai = await ctx.runAction(internal.ai.classifyEmail, { subject, from: from.email, text, tags: c.tags.map((t) => ({ id: t._id, name: t.name, hint: t.aiHint ?? "" })) });
      await ctx.runMutation(internal.autoReply.annotate, { threadId: m.threadId, aiSummary: ai.summary, suggestedTagIds: ai.tagIds as Id<"tags">[], smartCategory: ai.category });
      if (ai.intent === "reschedule") {
        await ctx.runMutation(internal.mail.noteRescheduleRequest, { threadId: m.threadId, senderEmail: from.email, fromDate: ai.rescheduleFrom ?? undefined, toDate: ai.rescheduleTo ?? undefined });
        await ctx.scheduler.runAfter(0, internal.bookings.recheckReschedules, {});
      }
    } catch (e) { console.error("classify failed", e); }
  }

  for (const rule of c.rules) {
    if (rule.trigger === "first" && !isFirst) continue;
    if (rule.trigger === "followUp" && isFirst) continue;
    if (rule.senderDomains.length && !rule.senderDomains.some((d) => from.email.endsWith(`@${d.toLowerCase()}`) || from.email.endsWith(`.${d.toLowerCase()}`))) continue;
    if (rule.businessHoursOnly && !withinHours(c.hours, thisDate)) continue;
    if (rule.contentMode === "keywords") {
      const hay = `${subject}\n${text}`.toLowerCase();
      if (!rule.keywords.some((k) => k.trim() && hay.includes(k.trim().toLowerCase()))) continue;
    } else if (rule.contentMode === "ai") {
      if (!process.env.ANTHROPIC_API_KEY) { await ctx.runMutation(internal.autoReply.record, { ruleId: rule._id, threadId: m.threadId, accountId, inboundGmailMessageId: m.gmailMessageId, action: "skipped", reason: "ANTHROPIC_API_KEY not set" }); continue; }
      const verdict = await ctx.runAction(internal.ai.matchesCondition, { condition: rule.aiPrompt ?? "", subject, from: from.email, text });
      if (!verdict.matches) continue;
    }
    // One auto-reply per thread per sender per week.
    const recent = c.logs.filter((l) => l.action !== "skipped" && l.at > Date.now() - 7 * 86_400_000);
    const sameSender = earlier.some((r) => r.from === from.email);
    if (recent.length && sameSender) { await ctx.runMutation(internal.autoReply.record, { ruleId: rule._id, threadId: m.threadId, accountId, inboundGmailMessageId: m.gmailMessageId, action: "skipped", reason: "Already auto-replied to this sender on this thread this week", addTagIds: rule.addTagIds, assignTo: rule.assignTo }); if (rule.stopAfterMatch) break; continue; }

    const vars = { first_name: from.name.split(" ")[0] || "there", name: from.name, subject, sender_email: from.email, my_name: c.owner.name, practice: "Barbara Fraser & Associates" };
    const html = merge(rule.bodyTemplate, vars);
    const replySubject = rule.subjectTemplate ? merge(rule.subjectTemplate, vars) : (subject.toLowerCase().startsWith("re:") ? subject : `Re: ${subject}`);
    const rfc = gmail.normaliseMessageId(gmail.header(msg, "Message-ID"));
    const refs = gmail.header(msg, "References").split(/\s+/).filter(Boolean).map(gmail.normaliseMessageId).concat(rfc ? [rfc] : []);
    const replyTo = gmail.parseAddresses(gmail.header(msg, "Reply-To"))[0] ?? from;
    const raw = gmail.buildRaw({ from: { name: c.owner.name, email: c.account.email }, to: [replyTo], subject: replySubject, html, inReplyTo: rfc, references: refs, extraHeaders: { "Auto-Submitted": "auto-replied", "X-Auto-Response-Suppress": "All", "X-Mailer": "Happy Days" } });
    if (rule.mode === "send") await gmail.sendRaw(token, raw, m.gmailThreadId);
    else await gmail.createDraft(token, raw, m.gmailThreadId);
    await ctx.runMutation(internal.autoReply.record, { ruleId: rule._id, threadId: m.threadId, accountId, inboundGmailMessageId: m.gmailMessageId, action: rule.mode === "send" ? "sent" : "drafted", addTagIds: rule.addTagIds, assignTo: rule.assignTo });
    if (rule.mode === "send") { const t = await gmail.getThread(token, m.gmailThreadId, "metadata"); await ctx.runMutation(internal.mail.indexHeaders, { accountId, threads: [threadToIndex(t)] }); }
    if (rule.stopAfterMatch) break;
  }
}

function threadToIndex(t: gmail.GmailThread) {
  const msgs = t.messages ?? [];
  const emailsOf = (value: string) => gmail.parseAddresses(value).map((a) => a.email);
  return {
    gmailThreadId: t.id,
    subject: gmail.header(msgs[0], "Subject") || "(no subject)",
    messages: msgs.map((m) => ({ gmailMessageId: m.id, gmailThreadId: t.id, rfcMessageId: gmail.normaliseMessageId(gmail.header(m, "Message-ID")) || `gmail:${m.id}`, inReplyTo: gmail.normaliseMessageId(gmail.header(m, "In-Reply-To")) || undefined, references: gmail.header(m, "References").split(/\s+/).filter(Boolean).map(gmail.normaliseMessageId), from: emailsOf(gmail.header(m, "From"))[0] ?? "", to: emailsOf(gmail.header(m, "To")), cc: emailsOf(gmail.header(m, "Cc")), date: Number(m.internalDate ?? 0), autoSubmitted: gmail.isAutoSubmitted(m), hasAttachments: false, isDraft: (m.labelIds ?? []).includes("DRAFT") })),
  };
}
