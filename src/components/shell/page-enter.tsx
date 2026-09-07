"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Each route's content settles in with a 4px rise, keyed by path so navigating replays it and staying doesn't. */
export function PageEnter({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <div key={pathname} className="hd-enter">{children}</div>;
}
