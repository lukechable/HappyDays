import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { firstName, requireUser } from "./lib/auth";
import { audit } from "./lib/audit";
import { notify } from "./notifications";

const kindV = v.union(v.literal("affidavit"), v.literal("appearance"));
export type CourtKind = "affidavit" | "appearance";

/** The statuses each kind moves through, first is the default, the last two are finished. */
export const STATUSES: Record<CourtKind, readonly string[]> = {
  affidavit: ["requested", "drafting", "sworn", "sent", "withdrawn"],
  appearance: ["scheduled", "attended", "adjourned", "vacated"],
};
export const isDone = (kind: CourtKind, status: string) => (kind === "affidavit" ? status === "sent" || status === "withdrawn" : status !== "scheduled");

export const list = query({
  args: { kind: kindV },
  handler: async (ctx, { kind }) => {
    await requireUser(ctx);
    const rows = await ctx.db.query("courtItems").withIndex("by_kind", (q) => q.eq("kind", kind)).collect();
    const users = new Map((await ctx.db.query("users").collect()).map((u) => [u._id, firstName(u)]));
    const matters = new Map((await ctx.db.query("matters").collect()).map((m) => [m._id, m]));
    return rows
      .map((r) => { const m = r.matterId ? matters.get(r.matterId) : undefined; return { ...r, createdByName: users.get(r.createdBy) ?? "?", matter: m ? { _id: m._id, name: m.name, court: m.court, courtFileNo: m.courtFileNo } : undefined, done: isDone(kind, r.status) }; })
      // Open items first, soonest date first; items with no date last; finished ones after that, newest first.
      .sort((a, b) => (Number(a.done) - Number(b.done)) || (a.done ? b.updatedAt - a.updatedAt : (a.at ?? Infinity) - (b.at ?? Infinity)));
  },
});

export const save = mutation({
  args: { id: v.optional(v.id("courtItems")), kind: kindV, title: v.string(), matterId: v.optional(v.id("matters")), party: v.optional(v.string()), at: v.optional(v.number()), status: v.optional(v.string()), notes: v.optional(v.string()) },
  handler: async (ctx, { id, ...a }) => {
    const user = await requireUser(ctx);
    const title = a.title.trim();
    if (!title) throw new Error("Give it a title.");
    if (a.status && !STATUSES[a.kind].includes(a.status)) throw new Error("Unknown status.");
    const fields = { title, matterId: a.matterId, party: a.party?.trim() || undefined, at: a.at, notes: a.notes?.trim() || undefined, updatedAt: Date.now() };
    if (id) {
      const prev = await ctx.db.get(id);
      if (!prev) throw new Error("Not found.");
      await ctx.db.patch(id, { ...fields, status: a.status ?? prev.status });
      await audit(ctx, { userId: user._id, action: "court.update", subjectKind: a.kind, subjectId: id, detail: title });
      return id;
    }
    const status = a.status ?? STATUSES[a.kind][0];
    const newId = await ctx.db.insert("courtItems", { kind: a.kind, ...fields, status, createdBy: user._id, createdAt: Date.now() });
    await audit(ctx, { userId: user._id, action: "court.create", subjectKind: a.kind, subjectId: newId, detail: title });
    const others = (await ctx.db.query("users").collect()).filter((u) => u._id !== user._id);
    for (const o of others) await notify(ctx, { userId: o._id, kind: `court.${a.kind}`, title: a.kind === "affidavit" ? `Affidavit requested: ${title}` : `Court appearance: ${title}`, body: `${firstName(user)} added it${a.party ? ` · ${a.party}` : ""}`, href: a.kind === "affidavit" ? "/court/affidavits" : "/court/appearances" });
    return newId;
  },
});

export const setStatus = mutation({
  args: { id: v.id("courtItems"), status: v.string() },
  handler: async (ctx, { id, status }) => {
    const user = await requireUser(ctx);
    const r = await ctx.db.get(id);
    if (!r) throw new Error("Not found.");
    if (!STATUSES[r.kind].includes(status)) throw new Error("Unknown status.");
    await ctx.db.patch(id, { status, updatedAt: Date.now() });
    await audit(ctx, { userId: user._id, action: "court.status", subjectKind: r.kind, subjectId: id, detail: `${r.title}: ${status}` });
  },
});

export const remove = mutation({
  args: { id: v.id("courtItems") },
  handler: async (ctx, { id }) => {
    const user = await requireUser(ctx);
    const r = await ctx.db.get(id);
    if (!r) return;
    await ctx.db.delete(id);
    await audit(ctx, { userId: user._id, action: "court.delete", subjectKind: r.kind, subjectId: id, detail: r.title });
  },
});
