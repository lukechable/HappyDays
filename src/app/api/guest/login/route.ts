import { NextResponse } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../../../../convex/_generated/api";
import { GUEST_COOKIE } from "@/lib/guest";

export const dynamic = "force-dynamic";

/** Guest sign-in: the deployment checks the password and mints a week-long token, stored httpOnly. */
export async function POST(req: Request) {
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!password) return NextResponse.json({ error: "Enter the guest password." }, { status: 400 });
  try {
    const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL!);
    const r = await client.action(api.guest.issueToken, { password, hours: 24 * 7 });
    const res = NextResponse.json({ ok: true });
    res.cookies.set(GUEST_COOKIE, r.token, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: new Date(r.expiresAt) });
    return res;
  } catch (e) {
    const msg = e instanceof Error ? e.message.replace(/^.*Uncaught Error: /, "").split("\n")[0] : "Guest sign-in failed";
    return NextResponse.json({ error: msg }, { status: 401 });
  }
}
