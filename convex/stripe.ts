"use node";
import Stripe from "stripe";
import { internalAction, action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";

const stripe = () => {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set on the Convex deployment.");
  return new Stripe(key);
};

/** Verify and fan out a Stripe event. Invoices and payments are mirrored as status rows; bookings complete here. */
export const handleWebhook = internalAction({
  args: { payload: v.string(), signature: v.string() },
  handler: async (ctx, { payload, signature }) => {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) throw new Error("STRIPE_WEBHOOK_SECRET is not set");
    const event = stripe().webhooks.constructEvent(payload, signature, secret);
    switch (event.type) {
      case "invoice.created": case "invoice.finalized": case "invoice.sent": case "invoice.paid": case "invoice.payment_failed": case "invoice.voided": case "invoice.marked_uncollectible": case "invoice.updated": {
        await ctx.runMutation(internal.money.upsertInvoice, { invoice: shapeInvoice(event.data.object as Stripe.Invoice) });
        break;
      }
      case "checkout.session.completed": case "checkout.session.async_payment_succeeded": {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.metadata?.bookingSessionId && s.payment_status === "paid") {
          const booking = await ctx.runQuery(internal.bookings.sessionById, { id: s.metadata.bookingSessionId as Id<"bookingSessions"> });
          if (!booking || s.currency !== "aud" || s.amount_total !== booking.amountCents || (booking.stripeCheckoutSessionId && booking.stripeCheckoutSessionId !== s.id)) throw new Error("Booking payment does not match the expected checkout, currency or amount.");
        }
        await ctx.runMutation(internal.money.upsertPayment, { payment: { stripeId: s.id, kind: "checkout", amountCents: s.amount_total ?? 0, currency: (s.currency ?? "aud").toUpperCase(), status: s.payment_status, customerEmail: s.customer_details?.email ?? s.customer_email ?? undefined, description: s.metadata?.description, bookingSessionId: (s.metadata?.bookingSessionId as Id<"bookingSessions"> | undefined), createdAt: s.created * 1000 } });
        if (s.metadata?.bookingSessionId && s.payment_status === "paid") await ctx.runAction(internal.bookings.completePaid, { bookingSessionId: s.metadata.bookingSessionId as Id<"bookingSessions">, stripeCheckoutSessionId: s.id, stripePaymentIntentId: typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id });
        break;
      }
      case "checkout.session.expired": case "checkout.session.async_payment_failed": {
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.metadata?.bookingSessionId) await ctx.runMutation(internal.bookings.markFailed, { bookingSessionId: s.metadata.bookingSessionId as Id<"bookingSessions">, error: event.type === "checkout.session.expired" ? "Checkout expired" : "Payment failed" });
        break;
      }
      case "payment_intent.succeeded": case "payment_intent.payment_failed": case "payment_intent.canceled": {
        const p = event.data.object as Stripe.PaymentIntent;
        await ctx.runMutation(internal.money.upsertPayment, { payment: { stripeId: p.id, kind: "payment_intent", amountCents: p.amount, currency: p.currency.toUpperCase(), status: p.status, customerEmail: p.receipt_email ?? undefined, description: p.description ?? undefined, createdAt: p.created * 1000 } });
        break;
      }
      default: break;
    }
  },
});

export function shapeInvoice(i: Stripe.Invoice) {
  return {
    stripeId: i.id ?? "",
    number: i.number ?? undefined,
    customerEmail: i.customer_email ?? undefined,
    customerName: i.customer_name ?? undefined,
    amountDueCents: i.amount_due,
    amountPaidCents: i.amount_paid,
    currency: i.currency.toUpperCase(),
    status: i.status ?? "draft",
    hostedUrl: i.hosted_invoice_url ?? undefined,
    pdfUrl: i.invoice_pdf ?? undefined,
    dueAt: i.due_date ? i.due_date * 1000 : undefined,
    paidAt: i.status_transitions?.paid_at ? i.status_transitions.paid_at * 1000 : undefined,
    createdAt: i.created * 1000,
    description: i.description ?? i.lines?.data?.[0]?.description ?? undefined,
    matterId: (i.metadata?.matterId as Id<"matters"> | undefined) ?? undefined,
  };
}

