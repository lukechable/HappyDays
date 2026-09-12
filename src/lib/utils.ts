import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** The message of a thrown value, for toasts: Error → message, string → itself, anything else → the fallback. */
export function errorMessage(e: unknown, fallback = "Something went wrong"): string {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : e && typeof e === "object" && "message" in e && typeof e.message === "string" ? e.message : "";
  if (!raw) return fallback;
  if (/rate-limiting|rateLimitExceeded|quota.*exceeded/i.test(raw)) return "Gmail is temporarily busy. Please wait a moment and try again.";
  return raw.replace(/^\[CONVEX[\s\S]*?Uncaught (?:\w*Error):\s*/, "").split(/\n\s+at | at (?:async |handler |call \()/)[0].replace(/\s*Called by client[\s\S]*$/, "").trim() || fallback;
}
