import { SignIn } from "@clerk/nextjs";
import { GuestLogin } from "@/components/auth/guest-login";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default function SignInPage() {
  const clerk = !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 bg-background px-6 py-12">
      <div className="text-center">
        <p className="font-display text-3xl">Happy Days</p>
        <p className="mt-2 text-sm text-fg-tertiary">Barbara Fraser &amp; Associates. Staff only.</p>
      </div>
      {clerk ? <SignIn /> : (
        <div className="w-full max-w-md rounded-2xl bg-card p-5 text-sm ring-1 ring-black/[0.06] dark:ring-white/10">
          <p className="font-medium">Staff sign-in isn’t configured yet</p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-fg-secondary">
            <li>Create a Clerk application (Google sign-in only, restricted to barbarafraser.net).</li>
            <li>Set <code className="rounded bg-muted px-1">NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY</code> and <code className="rounded bg-muted px-1">CLERK_SECRET_KEY</code> on this service.</li>
            <li>Add a JWT template named <code className="rounded bg-muted px-1">convex</code> and set its issuer as <code className="rounded bg-muted px-1">CLERK_JWT_ISSUER_DOMAIN</code> on Convex.</li>
          </ol>
          <p className="mt-2 text-xs text-fg-tertiary">Convex: {process.env.NEXT_PUBLIC_CONVEX_URL}</p>
        </div>
      )}
      <GuestLogin />
    </main>
  );
}
