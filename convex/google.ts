import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import type { ActionCtx } from "./_generated/server";
import { decrypt, encrypt, randomToken } from "./lib/crypto";
import { GMAIL_SCOPES, exchangeCode, profile, refreshAccessToken, stopWatch, watch } from "./lib/gmail";

/** Where Google sends the user back. APP_URL must be the public site URL; a missing value is an error, never localhost. */
export const redirectUri = () => {
  const base = process.env.APP_URL;
  if (!base || /localhost/.test(base)) throw new Error("APP_URL is not set to the public site URL on the Convex deployment.");
  return `${base.replace(/\/$/, "")}/api/google/callback`;
};

/** Step 1 of connecting: a Google consent URL bound to this user by a one-time state token. */
export const authUrl = action({
  args: {},
  handler: async (ctx): Promise<string> => {
    const me = await ctx.runQuery(internal.googleData.meForAction, {});
    if (!me) throw new Error("Sign in first.");
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) throw new Error("GOOGLE_CLIENT_ID is not set on the Convex deployment.");
    const state = randomToken(18);
    await ctx.runMutation(internal.settings.setInternal, { key: `google.oauthState:${me._id}`, value: { state, at: Date.now() } });
    const p = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri(),
      response_type: "code",
      scope: GMAIL_SCOPES.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "true",
      login_hint: me.email,
      hd: me.email.split("@")[1] ?? "",
      state: `${me._id}.${state}`,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
  },
});

/** Step 2: the callback route hands us the code. Tokens are encrypted before they touch the database. */
export const exchange = action({
  args: { code: v.string(), state: v.string() },
  handler: async (ctx, { code, state }): Promise<{ email: string }> => {
    const me = await ctx.runQuery(internal.googleData.meForAction, {});
    if (!me) throw new Error("Sign in first.");
    const [userId, token] = state.split(".");
    if (userId !== me._id) throw new Error("This sign-in was started by a different user.");
    const saved = (await ctx.runQuery(internal.settings.getInternal, { key: `google.oauthState:${me._id}` })) as { state: string; at: number } | null;
    if (!saved || saved.state !== token || Date.now() - saved.at > 15 * 60_000) throw new Error("The Google sign-in expired. Start again from Settings.");
    const t = await exchangeCode(code, redirectUri());
    const prof = await profile(t.accessToken);
    if (prof.emailAddress.toLowerCase() !== me.email.toLowerCase()) throw new Error(`You signed in to Google as ${prof.emailAddress}, but Happy Days is signed in as ${me.email}. Connect the matching account.`);
    const accountId = await ctx.runMutation(internal.googleData.upsertAccount, {
      userId: me._id,
      email: prof.emailAddress.toLowerCase(),
      refreshTokenEnc: await encrypt(t.refreshToken),
      accessToken: t.accessToken,
      accessTokenExpiresAt: t.expiresAt,
      scopes: t.scope.split(" ").filter(Boolean),
      historyId: prof.historyId,
    });
    await ctx.runMutation(internal.settings.setInternal, { key: `google.oauthState:${me._id}`, value: null });
    await ctx.runAction(internal.google.ensureWatch, { accountId });
    await ctx.scheduler.runAfter(15_000, internal.mail.indexRecent, { accountId, days: 30 });
    return { email: prof.emailAddress };
  },
});

export const disconnect = action({
  args: {},
  handler: async (ctx) => {
    const me = await ctx.runQuery(internal.googleData.meForAction, {});
    if (!me) throw new Error("Sign in first.");
    const account = await ctx.runQuery(internal.googleData.accountForUser, { userId: me._id });
    if (!account) return;
    try { const token = await accessTokenFor(ctx, account._id); await stopWatch(token); } catch { /* token may already be dead */ }
    try { const refresh = await decrypt(account.refreshTokenEnc); await fetch("https://oauth2.googleapis.com/revoke", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: refresh }) }); } catch { /* best effort */ }
    await ctx.runMutation(internal.googleData.setStatus, { accountId: account._id, status: "disconnected" });
  },
});

/** A short-lived access token for the signed-in user's own mailbox; the attachment route streams with it. */
export const accessToken = action({
  args: {},
  handler: async (ctx): Promise<{ token: string; accountId: Id<"googleAccounts">; email: string } | null> => {
    const me = await ctx.runQuery(internal.googleData.meForAction, {});
    if (!me) return null;
    const account = await ctx.runQuery(internal.googleData.accountForUser, { userId: me._id });
    if (!account || account.status !== "connected") return null;
    return { token: await accessTokenFor(ctx, account._id), accountId: account._id, email: account.email };
  },
});

/** Renew or start the Gmail push watch (they expire after 7 days). Skips quietly when no Pub/Sub topic is configured. */
export const ensureWatch = internalAction({
  args: { accountId: v.id("googleAccounts") },
  handler: async (ctx, { accountId }) => {
    const topic = process.env.GOOGLE_PUBSUB_TOPIC;
    if (!topic) return;
    const token = await accessTokenFor(ctx, accountId);
    const r = await watch(token, topic);
    await ctx.runMutation(internal.googleData.patchAccount, { accountId, patch: { watchExpiresAt: Number(r.expiration), historyId: r.historyId } });
  },
});

export const renewAllWatches = internalAction({
  args: {},
  handler: async (ctx) => {
    const accounts = await ctx.runQuery(internal.googleData.connectedAccounts, {});
    for (const a of accounts) {
      try { await ctx.runAction(internal.google.ensureWatch, { accountId: a._id }); }
      catch (e) { console.error("watch renew failed", a.email, e); }
    }
  },
});

/** Shared by every Gmail action: cached access token or a fresh one from the encrypted refresh token. */
export async function accessTokenFor(ctx: ActionCtx, accountId: Id<"googleAccounts">): Promise<string> {
  const account = await ctx.runQuery(internal.googleData.accountById, { accountId });
  if (!account || account.status === "disconnected") throw new Error("Google account is not connected.");
  if (account.accessToken && account.accessTokenExpiresAt && account.accessTokenExpiresAt > Date.now() + 30_000) return account.accessToken;
  try {
    const t = await refreshAccessToken(await decrypt(account.refreshTokenEnc));
    await ctx.runMutation(internal.googleData.patchAccount, { accountId, patch: { accessToken: t.accessToken, accessTokenExpiresAt: t.expiresAt, status: "connected" } });
    return t.accessToken;
  } catch (e) {
    await ctx.runMutation(internal.googleData.setStatus, { accountId, status: "needs_reauth" });
    throw e;
  }
}
