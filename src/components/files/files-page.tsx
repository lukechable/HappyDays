"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { replaceUrl } from "@/lib/shallow";
import { useMutation, useQuery } from "convex/react";
import { Upload, FileText, Download, KeyRound, Trash2, Eye, PenLine, RefreshCw, Copy, Mail, Ban, CalendarPlus } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { PageHeader, Panel, Pill, statusTone, Empty, Loading, DataTable } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { openCompose, sha256 } from "@/lib/compose-handoff";
import { bytes, day, ago, when } from "@/lib/format";
import { cn, errorMessage } from "@/lib/utils";
import { siteUrl } from "@/lib/public-url";

/** The practice's own documents (reports, signed forms) and the download codes that deliver them. */
export function FilesPage() {
  const params = useSearchParams();
  const tab = params.get("tab") === "codes" ? "codes" : "files";
  const matterFilter = params.get("matter") as Id<"matters"> | null;
  const [q, setQ] = useState("");
  const files = useQuery(api.files.list, { matterId: matterFilter ?? undefined, q: q.trim().length >= 2 ? q : undefined });
  const matters = useQuery(api.matters.list, { includeClosed: true });
  const uploadUrl = useMutation(api.files.uploadUrl);
  const register = useMutation(api.files.register);
  const update = useMutation(api.files.update);
  const remove = useMutation(api.files.remove);
  const [uploading, setUploading] = useState(0);
  const [codeFor, setCodeFor] = useState<Id<"files">[] | null>(null);
  const [selected, setSelected] = useState<Set<Id<"files">>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  const upload = async (list: FileList | File[], replaces?: Id<"files">) => {
    const arr = Array.from(list);
    setUploading(arr.length);
    for (const file of arr) {
      try {
        const url = await uploadUrl({});
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        await register({ storageId, name: file.name, mime: file.type || "application/octet-stream", size: file.size, sha256: await sha256(file), matterId: matterFilter ?? undefined, replacesFileId: replaces });
      } catch (e) { toast.error(`${file.name}: ${errorMessage(e)}`); }
      setUploading((n) => n - 1);
    }
    toast.success(arr.length === 1 ? "Uploaded" : `${arr.length} files uploaded`);
  };

  return (
    <div className="space-y-5" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (e.dataTransfer.files.length) void upload(e.dataTransfer.files); }}>
      <PageHeader title="Files & download codes" blurb="Reports and signed forms the practice stores itself. Give a client a code and they collect the file from a plain page, no login, with every download logged." actions={<><Button variant="outline" onClick={() => inputRef.current?.click()}><Upload className="size-3.5" />{uploading ? `Uploading ${uploading}…` : "Upload"}</Button><input ref={inputRef} type="file" multiple hidden onChange={(e) => e.target.files && void upload(e.target.files)} />{selected.size > 0 && <Button onClick={() => setCodeFor(Array.from(selected))}><KeyRound className="size-3.5" />Code for {selected.size} file{selected.size === 1 ? "" : "s"}</Button>}</>} />
      <div className="flex flex-wrap items-center gap-2 border-b border-border">
        {(["files", "codes"] as const).map((t) => <button key={t} type="button" onClick={() => replaceUrl(`/files${t === "codes" ? "?tab=codes" : ""}`)} className={cn("-mb-px border-b-2 px-3 py-2 text-sm capitalize", tab === t ? "border-foreground font-medium" : "border-transparent text-fg-tertiary hover:text-foreground")}>{t === "codes" ? "Download codes" : "Files"}</button>)}
        {tab === "files" && <><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search files" className="ml-auto h-8 w-56" /><select value={matterFilter ?? ""} onChange={(e) => replaceUrl(`/files${e.target.value ? `?matter=${e.target.value}` : ""}`)} className="h-8 rounded-lg border border-input bg-card px-2 text-xs"><option value="">All matters</option>{(matters ?? []).map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}</select></>}
      </div>

      {tab === "files" ? (
        <Panel>
          {files === undefined ? <Loading rows={4} /> : files.length === 0 ? <Empty title="No files yet" body="Drop a PDF anywhere on this page, or click Upload. Files named “…report…” are marked as reports automatically." /> : (
            <DataTable head={<><th className="w-6"></th><th>File</th><th>Matter</th><th>Uploaded</th><th>Codes</th><th></th></>} minWidth={720}>
              {files.map((f) => (
                <tr key={f._id} className="group hover:bg-muted/50">
                  <td><input type="checkbox" className="size-3.5 accent-foreground" checked={selected.has(f._id)} onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(f._id); else n.delete(f._id); return n; })} aria-label="Select" /></td>
                  <td><div className="flex items-center gap-2"><FileText className="size-4 shrink-0 text-fg-tertiary" /><div className="min-w-0"><div className="flex items-center gap-1.5"><span className="truncate font-medium">{f.name}</span>{f.isReport && <Pill tone="info">report</Pill>}{f.version > 1 && <span className="text-[10px] text-fg-quaternary">v{f.version}</span>}</div><div className="text-xs text-fg-tertiary">{bytes(f.size)} · {f.mime.split("/")[1] ?? f.mime}</div></div></div></td>
                  <td><select value={f.matterId ?? ""} onChange={(e) => update({ id: f._id, matterId: (e.target.value || undefined) as Id<"matters"> | undefined })} className="h-7 max-w-[180px] rounded-md border border-transparent bg-transparent text-xs hover:border-input"><option value="">—</option>{(matters ?? []).map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}</select></td>
                  <td className="text-xs text-fg-tertiary">{day(f.createdAt)}<br />{f.uploadedByName}</td>
                  <td className="num text-xs">{f.activeCodes.length ? f.activeCodes.join(", ") : <span className="text-fg-quaternary">—</span>}</td>
                  <td><div className="flex justify-end gap-0.5 opacity-60 group-hover:opacity-100">
                    <FileAction label="Preview / download" href={`/files/${f._id}`} icon={<Eye className="size-3.5" />} />
                    {f.mime === "application/pdf" && <FileAction label="Open in PDF tools" href={`/pdf?file=${f._id}`} icon={<PenLine className="size-3.5" />} />}
                    <FileAction label="Create download code" onClick={() => setCodeFor([f._id])} icon={<KeyRound className="size-3.5" />} />
                    <FileAction label={f.isReport ? "Unmark as report" : "Mark as report"} onClick={() => update({ id: f._id, isReport: !f.isReport })} icon={<span className="text-[10px] font-semibold">R</span>} />
                    <FileAction label="Upload new version" onClick={() => { const i = document.createElement("input"); i.type = "file"; i.onchange = () => i.files && void upload(i.files, f._id); i.click(); }} icon={<RefreshCw className="size-3.5" />} />
                    <FileAction label="Delete" onClick={() => { if (confirm(`Delete “${f.name}”? Active codes for it stop working.`)) void remove({ id: f._id }); }} icon={<Trash2 className="size-3.5" />} />
                  </div></td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>
      ) : <CodesTab onNew={() => setCodeFor([])} />}
      {codeFor && <CodeDialog preselected={codeFor} onClose={() => { setCodeFor(null); setSelected(new Set()); }} />}
    </div>
  );
}

function FileAction({ label, onClick, href, icon }: { label: string; onClick?: () => void; href?: string; icon: React.ReactNode }) {
  const cls = "inline-flex size-7 items-center justify-center rounded-md text-fg-secondary hover:bg-muted hover:text-foreground";
  return href ? <Link href={href} className={cls} title={label} aria-label={label}>{icon}</Link> : <button type="button" onClick={onClick} className={cls} title={label} aria-label={label}>{icon}</button>;
}

/* ------------------------------ codes ------------------------------ */

function CodesTab({ onNew }: { onNew: () => void }) {
  const codes = useQuery(api.files.codes);
  const revoke = useMutation(api.files.revokeCode);
  const extend = useMutation(api.files.extendCode);
  const router = useRouter();
  const site = siteUrl();
  const [open, setOpen] = useState<string | null>(null);
  if (codes === undefined) return <Loading rows={4} />;
  const message = (c: (typeof codes)[number]) => `Hello${c.recipientName ? ` ${c.recipientName.split(" ")[0]}` : ""},\n\nYour document${c.files.length > 1 ? "s are" : " is"} ready to download.\n\nGo to ${site}/d and enter the code ${c.code}${c.hasPin ? ". I will send the PIN separately." : "."}\n\nThe link works until ${day(c.expiresAt)}.\n\nKind regards`;
  return (
    <Panel actions={<Button size="sm" onClick={onNew}>New code</Button>}>
      {codes.length === 0 ? <Empty title="No download codes yet" body="Select a file and create a code. The client enters it at /d, we log every download, and a Report file flips its matter to delivered." /> : (
        <DataTable head={<><th>Code</th><th>Files</th><th>For</th><th>State</th><th>Expires</th><th>Downloads</th><th></th></>} minWidth={760}>
          {codes.map((c) => (
            <>
              <tr key={c._id} className="hover:bg-muted/50">
                <td><span className="num text-base font-semibold tracking-wider">{c.code}</span>{c.hasPin && <Pill className="ml-1">PIN</Pill>}</td>
                <td className="max-w-[240px]">{c.files.map((f) => <div key={f._id} className="truncate text-xs">{f.name}</div>)}</td>
                <td className="text-xs">{c.recipientName ?? c.recipientEmail ?? "—"}{c.matterName && <div className="text-fg-tertiary">{c.matterName}</div>}</td>
                <td><Pill tone={statusTone(c.state)}>{c.state}</Pill></td>
                <td className="text-xs text-fg-tertiary">{day(c.expiresAt)}</td>
                <td className="num text-xs"><button type="button" onClick={() => setOpen(open === c._id ? null : c._id)} className="underline-offset-2 hover:underline">{c.downloadCount}{c.maxDownloads ? ` / ${c.maxDownloads}` : ""}</button></td>
                <td><div className="flex justify-end gap-0.5">
                  <FileAction label="Copy code" onClick={() => { void navigator.clipboard.writeText(c.code); toast.success("Code copied"); }} icon={<Copy className="size-3.5" />} />
                  <FileAction label="Email the code" onClick={() => openCompose(router, { to: c.recipientEmail ? [{ name: c.recipientName ?? c.recipientEmail, email: c.recipientEmail }] : [], subject: `Your document${c.files.length > 1 ? "s" : ""} from Barbara Fraser & Associates`, html: message(c).replace(/\n/g, "<br>") })} icon={<Mail className="size-3.5" />} />
                  {c.state !== "revoked" && <FileAction label="Extend 14 days" onClick={() => extend({ id: c._id, days: 14 })} icon={<CalendarPlus className="size-3.5" />} />}
                  {c.state !== "revoked" && <FileAction label="Revoke" onClick={() => { if (confirm(`Revoke code ${c.code}?`)) void revoke({ id: c._id }); }} icon={<Ban className="size-3.5" />} />}
                </div></td>
              </tr>
              {open === c._id && <tr key={`${c._id}-log`}><td colSpan={7} className="bg-muted/40"><div className="px-2 py-1 text-xs">{c.events.length === 0 ? <span className="text-fg-tertiary">No attempts yet.</span> : <ul className="space-y-0.5">{c.events.map((e) => <li key={e._id} className="flex gap-3"><span className="num text-fg-tertiary">{when(e.at)}</span><Pill tone={e.outcome === "ok" ? "good" : "bad"}>{e.outcome.replace("_", " ")}</Pill><span className="text-fg-tertiary">{e.ip ?? ""} {e.userAgent?.slice(0, 60) ?? ""}</span></li>)}</ul>}<div className="mt-1 text-fg-quaternary">Created {ago(c.createdAt)} by {c.createdByName}{c.note ? ` · note: ${c.note}` : ""}</div></div></td></tr>}
            </>
          ))}
        </DataTable>
      )}
    </Panel>
  );
}

function CodeDialog({ preselected, onClose }: { preselected: Id<"files">[]; onClose: () => void }) {
  const files = useQuery(api.files.list, {});
  const create = useMutation(api.files.createCode);
  const router = useRouter();
  const [fileIds, setFileIds] = useState<Id<"files">[]>(preselected);
  const [form, setForm] = useState({ recipientName: "", recipientEmail: "", note: "", pin: "", expiresInDays: 14, maxDownloads: "" });
  const [result, setResult] = useState<{ code: string } | null>(null);
  const site = siteUrl();
  const submit = async () => {
    try { const r = await create({ fileIds, recipientName: form.recipientName || undefined, recipientEmail: form.recipientEmail || undefined, note: form.note || undefined, pin: form.pin || undefined, expiresInDays: form.expiresInDays, maxDownloads: form.maxDownloads ? Number(form.maxDownloads) : undefined }); setResult({ code: r.code }); }
    catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-card p-5 shadow-float" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Download code">
        {result ? (
          <div className="text-center">
            <p className="text-xs uppercase tracking-[0.14em] text-fg-tertiary">Download code</p>
            <p className="num my-3 text-4xl font-semibold tracking-[0.2em]">{result.code}</p>
            <p className="text-sm text-fg-secondary">Tell the client to go to <b>{site}/d</b> and enter this code{form.pin ? `, then the PIN ${form.pin}. Send the PIN by a different channel.` : "."}</p>
            <div className="mt-4 flex justify-center gap-2">
              <Button variant="outline" onClick={() => { void navigator.clipboard.writeText(result.code); toast.success("Copied"); }}><Copy className="size-3.5" />Copy code</Button>
              <Button onClick={() => openCompose(router, { to: form.recipientEmail ? [{ name: form.recipientName || form.recipientEmail, email: form.recipientEmail }] : [], subject: "Your document from Barbara Fraser & Associates", html: `<p>Hello${form.recipientName ? ` ${form.recipientName.split(" ")[0]}` : ""},</p><p>Your document is ready to download. Go to <a href="${site}/d">${site}/d</a> and enter the code <b>${result.code}</b>.${form.pin ? " I will send the PIN separately." : ""}</p><p>The code works until ${day(Date.now() + form.expiresInDays * 86_400_000)}.</p>` })}><Mail className="size-3.5" />Email it</Button>
              <Button variant="ghost" onClick={onClose}>Done</Button>
            </div>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <h2 className="font-display text-xl">New download code</h2>
            <div><Label>Files</Label><div className="mt-1 max-h-40 space-y-0.5 overflow-y-auto rounded-lg border border-border p-2">{(files ?? []).map((f) => <label key={f._id} className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-3.5 accent-foreground" checked={fileIds.includes(f._id)} onChange={(e) => setFileIds(e.target.checked ? [...fileIds, f._id] : fileIds.filter((x) => x !== f._id))} /><span className="truncate">{f.name}</span>{f.isReport && <Pill tone="info">report</Pill>}</label>)}{files?.length === 0 && <span className="text-xs text-fg-tertiary">Upload a file first.</span>}</div></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor="c-name">Recipient name</Label><Input id="c-name" value={form.recipientName} onChange={(e) => setForm({ ...form, recipientName: e.target.value })} /></div>
              <div><Label htmlFor="c-email">Recipient email</Label><Input id="c-email" type="email" value={form.recipientEmail} onChange={(e) => setForm({ ...form, recipientEmail: e.target.value })} /></div>
              <div><Label htmlFor="c-exp">Expires in (days)</Label><Input id="c-exp" type="number" min={1} max={365} className="num" value={form.expiresInDays} onChange={(e) => setForm({ ...form, expiresInDays: Math.max(1, Number(e.target.value) || 14) })} /></div>
              <div><Label htmlFor="c-max">Max downloads (blank = unlimited)</Label><Input id="c-max" type="number" min={1} className="num" value={form.maxDownloads} onChange={(e) => setForm({ ...form, maxDownloads: e.target.value })} /></div>
              <div><Label htmlFor="c-pin">PIN (optional, 4–8 digits)</Label><Input id="c-pin" inputMode="numeric" pattern="[0-9]{4,8}" className="num" value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, "").slice(0, 8) })} /></div>
              <div><Label htmlFor="c-note">Note shown to the recipient</Label><Input id="c-note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="Your family report, as discussed" /></div>
            </div>
            <div className="flex gap-2"><Button type="submit" disabled={!fileIds.length}>Create code</Button><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button></div>
          </form>
        )}
      </div>
    </div>
  );
}

export function FileDownloadIcon() { return <Download className="size-3.5" />; }
