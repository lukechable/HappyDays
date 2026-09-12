import { practiceMonth } from "./lib/taskViews";
import { invoiceFlag } from "./lib/invoiceFlags";
import { internalMutation, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { requireUser } from "./lib/auth";
import { audit } from "./lib/audit";

const invoiceV = v.object({ stripeId: v.string(), number: v.optional(v.string()), customerEmail: v.optional(v.string()), customerName: v.optional(v.string()), amountDueCents: v.number(), amountPaidCents: v.number(), currency: v.string(), status: v.string(), hostedUrl: v.optional(v.string()), pdfUrl: v.optional(v.string()), dueAt: v.optional(v.number()), paidAt: v.optional(v.number()), createdAt: v.number(), description: v.optional(v.string()), matterId: v.optional(v.id("matters")) });

export const upsertInvoice = internalMutation({
  args: { invoice: invoiceV },
  handler: async (ctx, { invoice }) => {
    const existing = await ctx.db.query("stripeInvoices").withIndex("by_stripe", (q) => q.eq("stripeId", invoice.stripeId)).unique();
    const row = { ...invoice, matterId: invoice.matterId ?? existing?.matterId, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, row); else await ctx.db.insert("stripeInvoices", row);
  },
});

export const upsertPayment = internalMutation({
  args: { payment: v.object({ stripeId: v.string(), kind: v.union(v.literal("checkout"), v.literal("payment_intent"), v.literal("charge")), amountCents: v.number(), currency: v.string(), status: v.string(), customerEmail: v.optional(v.string()), description: v.optional(v.string()), bookingSessionId: v.optional(v.id("bookingSessions")), createdAt: v.number() }) },
  handler: async (ctx, { payment }) => {
    const existing = await ctx.db.query("stripePayments").withIndex("by_stripe", (q) => q.eq("stripeId", payment.stripeId)).unique();
    const row = { ...payment, updatedAt: Date.now() };
    if (existing) await ctx.db.patch(existing._id, row); else await ctx.db.insert("stripePayments", row);
  },
});

/** The paid-versus-delivered table: one row per invoice, joined to its matter's delivery state. */
export const table = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const invoices = await ctx.db.query("stripeInvoices").withIndex("by_created").order("desc").collect();
    const matters = new Map((await ctx.db.query("matters").collect()).map((m) => [m._id, m]));
    const rows = invoices.map((i) => {
      const m = i.matterId ? matters.get(i.matterId) : undefined;
      const delivered = !!m?.reportDeliveredAt;
      return {
        _id: i._id, stripeId: i.stripeId, number: i.number, customerName: i.customerName, customerEmail: i.customerEmail, description: i.description,
        amountCents: i.amountDueCents, currency: i.currency, status: i.status, hostedUrl: i.hostedUrl, pdfUrl: i.pdfUrl, dueAt: i.dueAt, paidAt: i.paidAt, createdAt: i.createdAt,
        matter: m ? { _id: m._id, name: m.name, status: m.status } : undefined,
        delivered, deliveredAt: m?.reportDeliveredAt, deliveredVia: m?.reportDeliveredVia,
        flag: invoiceFlag(i.status, m),
        daysInvoiceToDelivery: m?.reportDeliveredAt ? Math.round((m.reportDeliveredAt - i.createdAt) / 86_400_000) : undefined,
      };
    });
    const payments = await ctx.db.query("stripePayments").withIndex("by_created").order("desc").collect();
    return { rows, payments, counts: { paidNotDelivered: rows.filter((r) => r.flag === "paid_not_delivered").length, deliveredUnpaid: rows.filter((r) => r.flag === "delivered_unpaid").length, outstandingCents: invoices.filter((i) => i.status === "open" || i.status === "uncollectible").reduce((s, i) => s + Math.max(0, i.amountDueCents - i.amountPaidCents), 0) } };
  },
});

/**
 * The Transactions ledger: every Stripe payment (checkout, card, payment intent) and every invoice payment, as one
 * dated list. Invoices appear on the day they were paid, so the list reads as money actually received.
 */
export const transactions = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const payments = await ctx.db.query("stripePayments").withIndex("by_created").order("desc").collect();
    const invoices = await ctx.db.query("stripeInvoices").withIndex("by_created").order("desc").collect();
    const matters = new Map((await ctx.db.query("matters").collect()).map((m) => [m._id, m.name]));
    const rows = [
      ...payments.map((p) => ({ _id: p._id as string, at: p.createdAt, kind: "payment" as const, source: p.kind, description: p.description ?? (p.bookingSessionId ? "Online booking" : p.kind.replace("_", " ")), who: p.customerEmail, amountCents: p.amountCents, currency: p.currency, status: p.status, stripeId: p.stripeId, hostedUrl: undefined as string | undefined, matter: undefined as { _id: string; name: string } | undefined, booking: !!p.bookingSessionId })),
      ...invoices.filter((i) => i.status === "paid" || i.status === "open" || i.status === "uncollectible" || i.status === "void").map((i) => ({ _id: i._id as string, at: i.paidAt ?? i.createdAt, kind: "invoice" as const, source: "invoice" as const, description: i.description ?? `Invoice ${i.number ?? i.stripeId}`, who: i.customerName ?? i.customerEmail, amountCents: i.status === "paid" ? i.amountPaidCents || i.amountDueCents : i.amountDueCents, currency: i.currency, status: i.status, stripeId: i.stripeId, hostedUrl: i.hostedUrl, matter: i.matterId && matters.get(i.matterId) ? { _id: i.matterId as string, name: matters.get(i.matterId)! } : undefined, booking: false })),
    ].sort((a, b) => b.at - a.at);
    const received = (r: (typeof rows)[number]) => r.status === "succeeded" || r.status === "paid";
    const month = practiceMonth(Date.now());
    return { rows, totals: { receivedCents: rows.filter(received).reduce((s, r) => s + r.amountCents, 0), monthCents: rows.filter((r) => received(r) && practiceMonth(r.at) === month).reduce((s, r) => s + r.amountCents, 0), count: rows.length, openCents: rows.filter((r) => r.kind === "invoice" && (r.status === "open" || r.status === "uncollectible")).reduce((s, r) => s + r.amountCents, 0) } };
  },
});

export const linkInvoiceToMatter = mutation({
  args: { invoiceId: v.id("stripeInvoices"), matterId: v.optional(v.id("matters")) },
  handler: async (ctx, { invoiceId, matterId }) => {
    const user = await requireUser(ctx);
    await ctx.db.patch(invoiceId, { matterId, updatedAt: Date.now() });
    if (matterId) await ctx.db.insert("matterLinks", { matterId, kind: "invoice", refId: invoiceId, createdAt: Date.now() });
    await audit(ctx, { userId: user._id, action: "money.linkInvoice", subjectKind: "invoice", subjectId: invoiceId, detail: matterId });
  },
});
