import { NextResponse } from "next/server";
import { api } from "../../../../../convex/_generated/api";
import { convexForUser } from "@/lib/convex-server";

export const dynamic = "force-dynamic";

/** Starts the Google consent flow for the signed-in user. */
export async function GET(req: Request) {
  const client = await convexForUser();
  if (!client) return NextResponse.redirect(new URL("/signin", req.url));
  try {
    const url = await client.action(api.google.authUrl, {});
    return NextResponse.redirect(url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not start Google sign-in";
    return NextResponse.redirect(new URL(`/settings?google=error&message=${encodeURIComponent(msg)}`, req.url));
  }
}
