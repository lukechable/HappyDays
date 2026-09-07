import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { allowedEmails, currentUser, firstName, requireUser } from "./lib/auth";

/** Who am I, plus the rail badge counts. Null when signed out or not allowlisted. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return null;
    const google = await ctx.db.query("googleAccounts").withIndex("by_user", (q) => q.eq("userId", user._id)).first();
    const [assigned, tasks, unreadNotifications] = await Promise.all([
      ctx.db.query("threads").withIndex("by_assignee", (q) => q.eq("assignedTo", user._id).eq("assignmentDoneAt", undefined)).collect(),
      ctx.db.query("tasks").withIndex("by_assignee", (q) => q.eq("assigneeId", user._id).eq("status", "open")).collect(),
      ctx.db.query("notifications").withIndex("by_user", (q) => q.eq("userId", user._id).eq("readAt", undefined)).collect(),
    ]);
    const now = Date.now();
    const tasksDue = tasks.filter((t) => t.dueAt !== undefined && t.dueAt <= now + 86_400_000).length;
    const overdueHours = user.prefs?.overdueHours ?? 48;
    const overdue = await ctx.db.query("threads").withIndex("by_overdue", (q) => q.eq("bothIncluded", true).eq("lastDirection", "in").lt("lastInboundAt", now - overdueHours * 3_600_000)).collect();
    const signatures = await ctx.db.query("signatures").withIndex("by_user", (q) => q.eq("userId", user._id)).collect();
    const paidInvoices = (await ctx.db.query("stripeInvoices").withIndex("by_created").order("desc").take(300)).filter((i) => i.status === "paid" && i.matterId);
    let paidNotDelivered = 0;
    for (const i of paidInvoices) { const m = await ctx.db.get(i.matterId!); if (m && !m.reportDeliveredAt && m.status !== "closed") paidNotDelivered++; }
    return {
      _id: user._id,
      email: user.email,
      name: user.name,
      first: firstName(user),
      imageUrl: user.imageUrl,
      prefs: user.prefs ?? {},
      google: google ? { _id: google._id, email: google.email, status: google.status, lastSyncAt: google.lastSyncAt, watchExpiresAt: google.watchExpiresAt } : null,
      signatureCount: signatures.length,
      badges: { assigned: assigned.length, tasks: tasksDue, overdue: overdue.filter((t) => !t.repliedBy.length).length, notifications: unreadNotifications.length, paidNotDelivered },
    };
  },
});

/** Everyone in the organisation (the two of you), for assignment pickers. */
export const all = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const users = await ctx.db.query("users").collect();
    return users.filter((u) => allowedEmails().includes(u.email.toLowerCase())).map((u) => ({ _id: u._id, email: u.email, name: u.name, first: firstName(u), imageUrl: u.imageUrl }));
  },
});

/** Called once after sign-in: creates or refreshes the profile from Clerk's identity. */
export const ensure = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return null;
    const email = (identity.email ?? "").toLowerCase();
    if (!allowedEmails().includes(email)) return null;
    const name = identity.name ?? [identity.givenName, identity.familyName].filter(Boolean).join(" ") ?? email;
    const existing = await ctx.db.query("users").withIndex("by_clerk", (q) => q.eq("clerkId", identity.subject)).unique();
    if (existing) {
      await ctx.db.patch(existing._id, { email, name: name || existing.name, imageUrl: identity.pictureUrl ?? existing.imageUrl, lastSeenAt: Date.now() });
      return existing._id;
    }
    return await ctx.db.insert("users", { clerkId: identity.subject, email, name: name || email, imageUrl: identity.pictureUrl, lastSeenAt: Date.now() });
  },
});

export const updatePrefs = mutation({
  args: { prefs: v.object({ signatureAbove: v.optional(v.boolean()), overdueHours: v.optional(v.number()), showImages: v.optional(v.boolean()), signatureImage: v.optional(v.string()), initialsImage: v.optional(v.string()) }) },
  handler: async (ctx, { prefs }) => {
    const user = await requireUser(ctx);
    await ctx.db.patch(user._id, { prefs: { ...(user.prefs ?? {}), ...prefs } });
  },
});
