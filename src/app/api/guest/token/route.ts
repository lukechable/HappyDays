import { cookies } from "next/headers";
import { GUEST_COOKIE, guestTokenLive } from "@/lib/guest";

export const dynamic = "force-dynamic";

/** The browser's Convex client fetches the guest token from the httpOnly cookie here. */
export async function GET() {
  const token = (await cookies()).get(GUEST_COOKIE)?.value;
  if (!guestTokenLive(token)) return Response.json({ token: null }, { status: 401 });
  return Response.json({ token }, { headers: { "Cache-Control": "private, no-store" } });
}
