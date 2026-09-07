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
    const invoices = await ctx.db.query("stripeInvoices").withIndex("by_created").order("desc").take(300);
    const matters = new Map((await ctx.db.query("matters").collect()).map((m) => [m._id, m]));
    const rows = invoices.map((i) => {
      const m = i.matterId ? matters.get(i.matterId) : undefined;
      const paid = i.status === "paid";
      const delivered = !!m?.reportDeliveredAt;
      return {
        _id: i._id, stripeId: i.stripeId, number: i.number, customerName: i.customerName, customerEmail: i.customerEmail, description: i.description,
        amountCents: i.amountDueCents, currency: i.currency, status: i.status, hostedUrl: i.hostedUrl, pdfUrl: i.pdfUrl, dueAt: i.dueAt, paidAt: i.paidAt, createdAt: i.createdAt,
        matter: m ? { _id: m._id, name: m.name, status: m.status } : undefined,
        delivered, deliveredAt: m?.reportDeliveredAt, deliveredVia: m?.reportDeliveredVia,
        flag: paid && !delivered ? "paid_not_delivered" : !paid && delivered ? "delivered_unpaid" : paid && delivered ? "complete" : "open",
        daysInvoiceToDelivery: m?.reportDeliveredAt ? Math.round((m.reportDeliveredAt - i.createdAt) / 86_400_000) : undefined,
      };
    });
    const payments = await ctx.db.query("stripePayments").withIndex("by_created").order("desc").take(100);
    return { rows, payments, counts: { paidNotDelivered: rows.filter((r) => r.flag === "paid_not_delivered").length, deliveredUnpaid: rows.filter((r) => r.flag === "delivered_unpaid").length, outstandingCents: invoices.filter((i) => i.status === "open" || i.status === "uncollectible").reduce((s, i) => s + Math.max(0, i.amountDueCents - i.amountPaidCents), 0) } };
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
