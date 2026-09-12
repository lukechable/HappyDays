import { createRemoteJWKSet, jwtVerify } from "jose";

const issuer = process.env.NEXT_PUBLIC_CONVEX_URL?.replace(/\.convex\.cloud\/?$/, ".convex.site");
const jwks = issuer ? createRemoteJWKSet(new URL(`${issuer}/guest/jwks.json`)) : null;

/** Page gating verifies the same issuer, audience and signature as the backend. */
export async function verifyGuestToken(token: string | undefined): Promise<boolean> {
  if (!token || !jwks || !issuer) return false;
  try {
    const { payload } = await jwtVerify(token, jwks, { issuer, audience: "happydays-guest", algorithms: ["RS256"] });
    return payload.sub === "guest";
  } catch { return false; }
}
