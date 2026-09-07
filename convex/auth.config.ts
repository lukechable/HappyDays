/**
 * Clerk → Convex. In the Clerk dashboard create a JWT template named "convex" and copy its Issuer
 * (e.g. https://your-app.clerk.accounts.dev) into the Convex env var CLERK_JWT_ISSUER_DOMAIN.
 */
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};
