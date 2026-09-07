/**
 * Clerk → Convex. In the Clerk dashboard create a JWT template named "convex" and copy its Issuer
 * (e.g. https://your-app.clerk.accounts.dev) into the Convex env var CLERK_JWT_ISSUER_DOMAIN.
 * The deployment ships with a "not-yet-configured" value so functions can deploy before Clerk exists;
 * the Settings checklist treats that value as missing.
 */
const authConfig = {
  providers: [{ domain: process.env.CLERK_JWT_ISSUER_DOMAIN, applicationID: "convex" }],
};

export default authConfig;
