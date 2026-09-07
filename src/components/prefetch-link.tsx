"use client";

import Link from "next/link";
import { useState, type ComponentProps } from "react";

/**
 * A Link that fetches its whole page (payload and code) the moment the pointer or focus reaches it. Rows leading to
 * matter, patient and file pages use it: the list may hold dozens of rows, so prefetching them all on sight would be
 * wasteful, but by the time a row is clicked its page is already here.
 */
export function PrefetchLink({ onPointerEnter, onFocus, onTouchStart, ...props }: ComponentProps<typeof Link>) {
  const [warm, setWarm] = useState(false);
  return <Link {...props} prefetch={warm ? true : null} onPointerEnter={(e) => { setWarm(true); onPointerEnter?.(e); }} onFocus={(e) => { setWarm(true); onFocus?.(e); }} onTouchStart={(e) => { setWarm(true); onTouchStart?.(e); }} />;
}
