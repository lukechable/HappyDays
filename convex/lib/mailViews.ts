import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/** One definition for badges, dashboard, list membership and thread pills. */
export function isOverdue(t: Doc<"threads">, hours: number, now: number) {
  return t.bothIncluded && t.lastDirection === "in" && t.lastInboundAt !== undefined
    && t.lastInboundAt < now - hours * 3_600_000
    && !t.repliedBy.length && !(t.repliedByEmails ?? []).length && !t.autoRepliedAt
    && !(t.snoozedUntil && t.snoozedUntil > now);
}

export async function overdueThreads(ctx: QueryCtx, user: Doc<"users">, now = Date.now()) {
  const hours = user.prefs?.overdueHours ?? 48;
  const rows = await ctx.db.query("threads").withIndex("by_overdue", q => q.eq("bothIncluded", true).eq("lastDirection", "in").lt("lastInboundAt", now - hours * 3_600_000)).collect();
  return rows.filter(t => isOverdue(t, hours, now)).sort((a, b) => b.lastMessageAt - a.lastMessageAt || a._id.localeCompare(b._id));
}
