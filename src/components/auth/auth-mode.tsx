"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useClerk } from "@clerk/nextjs";
import { mailStore } from "@/lib/mail-store";

export type AuthMode = "clerk" | "guest";
const Ctx = createContext<AuthMode>("clerk");
export const AuthModeProvider = ({ mode, children }: { mode: AuthMode; children: ReactNode }) => <Ctx.Provider value={mode}>{children}</Ctx.Provider>;
export const useAuthMode = () => useContext(Ctx);

/** Sign-out control for whichever mode is active. Clerk hooks are only touched inside a ClerkProvider. */
export function SignOutButton({ className, children }: { className?: string; children: ReactNode }) {
  const mode = useAuthMode();
  if (mode === "guest") return <form method="POST" action="/api/guest/logout" className="contents" onSubmit={() => { void mailStore.clear(); }}><button type="submit" className={className} aria-label="Sign out" title="Sign out">{children}</button></form>;
  return <ClerkSignOut className={className}>{children}</ClerkSignOut>;
}
function ClerkSignOut({ className, children }: { className?: string; children: ReactNode }) {
  const { signOut } = useClerk();
  return <button type="button" onClick={() => { void mailStore.clear().finally(() => signOut({ redirectUrl: "/signin" })); }} className={className} aria-label="Sign out" title="Sign out">{children}</button>;
}
