/** Guest test sessions: a Convex-minted JWT kept in an httpOnly cookie, handed to the Convex client via /api/guest/token. */
export const GUEST_COOKIE = "hd_guest";

/** Decode a JWT's payload without verifying it (the proxy only gates pages; Convex verifies the signature). */
export function decodeJwt(token: string): { sub?: string; exp?: number; email?: string } | null {
  try { const part = token.split(".")[1]; return JSON.parse(atob(part.replace(/-/g, "+").replace(/_/g, "/"))) as { sub?: string; exp?: number; email?: string }; } catch { return null; }
}
export const guestTokenLive = (token: string | undefined) => { if (!token) return false; const p = decodeJwt(token); return !!p && p.sub === "guest" && (p.exp ?? 0) * 1000 > Date.now() + 60_000; };
