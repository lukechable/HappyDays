"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { ListFilter, Search, FolderInput } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { ListItem } from "../../../convex/mail";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, errorMessage } from "@/lib/utils";
import type { Label as Folder } from "./folder-list";

/**
 * "Filter messages like these…" from the conversation menu, Gmail's shortcut with the practice's folder rules
 * behind it. Match on the sender or their whole domain, optionally on words in the subject; then either show every
 * matching conversation as a Gmail search, or file them into a folder from now on (a manual label rule) and move the
 * right-clicked ones there straight away.
 */
export function FilterDialog({ item, ids, myEmail, folders, onSearch, onMove, onClose }: { item: ListItem; ids: string[]; myEmail?: string; folders: Folder[]; onSearch: (q: string) => void; onMove: (ids: string[], folder: Folder) => Promise<void>; onClose: () => void }) {
  const addRule = useMutation(api.labelRules.add);
  const sender = item.senders.find((s) => s.email.toLowerCase() !== myEmail?.toLowerCase()) ?? item.senders[0];
  const email = (sender?.email ?? "").toLowerCase();
  const domain = email.split("@")[1] ?? "";
  const [kind, setKind] = useState<"sender" | "domain">("sender");
  const [subject, setSubject] = useState("");
  const [folderId, setFolderId] = useState(folders[0]?.id ?? "");
  const [moveNow, setMoveNow] = useState(true);
  const [busy, setBusy] = useState(false);
  const value = kind === "sender" ? email : domain;
  const query = [kind === "sender" ? `from:${email}` : `from:@${domain}`, subject.trim() ? `subject:(${subject.trim()})` : ""].filter(Boolean).join(" ");
  const folder = folders.find((f) => f.id === folderId);

  const save = async () => {
    if (!folder) { toast.error("Pick a folder."); return; }
    setBusy(true);
    try {
      await addRule({ kind, value, labelId: folder.id, labelName: folder.name });
      if (subject.trim()) await addRule({ kind: "subject", value: subject.trim(), labelId: folder.id, labelName: folder.name });
      if (moveNow) await onMove(ids, folder);
      toast.success(`New mail from ${value} now files into ${folder.name}`, { description: "Change or switch it off in Settings → Folder rules." });
      onClose();
    } catch (e) { toast.error(errorMessage(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="hd-pop w-full max-w-md rounded-2xl bg-card p-5 shadow-float" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Filter messages like these">
        <h2 className="flex items-center gap-2 font-display text-xl"><ListFilter className="size-4" />Filter messages like these</h2>
        <p className="mt-1 text-sm text-fg-secondary">Match conversations by who they come from, and optionally by subject.</p>
        <div className="mt-4 space-y-3">
          <div>
            <Label>From</Label>
            <div className="mt-1 flex gap-0.5 rounded-full bg-muted p-0.5 text-xs">
              <button type="button" onClick={() => setKind("sender")} className={cn("h-7 min-w-0 flex-1 truncate rounded-full px-2.5", kind === "sender" ? "bg-card shadow-xs" : "text-fg-tertiary hover:text-foreground")} title={email}>{sender?.name && sender.name !== email ? `${sender.name} · ${email}` : email || "unknown sender"}</button>
              {domain && <button type="button" onClick={() => setKind("domain")} className={cn("h-7 min-w-0 flex-1 truncate rounded-full px-2.5", kind === "domain" ? "bg-card shadow-xs" : "text-fg-tertiary hover:text-foreground")}>anyone @{domain}</button>}
            </div>
          </div>
          <div><Label htmlFor="f-subject">Subject contains (optional)</Label><Input id="f-subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={item.subject.replace(/^(re|fwd?):\s*/i, "").slice(0, 60)} /></div>
          <div className="rounded-xl border border-border p-3">
            <div className="flex items-center gap-2 text-sm"><FolderInput className="size-4 text-fg-tertiary" /><span>File them into</span><select value={folderId} onChange={(e) => setFolderId(e.target.value)} className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-card px-2 text-sm" aria-label="Folder">{folders.length === 0 && <option value="">No folders yet</option>}{folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select></div>
            <label className="mt-2 flex items-center gap-2 text-xs text-fg-secondary"><input type="checkbox" className="size-3.5 accent-foreground" checked={moveNow} onChange={(e) => setMoveNow(e.target.checked)} />Move {ids.length === 1 ? "this conversation" : `these ${ids.length} conversations`} there now</label>
            <p className="mt-1 text-[11px] text-fg-tertiary">Future mail that matches is filed as it arrives. Rules live in Settings → Folder rules.</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={() => void save()} disabled={busy || !folder || !value}><FolderInput className="size-3.5" />{busy ? "Saving…" : "File automatically"}</Button>
          <Button variant="outline" onClick={() => { onSearch(query); onClose(); }} disabled={!value}><Search className="size-3.5" />Show matches</Button>
          <Button variant="ghost" onClick={onClose} className="ml-auto">Cancel</Button>
        </div>
        <p className="mt-2 font-mono text-[11px] text-fg-quaternary">{query}</p>
      </div>
    </div>
  );
}
