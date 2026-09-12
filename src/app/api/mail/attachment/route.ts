import { contentDisposition } from "@/lib/download-headers";
import { api } from "../../../../../convex/_generated/api";
import { convexForUser } from "@/lib/convex-server";

export const dynamic = "force-dynamic";

/**
 * Streams one Gmail attachment to the browser. Nothing is cached or stored: we fetch it from Gmail with the
 * user's own short-lived access token and pass it straight through with the right content type.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const messageId = url.searchParams.get("message");
  const attachmentId = url.searchParams.get("id");
  const name = (url.searchParams.get("name") ?? "attachment").replace(/[\r\n"\\]/g, "_").slice(0, 200);
  const requested = (url.searchParams.get("mime") ?? "application/octet-stream").toLowerCase();
  const INLINE_OK = ["image/png", "image/jpeg", "image/gif", "image/webp", "application/pdf", "text/plain"];
  const mime = /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(requested) && !/html|xml|svg|javascript/.test(requested) ? requested : "application/octet-stream";
  const disposition = url.searchParams.get("inline") === "1" && INLINE_OK.includes(mime) ? "inline" : "attachment";
  if (!messageId || !attachmentId) return new Response("Missing message or attachment id", { status: 400 });
  const client = await convexForUser();
  if (!client) return new Response("Sign in", { status: 401 });
  const tok = await client.action(api.google.accessToken, {});
  if (!tok) return new Response("Google account not connected", { status: 409 });
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${encodeURIComponent(attachmentId)}`, { headers: { Authorization: `Bearer ${tok.token}` } });
  if (!res.ok) return new Response(`Gmail returned ${res.status}`, { status: res.status });
  const { data } = (await res.json()) as { data: string };
  const bytes = Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  return new Response(bytes, {
    headers: {
      "Content-Type": mime,
      "Content-Length": String(bytes.length),
      "Content-Disposition": contentDisposition(name, disposition),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'",
    },
  });
}
