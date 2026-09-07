"use client";

import { SignIn } from "@clerk/nextjs";
import { useAuthMode } from "@/components/auth/auth-mode";
import { Button } from "@/components/ui/button";

/** Clerk's sign-in widget, but only when Clerk is the active provider; a guest session shows a way out instead. */
export function StaffSignIn() {
  const mode = useAuthMode();
  if (mode === "clerk") return <SignIn />;
  return (
    <form method="POST" action="/api/guest/logout" className="w-full max-w-md rounded-2xl bg-card p-5 text-sm ring-1 ring-black/[0.06] dark:ring-white/10">
      <p className="font-medium">You’re in a guest session</p>
      <p className="mt-1 text-fg-secondary">Sign out of the guest session to sign in with your Google account.</p>
      <Button type="submit" variant="outline" className="mt-3">Sign out of guest</Button>
    </form>
  );
}
