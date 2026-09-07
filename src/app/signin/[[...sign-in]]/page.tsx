import { SignIn } from "@clerk/nextjs";

export const metadata = { title: "Sign in" };

export default function SignInPage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 bg-background px-6 py-12">
      <div className="text-center">
        <p className="font-display text-3xl">Happy Days</p>
        <p className="mt-2 text-sm text-fg-tertiary">Barbara Fraser &amp; Associates. Staff only.</p>
      </div>
      <SignIn />
    </main>
  );
}
