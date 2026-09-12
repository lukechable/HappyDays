"use node";
import { generateKeyPairSync, createPrivateKey, createPublicKey } from "node:crypto";
import { SignJWT, importPKCS8 } from "jose";
import { action, internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

/**
 * Guest access for testing before Clerk exists. The deployment mints its own RS256 JWTs (keypair generated once
 * and kept in the settings table), publishes the public key at /guest/jwks.json, and trusts them through the
 * customJwt provider in auth.config.ts. A guest is a real Convex identity: guest@… on the allowlist.
 * Switched on only while GUEST_PASSWORD is set on the deployment.
 */

export const GUEST_AUDIENCE = "happydays-guest";

/** Compare two strings without leaking their common prefix length through timing. */
function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a), eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}
export const GUEST_EMAIL = "guest@barbarafraser.net";

type KeyPair = { privatePem: string; publicJwk: Record<string, string>; kid: string; version: number };

async function keys(ctx: ActionCtx): Promise<KeyPair> {
  const existing = (await ctx.runQuery(internal.settings.getInternal, { key: "guest.keypair" })) as KeyPair | null;
  if (existing?.privatePem && existing.version === 2) return existing;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const jwk = createPublicKey(createPrivateKey(privatePem)).export({ format: "jwk" }) as Record<string, string>;
  const kid = `guest-${Date.now().toString(36)}`;
  const pair: KeyPair = { version: 2, privatePem, publicJwk: { ...jwk, kid, use: "sig", alg: "RS256" }, kid };
  return await ctx.runMutation(internal.guestData.installKeys, { pair });
}

/** Public JWKS document, served by the /guest/jwks.json HTTP route. */
export const jwks = internalAction({
  args: {},
  handler: async (ctx): Promise<{ keys: Array<Record<string, string>> }> => {
    if (!process.env.GUEST_PASSWORD) return { keys: [] };
    const k = await keys(ctx);
    return { keys: [k.publicJwk] };
  },
});

/** Exchange the guest password for a signed token. Password attempts are limited atomically across requests. */
export const issueToken = action({
  args: { password: v.string(), hours: v.optional(v.number()) },
  handler: async (ctx, { password, hours }): Promise<{ token: string; expiresAt: number }> => {
    const expected = process.env.GUEST_PASSWORD;
    if (!expected) throw new Error("Guest access is switched off on this deployment.");
    await ctx.runMutation(internal.guestData.attempt, {});
    if (password.length > 1024 || !timingSafeEqual(password, expected)) {
      await new Promise((r) => setTimeout(r, 800));
      throw new Error("That password isn’t right.");
    }
    await ctx.runMutation(internal.settings.setInternal, { key: "guest.failures", value: { count: 0, at: 0 } });
    const k = await keys(ctx);
    const pk = await importPKCS8(k.privatePem, "RS256");
    const ttl = Math.min(24 * 7, Math.max(1, Number.isFinite(hours) ? hours! : 1));
    const expiresAt = Date.now() + ttl * 3_600_000;
    const token = await new SignJWT({ email: GUEST_EMAIL, name: "Guest Tester", email_verified: true })
      .setProtectedHeader({ alg: "RS256", kid: k.kid })
      .setIssuer(process.env.CONVEX_SITE_URL ?? "")
      .setAudience(GUEST_AUDIENCE)
      .setSubject("guest")
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt / 1000))
      .sign(pk);
    return { token, expiresAt };
  },
});

/** Mint a fresh short token from a still-valid one (the browser calls this hourly). */
export const refreshToken = action({
  args: {},
  handler: async (ctx): Promise<{ token: string; expiresAt: number } | null> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || identity.subject !== "guest" || identity.issuer !== process.env.CONVEX_SITE_URL || !process.env.GUEST_PASSWORD) return null;
    const k = await keys(ctx);
    const pk = await importPKCS8(k.privatePem, "RS256");
    const expiresAt = Date.now() + 3_600_000;
    const token = await new SignJWT({ email: GUEST_EMAIL, name: "Guest Tester", email_verified: true }).setProtectedHeader({ alg: "RS256", kid: k.kid }).setIssuer(process.env.CONVEX_SITE_URL ?? "").setAudience(GUEST_AUDIENCE).setSubject("guest").setIssuedAt().setExpirationTime(Math.floor(expiresAt / 1000)).sign(pk);
    return { token, expiresAt };
  },
});
