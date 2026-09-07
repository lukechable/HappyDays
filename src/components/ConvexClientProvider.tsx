"use client";

import { ReactNode } from "react";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useAuth } from "@clerk/nextjs";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

/** Pending Clerk sessions (e.g. an org-selection task we don't use) still count as signed in. */
const useAuthForConvex = () => useAuth({ treatPendingAsSignedOut: false });

/** Convex client that forwards Clerk's "convex" JWT template to the backend. */
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return <ConvexProviderWithClerk client={convex} useAuth={useAuthForConvex}>{children}</ConvexProviderWithClerk>;
}