/** Pull the last 90 days of invoices and payments once, so the money table is right before the first webhook. */
export const backfill = action({
  args: {},
  handler: async (ctx) => {
    const me = await ctx.runQuery(internal.googleData.meForAction, {});
    if (!me) throw new Error("Sign in first.");
    const s = stripe();
    const since = Math.floor(Date.now() / 1000) - 90 * 86400;
    let count = 0;
    for await (const inv of s.invoices.list({ created: { gte: since }, limit: 100 })) { await ctx.runMutation(internal.money.upsertInvoice, { invoice: shapeInvoice(inv) }); count++; }
    for await (const p of s.paymentIntents.list({ created: { gte: since }, limit: 100 })) { await ctx.runMutation(internal.money.upsertPayment, { payment: { stripeId: p.id, kind: "payment_intent", amountCents: p.amount, currency: p.currency.toUpperCase(), status: p.status, customerEmail: p.receipt_email ?? undefined, description: p.description ?? undefined, createdAt: p.created * 1000 } }); count++; }
    return { count };
  },
});

/** Raise a Stripe invoice against a matter from the Money page. */
export const createInvoice = action({
  args: { matterId: v.optional(v.id("matters")), customerEmail: v.string(), customerName: v.string(), description: v.string(), amountCents: v.number(), daysUntilDue: v.number(), send: v.boolean() },
  handler: async (ctx, a): Promise<{ stripeId: string; hostedUrl?: string }> => {
    const me = await ctx.runQuery(internal.googleData.meForAction, {});
    if (!me) throw new Error("Sign in first.");
    const s = stripe();
    const existing = await s.customers.list({ email: a.customerEmail, limit: 1 });
    const customer = existing.data[0] ?? (await s.customers.create({ email: a.customerEmail, name: a.customerName }));
    const invoice = await s.invoices.create({ customer: customer.id, collection_method: "send_invoice", days_until_due: a.daysUntilDue, currency: "aud", description: a.description, metadata: { matterId: a.matterId ?? "" }, auto_advance: false });
    await s.invoiceItems.create({ customer: customer.id, invoice: invoice.id, currency: "aud", amount: a.amountCents, description: a.description });
    let final = await s.invoices.finalizeInvoice(invoice.id);
    if (a.send) final = await s.invoices.sendInvoice(invoice.id);
    await ctx.runMutation(internal.money.upsertInvoice, { invoice: shapeInvoice(final) });
    return { stripeId: final.id, hostedUrl: final.hosted_invoice_url ?? undefined };
  },
});

/** Verify the actual booking payment at claim time, including refunds/disputes. A deposit never reaches here. */
export const verifyRebatePayment = internalAction({
  args: { checkoutId: v.string(), bookingSessionId: v.id("bookingSessions"), requiredCents: v.number() },
  handler: async (_ctx, a): Promise<boolean> => {
    const session = await stripe().checkout.sessions.retrieve(a.checkoutId, { expand: ["payment_intent.latest_charge"] });
    const payment = typeof session.payment_intent === "object" ? session.payment_intent : null;
    const charge = payment && typeof payment.latest_charge === "object" ? payment.latest_charge : null;
    return session.metadata?.bookingSessionId === a.bookingSessionId && session.payment_status === "paid" && session.currency === "aud"
      && (session.amount_total ?? 0) >= a.requiredCents && payment?.status === "succeeded" && payment.amount_received >= a.requiredCents
      && !!charge?.paid && !!charge.captured && !charge.refunded && charge.amount_refunded === 0 && !charge.disputed;
  },
});
