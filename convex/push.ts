"use node";

import { v } from "convex/values";
import webpush from "web-push";
import { action, internalAction } from "./_generated/server";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";

function configured(): boolean {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? "mailto:luke@barbarafraser.net", pub, priv);
  return true;
}

const payloadArgs = { title: v.string(), body: v.optional(v.string()), href: v.optional(v.string()), tag: v.optional(v.string()) };

type Payload = { title: string; body?: string; href?: string; tag?: string };

async function deliver(ctx: ActionCtx, subs: Doc<"pushSubscriptions">[], payload: Payload): Promise<number> {
  const body = JSON.stringify({ ...payload, at: Date.now() });
  let sent = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 60 * 60, urgency: "high" });
      sent++;
      await ctx.runMutation(internal.pushData.record, { id: s._id, ok: true });
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      await ctx.runMutation(internal.pushData.record, { id: s._id, ok: false, gone: status === 404 || status === 410 });
    }
  }));
  return sent;
}

/** Push one notification to every device a user has turned notifications on for. */
export const sendToUser = internalAction({
  args: { userId: v.id("users"), ...payloadArgs },
  handler: async (ctx, { userId, ...payload }): Promise<number> => {
    if (!configured()) return 0;
    const subs: Doc<"pushSubscriptions">[] = await ctx.runQuery(internal.pushData.subsForUser, { userId });
    if (!subs.length) return 0;
    return await deliver(ctx, subs, payload);
  },
});

export const sendTest = action({
  args: {},
  handler: async (ctx): Promise<number> => {
    const me = await ctx.runQuery(internal.googleData.meForAction, {});
    if (!me) throw new Error("Sign in first.");
    if (!configured()) throw new Error("Push is not configured on the server yet (VAPID keys).");
    const subs: Doc<"pushSubscriptions">[] = await ctx.runQuery(internal.pushData.subsForUser, { userId: me._id });
    if (!subs.length) throw new Error("Turn notifications on for this device first.");
    return await deliver(ctx, subs, { title: "Happy Days is set up", body: "Notifications reach this device.", href: "/settings?tab=notifications", tag: "test" });
  },
});
