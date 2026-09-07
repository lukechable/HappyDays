/**
 * Behind Railway the request URL is the container's own address (https://localhost:8080/…), so redirects must be
 * built from the configured public site URL, falling back to the forwarded host.
 */
export function publicUrl(req: Request, path: string): URL {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) { try { return new URL(path, configured); } catch { /* fall through */ } }
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return new URL(path, host ? `${proto}://${host}` : req.url);
}

/** Absolute site origin for links shown to clients (download codes, signing links). Never localhost on a deployed build. */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (typeof window !== "undefined") { if (!configured || /localhost|127\.0\.0\.1/.test(configured)) return window.location.origin; return configured.replace(/\/$/, ""); }
  return (configured ?? "").replace(/\/$/, "");
}
