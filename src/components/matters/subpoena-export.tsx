"use client";

import { useMemo, useState } from "react";
import { useAction, useQuery } from "convex/react";
import { X, FileDown, Archive } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { PreviewMessage } from "../../../convex/subpoena";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, errorMessage } from "@/lib/utils";
import { when, bytes, TONE_CLASS } from "@/lib/format";

/**
 * Subpoena export in three steps: filter, review with a checkbox against every message (and every attachment),
 * then export. Untick to exclude; the cover page records how many were reviewed and left out.
 */
export function SubpoenaExport({ matterId, matterName, onClose }: { matterId?: Id<"matters">; matterName?: string; onClose: () => void }) {
  const preview = useAction(api.subpoena.preview);
  const run = useAction(api.subpoena.run);
  const tags = useQuery(api.tags.list);
  const [q, setQ] = useState("");
  const [participants, setParticipants] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [tagIds, setTagIds] = useState<Id<"tags">[]>([]);
  const [title, setTitle] = useState(matterName ?? "");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<PreviewMessage[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [excludedAtt, setExcludedAtt] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"preview" | "export" | null>(null);
  const [result, setResult] = useState<{ pdfUrl: string | null; zipUrl: string | null; pages: number; messages: number } | null>(null);

  const doPreview = async () => {
    setBusy("preview"); setResult(null);
    try { const r = await preview({ matterId, q: q || undefined, participants: participants.split(/[,\s;]+/).map((p) => p.trim()).filter(Boolean), from: from || undefined, to: to || undefined, tagIds: tagIds.length ? tagIds : undefined }); setRows(r.messages); setTruncated(r.truncated); setExcluded(new Set()); setExcludedAtt(new Set()); }
    catch (e) { toast.error(errorMessage(e)); }
    finally { setBusy(null); }
  };
  const included = useMemo(() => (rows ?? []).filter((r) => !excluded.has(r.gmailMessageId)), [rows, excluded]);
  const doExport = async () => {
    if (!included.length) { toast.error("Nothing selected."); return; }
    setBusy("export");
    try { const r = await run({ matterId, title, note: note || undefined, messages: included.map((m) => ({ gmailMessageId: m.gmailMessageId, attachmentIds: m.attachments.filter((a) => !excludedAtt.has(`${m.gmailMessageId}:${a.attachmentId}`)).map((a) => a.attachmentId) })), excludedCount: excluded.size }); setResult(r); toast.success(`Exported ${r.messages} messages over ${r.pages} pages`); }
    catch (e) { toast.error(errorMessage(e)); }
    finally { setBusy(null); }
  };
  const toggleAll = (on: boolean) => setExcluded(on ? new Set() : new Set((rows ?? []).map((r) => r.gmailMessageId)));

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/50 p-4 sm:p-8" onClick={onClose}>
      <div className="flex w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-background shadow-float" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Subpoena export">
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          <div><h2 className="font-display text-xl">Subpoena export</h2><p className="text-xs text-fg-tertiary">{matterName ? `Matter: ${matterName}. ` : ""}Find the conversations, untick what shouldn’t go, export one PDF plus an archive of originals.</p></div>
          <button type="button" onClick={onClose} className="ml-auto rounded p-1.5 hover:bg-muted" aria-label="Close"><X className="size-4" /></button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)]">
          <aside className="space-y-3 overflow-y-auto border-r border-border p-4 text-sm">
            <div><Label htmlFor="se-title">Export title</Label><Input id="se-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Smith & Jones — email production" /></div>
            <div><Label htmlFor="se-q">Keywords (Gmail syntax)</Label><Input id="se-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder='"family report" OR subpoena' /></div>
            <div><Label htmlFor="se-p">People (emails)</Label><Input id="se-p" value={participants} onChange={(e) => setParticipants(e.target.value)} placeholder="solicitor@firm.com.au, jane@…" /></div>
            <div className="grid grid-cols-2 gap-2"><div><Label htmlFor="se-from">From date</Label><Input id="se-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div><div><Label htmlFor="se-to">To date</Label><Input id="se-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div></div>
            {tags && tags.length > 0 && <div><Label>Tagged</Label><div className="mt-1 flex flex-wrap gap-1">{tags.map((t) => { const on = tagIds.includes(t._id); return <button key={t._id} type="button" onClick={() => setTagIds(on ? tagIds.filter((x) => x !== t._id) : [...tagIds, t._id])} className={cn("rounded-full px-2 py-0.5 text-[11px]", on ? TONE_CLASS[t.color] : "bg-muted text-fg-tertiary")}>{t.name}</button>; })}</div></div>}
            <div><Label htmlFor="se-note">Note for the cover page</Label><Input id="se-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Produced in response to subpoena dated …" /></div>
            <Button className="w-full" onClick={doPreview} disabled={busy !== null}>{busy === "preview" ? "Searching Gmail…" : rows ? "Search again" : "Find messages"}</Button>
            {matterId && <p className="text-xs text-fg-tertiary">Emails already linked to this matter are always included in the search; filters add more.</p>}
          </aside>
          <section className="flex min-h-0 flex-col">
            {rows === null ? <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-fg-tertiary">Set your filters and click “Find messages”. Everything is read live from Gmail; nothing is stored until you export.</div> : (
              <>
                <div className="flex items-center gap-3 border-b border-border px-4 py-2 text-xs">
                  <label className="flex items-center gap-1.5"><input type="checkbox" className="size-3.5 accent-foreground" checked={excluded.size === 0 && rows.length > 0} onChange={(e) => toggleAll(e.target.checked)} />all</label>
                  <span className="num">{included.length} of {rows.length} included</span>
                  {truncated && <span className="text-warning">Search hit the 500-thread limit. Narrow the dates.</span>}
                  <span className="ml-auto text-fg-tertiary">Untick a message to leave it out; untick an attachment to keep the email but not the file.</span>
                </div>
                <ul className="min-h-0 flex-1 overflow-y-auto">
                  {rows.map((m) => { const off = excluded.has(m.gmailMessageId); return (
                    <li key={m.gmailMessageId} className={cn("border-b border-border/70 px-4 py-2 text-sm", off && "opacity-50")}>
                      <div className="flex items-start gap-2">
                        <input type="checkbox" className="mt-1 size-3.5 accent-foreground" checked={!off} onChange={() => setExcluded((s) => { const n = new Set(s); if (n.has(m.gmailMessageId)) n.delete(m.gmailMessageId); else n.add(m.gmailMessageId); return n; })} aria-label="Include message" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline gap-2"><span className={cn("truncate font-medium", m.direction === "out" && "text-fg-secondary")}>{m.from}</span><span className="num ml-auto shrink-0 text-xs text-fg-tertiary">{when(m.date)}</span></div>
                          <div className="truncate">{m.subject}</div>
                          <div className="truncate text-xs text-fg-tertiary">to {m.to}{m.cc ? `; cc ${m.cc}` : ""} — {m.snippet}</div>
                          {m.attachments.length > 0 && <div className="mt-1 flex flex-wrap gap-1.5">{m.attachments.map((a) => { const key = `${m.gmailMessageId}:${a.attachmentId}`; const aOff = excludedAtt.has(key); return <label key={a.attachmentId} className={cn("inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px]", aOff && "line-through opacity-60")}><input type="checkbox" className="size-3 accent-foreground" checked={!aOff} onChange={() => setExcludedAtt((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; })} />{a.filename} <span className="text-fg-quaternary">{bytes(a.size)}</span></label>; })}</div>}
                        </div>
                      </div>
                    </li>); })}
                  {rows.length === 0 && <li className="p-8 text-center text-sm text-fg-tertiary">No messages matched.</li>}
                </ul>
              </>
            )}
            <div className="flex items-center gap-3 border-t border-border px-4 py-3">
              {result ? (
                <>
                  <span className="text-sm">Done: {result.messages} messages, {result.pages} pages. Saved to Files{matterName ? ` under ${matterName}` : ""}.</span>
                  {result.pdfUrl && <Button size="sm" render={<a href={result.pdfUrl} target="_blank" rel="noreferrer" />}><FileDown className="size-3.5" />PDF</Button>}
                  {result.zipUrl && <Button size="sm" variant="outline" render={<a href={result.zipUrl} target="_blank" rel="noreferrer" />}><Archive className="size-3.5" />Archive (originals + index)</Button>}
                </>
              ) : (
                <>
                  <span className="text-xs text-fg-tertiary">The export is recorded in the audit log with who ran it and how many messages were excluded.</span>
                  <Button className="ml-auto" onClick={doExport} disabled={busy !== null || !rows || !included.length}>{busy === "export" ? "Building PDF…" : `Export ${included.length} message${included.length === 1 ? "" : "s"}`}</Button>
                </>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
