import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const http = httpRouter();

/** Health check for Railway and uptime probes. */
http.route({ path: "/health", method: "GET", handler: httpAction(async () => new Response("ok", { status: 200 })) });

/**
 * Gmail push notifications arrive here via Google Pub/Sub. The subscription's push endpoint is
 * https://<deployment>.convex.site/gmail/push?token=<GOOGLE_PUBSUB_VERIFICATION_TOKEN>. We ack immediately and
 * sync in the background; Gmail's history log is the source of truth, not the notification payload.
 */
http.route({
  path: "/gmail/push",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const expected = process.env.GOOGLE_PUBSUB_VERIFICATION_TOKEN;
    const token = new URL(req.url).searchParams.get("token");
    if (!expected || token !== expected) return new Response("forbidden", { status: 403 });
    try {
      const body = (await req.json()) as { message?: { data?: string } };
      const data = body.message?.data ? JSON.parse(atob(body.message.data.replace(/-/g, "+").replace(/_/g, "/"))) as { emailAddress?: string } : null;
      if (data?.emailAddress) {
        const account = await ctx.runQuery(internal.googleData.accountByEmail, { email: data.emailAddress });
        if (account && account.status === "connected") await ctx.scheduler.runAfter(0, internal.mail.syncHistory, { accountId: account._id });
      }
    } catch (e) { console.error("gmail push parse failed", e); }
    return new Response(null, { status: 204 });
  }),
});

/** Stripe events. Signature is verified inside the handler with STRIPE_WEBHOOK_SECRET. */
http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const sig = req.headers.get("stripe-signature");
    const payload = await req.text();
    if (!sig) return new Response("missing signature", { status: 400 });
    try {
      await ctx.runAction(internal.stripe.handleWebhook, { payload, signature: sig });
      return new Response(null, { status: 200 });
    } catch (e) {
      console.error("stripe webhook rejected", e);
      return new Response("invalid", { status: 400 });
    }
  }),
});

/** Public download-code redemption, called by the Next route so the browser never sees storage URLs unredeemed. */
http.route({
  path: "/download",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const b = (await req.json().catch(() => ({}))) as { code?: string; pin?: string; fileId?: string; ip?: string; userAgent?: string };
    if (!b.code) return Response.json({ ok: false, reason: "unknown" }, { status: 400 });
    const r = await ctx.runMutation(internal.files.publicRedeem, { code: b.code, pin: b.pin, fileId: b.fileId as Id<"files"> | undefined, ip: b.ip, userAgent: b.userAgent });
    return Response.json(r);
  }),
});

export default http;
