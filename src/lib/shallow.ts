"use client";

/**
 * Change the query string without a server round trip. `router.replace` re-fetches the page segment from the server
 * for every distinct URL (about a second from Australia to the US East box), so screens that keep their state in the
 * URL (Mail folders and threads, Tasks, Bookings, Settings tabs) use the browser's own history API instead. Next.js
 * patches pushState/replaceState so `useSearchParams` and `usePathname` update synchronously.
 */
export function replaceSearch(pathname: string, next: Record<string, string | undefined>) {
  const p = new URLSearchParams(window.location.search);
  for (const [k, v] of Object.entries(next)) { if (v === undefined || v === "") p.delete(k); else p.set(k, v); }
  window.history.replaceState(null, "", `${pathname}${p.size ? `?${p}` : ""}`);
}

/** Replace the whole URL (path and query) in place, still without leaving the page. */
export function replaceUrl(url: string) { window.history.replaceState(null, "", url); }
