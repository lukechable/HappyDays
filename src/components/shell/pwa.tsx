"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { usePwa } from "@/lib/pwa";

/**
 * Mounted once inside the staff shell. Registers the service worker (via usePwa) and turns new
 * activity into a toast while the app is open; when it is in the background, the push notification
 * from the server covers it instead, so nothing shows twice.
 */
export function PwaProvider() {
  usePwa();
  const rows = useQuery(api.notifications.list);
  const router = useRouter();
  const seen = useRef<{ newest: number; primed: boolean }>({ newest: 0, primed: false });
  useEffect(() => {
    if (!rows) return;
    const s = seen.current;
    const newest = rows.reduce((n, r) => Math.max(n, r.createdAt), 0);
    if (!s.primed) { s.primed = true; s.newest = newest; return; }
    const fresh = rows.filter((r) => r.createdAt > s.newest && !r.readAt);
    s.newest = Math.max(s.newest, newest);
    if (document.visibilityState !== "visible") return;
    for (const n of fresh.slice(0, 3)) toast(n.title, { description: n.body, action: n.href ? { label: "Open", onClick: () => router.push(n.href!) } : undefined, duration: 8000 });
  }, [rows, router]);
  return null;
}
