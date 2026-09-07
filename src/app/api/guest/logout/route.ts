import { NextResponse } from "next/server";
import { GUEST_COOKIE } from "@/lib/guest";
import { publicUrl } from "@/lib/public-url";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const res = NextResponse.redirect(publicUrl(req, "/signin"), 303);
  res.cookies.set(GUEST_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
