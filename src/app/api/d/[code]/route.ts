import { contentDisposition } from "@/lib/download-headers";
export const dynamic = "force-dynamic";

const siteUrl = () => process.env.NEXT_PUBLIC_CONVEX_URL!.replace(".convex.cloud", ".convex.site");

/**
 * Public download by code. POST { pin?, fileId?, list? } → Convex redeems the code (PIN check, expiry, limit,
 * audit trail) and returns storage URLs; a single file is streamed straight through.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/d/[code]">) {
  const { code } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { pin?: string; fileId?: string; list?: boolean };
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
  const userAgent = req.headers.get("user-agent") ?? undefined;
  const r = await fetch(`${siteUrl()}/download`, { method: "POST", headers: { "Content-Type": "application/json", ...(process.env.DOWNLOAD_PROXY_SECRET ? { "x-proxy-secret": process.env.DOWNLOAD_PROXY_SECRET } : {}) }, body: JSON.stringify({ code, pin: body.pin, fileId: body.fileId, ip, userAgent }) });
  if (!r.ok) return Response.json({ ok: false, reason: "Download service unavailable" }, { status: 502, headers: { "Cache-Control": "private, no-store" } });
  const data = (await r.json()) as { ok: boolean; reason?: string; files?: Array<{ _id: string; name: string; mime: string; size: number; url: string | null }> };
  if (!data.ok) return Response.json(data, { status: data.reason === "bad_pin" ? 403 : 410, headers: { "Cache-Control": "private, no-store" } });
  if (body.list || !data.files || data.files.length !== 1 || !data.files[0].url) return Response.json(data, { headers: { "Cache-Control": "private, no-store" } });
  const f = data.files[0];
  const upstream = await fetch(f.url!);
  if (!upstream.ok) return new Response("File unavailable", { status: 502, headers: { "Cache-Control": "private, no-store" } });
  return new Response(upstream.body, { headers: { "Content-Type": f.mime, "Content-Disposition": contentDisposition(f.name), "Cache-Control": "private, no-store" } });
}
