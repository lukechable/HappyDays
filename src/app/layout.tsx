import type { Metadata, Viewport } from "next";
import { Libre_Baskerville } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import Link from "next/link";
import { cookies } from "next/headers";
import { ConvexClientProvider, GuestConvexProvider } from "@/components/ConvexClientProvider";
import { AuthModeProvider } from "@/components/auth/auth-mode";
import { GUEST_COOKIE, guestTokenLive } from "@/lib/guest";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

// Statement face for headings; body copy uses the system sans stack declared in globals.css.
const serif = Libre_Baskerville({ variable: "--font-libre-baskerville", subsets: ["latin"], weight: ["400", "700"], style: ["normal", "italic"], display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: { default: "Happy Days", template: "%s · Happy Days" },
  description: "Mail, bookings, tasks, files and money for Barbara Fraser & Associates.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: "#1a1a19", width: "device-width", initialScale: 1 };

const clerkConfigured = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const html = (body: React.ReactNode) => (
    <html lang="en-AU" className={`${serif.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">{body}</body>
    </html>
  );
  const guest = guestTokenLive((await cookies()).get(GUEST_COOKIE)?.value);
  if (guest) {
    return html(
      <AuthModeProvider mode="guest">
        <GuestConvexProvider>
          <TooltipProvider>
            {children}
            <Toaster position="bottom-center" />
          </TooltipProvider>
        </GuestConvexProvider>
      </AuthModeProvider>,
    );
  }
  if (!clerkConfigured) return html(<SetupNeeded />);
  return (
    <ClerkProvider signInUrl="/signin" afterSignOutUrl="/signin" appearance={{ variables: { colorPrimary: "#1a1a19", borderRadius: "0.5rem" } }}>
      {html(
        <AuthModeProvider mode="clerk">
          <ConvexClientProvider>
            <TooltipProvider>
              {children}
              <Toaster position="bottom-center" />
            </TooltipProvider>
          </ConvexClientProvider>
        </AuthModeProvider>,
      )}
    </ClerkProvider>
  );
}

/** Shown on a deployment that has no Clerk keys yet, instead of a 500. Offers the guest login when it is on. */
function SetupNeeded() {
  const convex = process.env.NEXT_PUBLIC_CONVEX_URL ?? "(not set)";
  return (
    <main className="mx-auto flex min-h-svh max-w-lg flex-col justify-center gap-5 px-6 py-12">
      <p className="font-display text-3xl">Happy Days</p>
      <p className="text-sm text-fg-secondary">This deployment is running but sign-in isn’t configured yet. Add the Clerk keys and redeploy, or <Link href="/signin" className="underline">sign in as a guest tester</Link>.</p>
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        <li>Create a Clerk application (Google sign-in only, restricted to barbarafraser.net).</li>
        <li>Set <code className="rounded bg-muted px-1">NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code> and <code className="rounded bg-muted px-1">CLERK_SECRET_KEY</code> on this service.</li>
        <li>In Clerk, add a JWT template named <code className="rounded bg-muted px-1">convex</code> and set its issuer as <code className="rounded bg-muted px-1">CLERK_JWT_ISSUER_DOMAIN</code> on the Convex deployment.</li>
      </ol>
      <p className="text-xs text-fg-tertiary">Convex: {convex}</p>
    </main>
  );
}
