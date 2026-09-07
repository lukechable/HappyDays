export const dynamic = "force-dynamic";

const siteUrl = () => process.env.NEXT_PUBLIC_CONVEX_URL!.replace(".convex.cloud", ".convex.site");

/**
 * Public download by code. POST { pin?, fileId?, list? } → Convex redeems the code (PIN check, expiry, limit,
 * audit trail) and returns short-lived storage URLs; a single file is streamed straight through.
 */
export async function POST(req: Request, ctx: RouteContext<"/api/d/[code]">) {
  const { code } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { pin?: string; fileId?: string; list?: boolean };
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? undefined;
  const userAgent = req.headers.get("user-agent") ?? undefined;
  const r = await fetch(`${siteUrl()}/download`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code, pin: body.pin, fileId: body.fileId, ip, userAgent }) });
  const data = (await r.json()) as { ok: boolean; reason?: string; files?: Array<{ _id: string; name: string; mime: string; size: number; url: string | null }> };
  if (!data.ok) return Response.json(data, { status: data.reason === "bad_pin" ? 403 : 410 });
  if (body.list || !data.files || data.files.length !== 1 || !data.files[0].url) return Response.json(data);
  const f = data.files[0];
  const upstream = await fetch(f.url!);
  return new Response(upstream.body, { headers: { "Content-Type": f.mime, "Content-Disposition": `attachment; filename="${f.name.replace(/["\r\n]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(f.name)}`, "Cache-Control": "private, no-store" } });
}
