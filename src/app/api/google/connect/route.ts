import { NextResponse } from "next/server";
import { api } from "../../../../../convex/_generated/api";
import { convexForUser } from "@/lib/convex-server";
import { publicUrl } from "@/lib/public-url";

export const dynamic = "force-dynamic";

/** Starts the Google consent flow for the signed-in user. */
export async function GET(req: Request) {
  const client = await convexForUser();
  if (!client) return NextResponse.redirect(publicUrl(req, "/signin"));
  try {
    const url = await client.action(api.google.authUrl, {});
    return NextResponse.redirect(url);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Could not start Google sign-in";
    return NextResponse.redirect(publicUrl(req, `/settings?google=error&message=${encodeURIComponent(msg)}`));
  }
}
