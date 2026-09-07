import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";
import { GUEST_COOKIE, guestTokenLive } from "@/lib/guest";

/**
 * Everything is staff-only except the public surfaces: online booking, download codes, signing links,
 * the health check and the Stripe/Google callbacks that carry their own verification.
 * Until Clerk keys are configured the proxy passes everything through so the deployment can show its setup page.
 */
const isPublic = createRouteMatcher(["/signin(.*)", "/book(.*)", "/d(.*)", "/sign(.*)", "/api/health", "/api/d(.*)", "/api/sign(.*)", "/api/guest(.*)"]);
const clerkConfigured = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && !!process.env.CLERK_SECRET_KEY;

const withClerk = clerkMiddleware(async (auth, request) => {
  if (isPublic(request)) return;
  const { userId, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn({ returnBackUrl: publicUrl(request.url, request.headers) });
});

export default function proxy(request: NextRequest, event: Parameters<typeof withClerk>[1]) {
  if (guestTokenLive(request.cookies.get(GUEST_COOKIE)?.value)) return NextResponse.next();
  if (clerkConfigured) return withClerk(request, event);
  if (isPublic(request) || request.nextUrl.pathname === "/") return NextResponse.next();
  return NextResponse.redirect(new URL(`/signin?redirect_url=${encodeURIComponent(request.nextUrl.pathname)}`, publicUrl(request.url, request.headers)));
}

/** Behind Railway the request URL is the container's; build the browser-facing one for redirects. */
function publicUrl(url: string, headers: Headers): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  const u = new URL(url);
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  const proto = headers.get("x-forwarded-proto") ?? (configured?.startsWith("https") ? "https" : u.protocol.replace(":", ""));
  return host ? `${proto}://${host}${u.pathname}${u.search}` : url;
}

export const config = {
  matcher: ["/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest|pdf)).*)", "/(api|trpc)(.*)"],
};
