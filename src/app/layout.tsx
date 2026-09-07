import type { Metadata, Viewport } from "next";
import { Libre_Baskerville } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";
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
  // Guest session, or no Clerk yet: run without Clerk. Public pages and the guest sign-in still need Convex.
  if (guest || !clerkConfigured) {
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
