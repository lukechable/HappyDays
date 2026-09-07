import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { ActionCtx, MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { currentUser, requireUser } from "./lib/auth";
import * as gmail from "./lib/gmail";

/*
 * Folder smarts. Every time someone files a conversation into a folder we remember who it came from
 * (sender, sender's domain unless it is a public mailbox provider, and the matter if one is linked).
 * Once the same sender or matter has gone to the same folder twice, and that folder still wins most of
 * the time, new mail from them is filed there on arrival. Taking the label off again teaches the reverse.
 * Manual rules (sender / domain / subject phrase → folder) fire straight away.
 */

const PUBLIC_DOMAINS = new Set(["gmail.com", "googlemail.com", "outlook.com", "outlook.com.au", "hotmail.com", "hotmail.com.au", "live.com", "live.com.au", "yahoo.com", "yahoo.com.au", "icloud.com", "me.com", "mac.com", "bigpond.com", "bigpond.net.au", "optusnet.com.au", "tpg.com.au", "iinet.net.au", "internode.on.net", "protonmail.com", "proton.me", "aol.com", "msn.com"]);

const LEARN_MIN = 2;
export const domainOf = (email: string) => email.split("@")[1]?.toLowerCase() ?? "";
/** Gmail user labels are `Label_<n>`; everything else (INBOX, STARRED, CATEGORY_*) is system. */
export const userLabelIds = (ids: string[]) => ids.filter((id) => id.startsWith("Label_"));

type Kind = Doc<"labelRules">["kind"];
export type RuleHit = { ruleId: Id<"labelRules">; labelId: string; labelName: string };

function winner(group: Doc<"labelRules">[]): Doc<"labelRules"> | null {
  const manual = group.find((r) => r.source === "manual" && r.enabled);
  if (manual) return manual;
  const live = group.filter((r) => r.enabled);
  if (!live.length) return null;
  const total = live.reduce((n, r) => n + r.count, 0);
  const best = live.slice().sort((a, b) => b.count - a.count)[0];
  return best.count >= LEARN_MIN && best.count / Math.max(1, total) >= 0.6 ? best : null;
}

async function accountFor(ctx: QueryCtx | MutationCtx) {
  const user = await currentUser(ctx);
  if (!user) return null;
  return await ctx.db.query("googleAccounts").withIndex("by_user", (q) => q.eq("userId", user._id)).first();
}

async function keysForThread(ctx: QueryCtx | MutationCtx, t: Doc<"threads">): Promise<Array<[Kind, string]>> {
  const index = await ctx.db.query("messageIndex").withIndex("by_thread", (q) => q.eq("threadId", t._id)).collect();
  const first = index.find((m) => m.direction === "in") ?? index[0];
  const sender = first ? gmail.parseAddresses(first.from)[0]?.email?.toLowerCase() : undefined;
  const keys: Array<[Kind, string]> = [];
  if (sender) { keys.push(["sender", sender]); const d = domainOf(sender); if (d && !PUBLIC_DOMAINS.has(d)) keys.push(["domain", d]); }
  if (t.matterId) keys.push(["matter", t.matterId]);
  return keys;
}

const byKey = (ctx: QueryCtx | MutationCtx, accountId: Id<"googleAccounts">, kind: Kind, value: string) =>
  ctx.db.query("labelRules").withIndex("by_account_kind_value", (q) => q.eq("accountId", accountId).eq("kind", kind).eq("value", value)).collect();

/* ---------------- staff-facing ---------------- */

export type RuleRow = Doc<"labelRules"> & { status: "active" | "learning" | "off"; matterName?: string };

export const list = query({
  args: {},
  handler: async (ctx): Promise<RuleRow[]> => {
    const account = await accountFor(ctx);
    if (!account) return [];
    const rules = await ctx.db.query("labelRules").withIndex("by_account", (q) => q.eq("accountId", account._id)).order("desc").collect();
    const groups = new Map<string, Doc<"labelRules">[]>();
    for (const r of rules) { const k = `${r.kind}|${r.value}`; groups.set(k, [...(groups.get(k) ?? []), r]); }
    return await Promise.all(rules.map(async (r) => {
      const w = winner(groups.get(`${r.kind}|${r.value}`) ?? [r]);
      const matter = r.kind === "matter" ? await ctx.db.get(r.value as Id<"matters">) : null;
      return { ...r, status: !r.enabled ? "off" : w?._id === r._id ? "active" : "learning", matterName: matter?.name };
    }));
  },
});

export const add = mutation({
  args: { kind: v.union(v.literal("sender"), v.literal("domain"), v.literal("subject")), value: v.string(), labelId: v.string(), labelName: v.string() },
  handler: async (ctx, { kind, value, labelId, labelName }) => {
    await requireUser(ctx);
    const account = await accountFor(ctx);
    if (!account) throw new Error("Connect your Google account first.");
    const clean = value.trim().toLowerCase().replace(/^@/, "");
    if (!clean) throw new Error("Type something to match on.");
    if (kind === "sender" && !clean.includes("@")) throw new Error("Sender must be an email address.");
    if (kind === "domain" && (clean.includes("@") || !clean.includes("."))) throw new Error("Domain looks like example.com.");
    const existing = (await byKey(ctx, account._id, kind, clean)).find((r) => r.labelId === labelId);
    if (existing) { await ctx.db.patch(existing._id, { source: "manual", enabled: true, labelName, lastAt: Date.now() }); return existing._id; }
    return await ctx.db.insert("labelRules", { accountId: account._id, kind, value: clean, labelId, labelName, count: 0, lastAt: Date.now(), enabled: true, source: "manual" });
  },
});

export const setEnabled = mutation({
  args: { id: v.id("labelRules"), enabled: v.boolean() },
  handler: async (ctx, { id, enabled }) => { await requireUser(ctx); const account = await accountFor(ctx); const r = await ctx.db.get(id); if (!r || r.accountId !== account?._id) throw new Error("Not your rule."); await ctx.db.patch(id, { enabled }); },
});

export const remove = mutation({
  args: { id: v.id("labelRules") },
  handler: async (ctx, { id }) => { await requireUser(ctx); const account = await accountFor(ctx); const r = await ctx.db.get(id); if (!r || r.accountId !== account?._id) throw new Error("Not your rule."); await ctx.db.delete(id); },
});

/* ---------------- learning ---------------- */

/** Called after a staff member adds or removes user labels on threads. */
export const learn = internalMutation({
  args: { accountId: v.id("googleAccounts"), gmailThreadIds: v.array(v.string()), add: v.array(v.object({ id: v.string(), name: v.string() })), remove: v.array(v.string()) },
  handler: async (ctx, { accountId, gmailThreadIds, add, remove }) => {
    const now = Date.now();
    for (const gid of gmailThreadIds) {
      const lk = await ctx.db.query("threadLookup").withIndex("by_account_gmail", (q) => q.eq("accountId", accountId).eq("gmailThreadId", gid)).unique();
      const t = lk ? await ctx.db.get(lk.threadId) : null;
      if (!t) continue;
      const keys = await keysForThread(ctx, t);
      for (const [kind, value] of keys) {
        const rules = await byKey(ctx, accountId, kind, value);
        for (const l of add) {
          const r = rules.find((x) => x.labelId === l.id);
          if (r) await ctx.db.patch(r._id, { count: r.count + 1, lastAt: now, labelName: l.name });
          else await ctx.db.insert("labelRules", { accountId, kind, value, labelId: l.id, labelName: l.name, count: 1, lastAt: now, enabled: true, source: "learned" });
        }
        for (const labelId of remove) {
          const r = rules.find((x) => x.labelId === labelId);
          if (!r) continue;
          const count = Math.max(0, r.count - 1);
          if (count === 0 && r.source === "learned") await ctx.db.delete(r._id);
          else await ctx.db.patch(r._id, { count, lastAt: now });
        }
      }
      if (remove.length) {
        const logs = await ctx.db.query("labelRuleLog").withIndex("by_thread", (q) => q.eq("threadId", t._id)).collect();
        for (const l of logs) if (remove.includes(l.labelId)) await ctx.db.delete(l._id);
      }
    }
  },
});

export const match = internalQuery({
  args: { accountId: v.id("googleAccounts"), senderEmail: v.string(), subject: v.string(), matterId: v.optional(v.id("matters")) },
  handler: async (ctx, { accountId, senderEmail, subject, matterId }): Promise<RuleHit[]> => {
    const sender = senderEmail.toLowerCase();
    const keys: Array<[Kind, string]> = [["sender", sender]];
    const d = domainOf(sender); if (d) keys.push(["domain", d]);
    if (matterId) keys.push(["matter", matterId]);
    const groups: Doc<"labelRules">[][] = [];
    for (const [kind, value] of keys) groups.push(await byKey(ctx, accountId, kind, value));
    const subj = subject.toLowerCase();
    const subjectRules = await ctx.db.query("labelRules").withIndex("by_account_kind_value", (q) => q.eq("accountId", accountId).eq("kind", "subject")).collect();
    const bySubject = new Map<string, Doc<"labelRules">[]>();
    for (const r of subjectRules) if (r.enabled && subj.includes(r.value)) bySubject.set(r.value, [...(bySubject.get(r.value) ?? []), r]);
    groups.push(...bySubject.values());
    const seen = new Set<string>();
    const hits: RuleHit[] = [];
    for (const g of groups) { const w = winner(g); if (w && !seen.has(w.labelId)) { seen.add(w.labelId); hits.push({ ruleId: w._id, labelId: w.labelId, labelName: w.labelName }); } }
    return hits;
  },
});

export const logApplied = internalMutation({
  args: { accountId: v.id("googleAccounts"), threadId: v.id("threads"), applied: v.array(v.object({ ruleId: v.id("labelRules"), labelId: v.string(), labelName: v.string() })) },
  handler: async (ctx, { accountId, threadId, applied }) => {
    const existing = await ctx.db.query("labelRuleLog").withIndex("by_thread", (q) => q.eq("threadId", threadId)).collect();
    for (const a of applied) if (!existing.some((e) => e.labelId === a.labelId)) await ctx.db.insert("labelRuleLog", { ...a, accountId, threadId, at: Date.now() });
  },
});

/** A folder was deleted in the app: its rules go with it. */
export const dropLabel = internalMutation({
  args: { accountId: v.id("googleAccounts"), labelId: v.string() },
  handler: async (ctx, { accountId, labelId }) => {
    const rules = (await ctx.db.query("labelRules").withIndex("by_account", (q) => q.eq("accountId", accountId)).collect()).filter((r) => r.labelId === labelId);
    for (const r of rules) await ctx.db.delete(r._id);
  },
});

export const renameLabel = internalMutation({
  args: { accountId: v.id("googleAccounts"), labelId: v.string(), name: v.string() },
  handler: async (ctx, { accountId, labelId, name }) => {
    const rules = (await ctx.db.query("labelRules").withIndex("by_account", (q) => q.eq("accountId", accountId)).collect()).filter((r) => r.labelId === labelId);
    for (const r of rules) await ctx.db.patch(r._id, { labelName: name });
  },
});

/** Runs for each new inbound message: apply winning rules in Gmail and remember that we did. */
export async function fileByRules(ctx: ActionCtx, a: { accountId: Id<"googleAccounts">; threadId: Id<"threads">; gmailThreadId: string; senderEmail: string; subject: string; matterId?: Id<"matters">; existingLabelIds: string[]; token: string }): Promise<RuleHit[]> {
  const hits: RuleHit[] = await ctx.runQuery(internal.labelRules.match, { accountId: a.accountId, senderEmail: a.senderEmail, subject: a.subject, matterId: a.matterId });
  const add = hits.filter((h) => !a.existingLabelIds.includes(h.labelId));
  if (!add.length) return [];
  const applied: RuleHit[] = [];
  for (const h of add) {
    try { await gmail.modifyThread(a.token, a.gmailThreadId, [h.labelId], []); applied.push(h); }
    catch (e) {
      // The folder no longer exists in Gmail: retire its rules rather than failing on every message.
      if (e instanceof gmail.GmailError && (e.status === 400 || e.status === 404)) await ctx.runMutation(internal.labelRules.dropLabel, { accountId: a.accountId, labelId: h.labelId });
      else throw e;
    }
  }
  if (applied.length) await ctx.runMutation(internal.labelRules.logApplied, { accountId: a.accountId, threadId: a.threadId, applied });
  return applied;
}
