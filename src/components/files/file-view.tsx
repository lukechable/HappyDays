/* eslint-disable @next/next/no-img-element -- previews of the practice's own uploads */
"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { PageHeader, Facts, Loading, Empty, Pill } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { bytes, day, when } from "@/lib/format";

export function FileView({ id }: { id: Id<"files"> }) {
  const f = useQuery(api.files.get, { id });
  if (f === undefined) return <Loading rows={4} />;
  if (f === null) return <Empty title="File not found" action={<Button render={<Link href="/files" />}>All files</Button>} />;
  return (
    <div className="space-y-4">
      <PageHeader title={f.name} blurb={`${bytes(f.size)} · ${f.mime} · uploaded ${when(f.createdAt)}`} actions={<>{f.url && <Button variant="outline" render={<a href={f.url} download={f.name} />}>Download</Button>}{f.mime === "application/pdf" && <Button render={<Link href={`/pdf?file=${f._id}`} />}>Open in PDF tools</Button>}</>} />
      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="min-h-[70svh] overflow-hidden rounded-2xl bg-card ring-1 ring-black/[0.06] dark:ring-white/10">
          {f.url && (f.mime === "application/pdf" ? <iframe title={f.name} src={f.url} className="h-[75svh] w-full" /> : f.mime.startsWith("image/") ? <img src={f.url} alt={f.name} className="mx-auto max-h-[75svh]" /> : <div className="p-8 text-center text-sm text-fg-tertiary">No preview for this type. Download it instead.</div>)}
        </div>
        <div className="space-y-3">
          <Facts items={[["Version", `v${f.version}`], ["Report", f.isReport ? <Pill tone="info">yes</Pill> : "no"], ["SHA-256", <code key="h" className="break-all text-[10px]">{f.sha256}</code>], ["Matter", f.matterId ? <Link href={`/matters/${f.matterId}`} className="underline">Open matter</Link> : "—"]]} />
          {f.versions.length > 0 && <div><div className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg-tertiary">Earlier versions</div><ul className="mt-1 space-y-0.5 text-xs">{f.versions.map((v) => <li key={v._id}><Link href={`/files/${v._id}`} className="hover:underline">v{v.version} · {day(v.createdAt)} · {bytes(v.size)}</Link></li>)}</ul></div>}
        </div>
      </div>
    </div>
  );
}
