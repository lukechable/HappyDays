import { NextResponse } from "next/server";
import { api } from "../../../../../convex/_generated/api";
import { convexForUser } from "@/lib/convex-server";
import { publicUrl } from "@/lib/public-url";

export const dynamic = "force-dynamic";

/** Google sends the user back here with a code; Convex exchanges it and stores the encrypted refresh token. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const back = (q: string) => NextResponse.redirect(publicUrl(req, `/settings?${q}`));
  if (error) return back(`google=error&message=${encodeURIComponent(error)}`);
  if (!code || !state) return back("google=error&message=Missing+code");
  const client = await convexForUser();
  if (!client) return NextResponse.redirect(publicUrl(req, "/signin"));
  try {
    const r = await client.action(api.google.exchange, { code, state });
    return back(`google=connected&email=${encodeURIComponent(r.email)}`);
  } catch (e) {
    return back(`google=error&message=${encodeURIComponent(e instanceof Error ? e.message : "Google connection failed")}`);
  }
}
