import { NextResponse } from "next/server";
import { GUEST_COOKIE } from "@/lib/guest";

export const dynamic = "force-dynamic";
export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL("/signin", req.url), 303);
  res.cookies.set(GUEST_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
