import type { Metadata, Viewport } from "next";
import { Libre_Baskerville } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  const html = (body: React.ReactNode) => (
    <html lang="en-AU" className={`${serif.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-background text-foreground">{body}</body>
    </html>
  );
  if (!clerkConfigured) return html(<SetupNeeded />);
  return (
    <ClerkProvider signInUrl="/signin" afterSignOutUrl="/signin" appearance={{ variables: { colorPrimary: "#1a1a19", borderRadius: "0.5rem" } }}>
      {html(
        <ConvexClientProvider>
          <TooltipProvider>
            {children}
            <Toaster position="bottom-center" />
          </TooltipProvider>
        </ConvexClientProvider>,
      )}
    </ClerkProvider>
  );
}

/** Shown on a deployment that has no Clerk keys yet, instead of a 500. */
function SetupNeeded() {
  const convex = process.env.NEXT_PUBLIC_CONVEX_URL ?? "(not set)";
  return (
    <main className="mx-auto flex min-h-svh max-w-lg flex-col justify-center gap-5 px-6 py-12">
      <p className="font-display text-3xl">Happy Days</p>
      <p className="text-sm text-fg-secondary">This deployment is running but sign-in isn’t configured yet. Add the Clerk keys and redeploy.</p>
      <ol className="list-decimal space-y-2 pl-5 text-sm">
        <li>Create a Clerk application (Google sign-in only, restricted to barbarafraser.net).</li>
        <li>Set <code className="rounded bg-muted px-1">NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code> and <code className="rounded bg-muted px-1">CLERK_SECRET_KEY</code> on this service.</li>
        <li>In Clerk, add a JWT template named <code className="rounded bg-muted px-1">convex</code> and set its issuer as <code className="rounded bg-muted px-1">CLERK_JWT_ISSUER_DOMAIN</code> on the Convex deployment.</li>
      </ol>
      <p className="text-xs text-fg-tertiary">Convex: {convex}</p>
    </main>
  );
}
