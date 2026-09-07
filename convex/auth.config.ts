/**
 * Clerk → Convex. In the Clerk dashboard create a JWT template named "convex" and copy its Issuer
 * (e.g. https://your-app.clerk.accounts.dev) into the Convex env var CLERK_JWT_ISSUER_DOMAIN.
 * The deployment ships with a "not-yet-configured" value so functions can deploy before Clerk exists;
 * the Settings checklist treats that value as missing.
 */
const siteUrl = process.env.CONVEX_SITE_URL ?? "";

const authConfig = {
  providers: [
    { domain: process.env.CLERK_JWT_ISSUER_DOMAIN, applicationID: "convex" },
    // Guest testing identities minted by convex/guest.ts; only honoured while GUEST_PASSWORD is set.
    { type: "customJwt", applicationID: "happydays-guest", issuer: siteUrl, jwks: `${siteUrl}/guest/jwks.json`, algorithm: "RS256" },
  ],
};

export default authConfig;
