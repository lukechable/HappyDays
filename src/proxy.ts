import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

/**
 * Everything is staff-only except the public surfaces: online booking, download codes, signing links,
 * the health check and the Stripe/Google callbacks that carry their own verification.
 */
const isPublic = createRouteMatcher(["/signin(.*)", "/book(.*)", "/d(.*)", "/sign(.*)", "/api/health", "/api/d(.*)", "/api/sign(.*)"]);

export default clerkMiddleware(async (auth, request) => {
  if (isPublic(request)) return;
  const { userId, redirectToSignIn } = await auth();
  if (!userId) return redirectToSignIn({ returnBackUrl: publicUrl(request.url, request.headers) });
});

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
