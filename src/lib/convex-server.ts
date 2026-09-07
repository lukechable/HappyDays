import { auth } from "@clerk/nextjs/server";
import { ConvexHttpClient } from "convex/browser";

/** A Convex client for route handlers, authenticated as the signed-in Clerk user via the "convex" JWT template. */
export async function convexForUser(): Promise<ConvexHttpClient | null> {
  const { getToken, userId } = await auth();
  if (!userId) return null;
  const token = await getToken({ template: "convex" });
  if (!token) return null;
  const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
  client.setAuth(token);
  return client;
}

/** Unauthenticated client for public pages (download codes, booking, signing). */
export const convexPublic = () => new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
