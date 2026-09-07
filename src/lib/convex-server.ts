import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { ConvexHttpClient } from "convex/browser";
import { GUEST_COOKIE, guestTokenLive } from "@/lib/guest";

/**
 * A Convex client for route handlers, authenticated as the signed-in user: a guest session's cookie token, or the
 * Clerk session's "convex" JWT. Clerk's auth() throws when its middleware didn't run (guest mode), so it is guarded.
 */
export async function convexForUser(): Promise<ConvexHttpClient | null> {
  const guest = (await cookies()).get(GUEST_COOKIE)?.value;
  let token: string | null = null;
  if (guestTokenLive(guest)) token = guest ?? null;
  else {
    try { const { userId, getToken } = await auth(); if (userId) token = await getToken({ template: "convex" }); }
    catch { token = null; }
  }
  if (!token) return null;
  const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  client.setAuth(token);
  return client;
}

/** Unauthenticated client for public pages (download codes, booking, signing). */
export const convexPublic = () => new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
