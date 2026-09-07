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
      {clerk ? <SignIn /> : <p className="max-w-sm text-center text-sm text-fg-secondary">Staff sign-in with Google isn’t configured on this deployment yet.</p>}
      <GuestLogin />
    </main>
  );
}
