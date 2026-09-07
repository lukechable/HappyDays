"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { toast } from "sonner";
import { Trash2, FolderCheck } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { RuleRow } from "../../../convex/labelRules";
import type { Label } from "@/components/mail/folder-list";
import { Panel, Pill, Empty, Loading } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useLive } from "@/lib/hooks";
import { ago } from "@/lib/format";
import { errorMessage } from "@/lib/utils";

const KIND_LABEL: Record<RuleRow["kind"], string> = { sender: "From", domain: "Anyone at", matter: "Matter", subject: "Subject contains" };

/** Settings → Folder rules. Learned rules appear here as you file mail; manual ones can be added for a sender, a domain or a subject phrase. */
export function FolderRulesTab() {
  const rules = useQuery(api.labelRules.list);
  const labelsLive = useLive(api.mail.labels, {}, { ttlMs: 300_000 });
  const labels = (labelsLive.data as Label[] | undefined)?.filter((l) => l.type === "user" && !l.hidden).sort((a, b) => a.name.localeCompare(b.name)) ?? [];
  const add = useMutation(api.labelRules.add);
  const setEnabled = useMutation(api.labelRules.setEnabled);
  const remove = useMutation(api.labelRules.remove);
  const [kind, setKind] = useState<"sender" | "domain" | "subject">("sender");
  const [value, setValue] = useState("");
  const [labelId, setLabelId] = useState("");
  const [busy, setBusy] = useState(false);
  const active = rules?.filter((r) => r.status === "active").length ?? 0;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Panel title="Folder rules" blurb="Every time you file a conversation into a folder, Happy Days remembers the sender, their organisation and the matter. Once the same sender has gone to the same folder twice, new mail from them is filed there on arrival and marked with a green folder tick. Take a label off again and the rule unlearns. Rules only ever add labels in Gmail; nothing is moved or deleted.">
        {rules === undefined ? <Loading /> : rules.length === 0 ? <Empty title="Nothing learned yet" body="Drag a conversation into a folder in Mail, or add a rule on the right." /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr className="text-left text-[11px] uppercase tracking-wide text-fg-tertiary"><th className="px-2 py-1.5 font-medium">Match</th><th className="px-2 py-1.5 font-medium">Folder</th><th className="px-2 py-1.5 font-medium">Status</th><th className="px-2 py-1.5 font-medium">Last filed</th><th className="px-2 py-1.5" /></tr></thead>
              <tbody className="[&>tr]:transition-colors [&>tr>td]:border-b [&>tr>td]:border-border/60 [&>tr>td]:px-2 [&>tr>td]:py-1.5 [&>tr>td]:align-middle [&>tr:last-child>td]:border-0">
                {rules.map((r) => (
                  <tr key={r._id} className="hover:bg-muted/40">
                    <td><span className="text-fg-tertiary">{KIND_LABEL[r.kind]}</span> <span className="font-medium">{r.kind === "matter" ? r.matterName ?? "(deleted matter)" : r.value}</span></td>
                    <td><span className="inline-flex items-center gap-1"><FolderCheck className="size-3.5 text-fg-tertiary" />{r.labelName}</span></td>
                    <td>
                      {r.status === "active" && <Pill tone="good">{r.source === "manual" ? "Active · manual" : `Active · filed ${r.count}×`}</Pill>}
                      {r.status === "learning" && <Pill tone="warn" title="Fires once the same sender has been filed here twice and this folder wins most of the time">{`Learning · ${r.count} of 2`}</Pill>}
                      {r.status === "off" && <Pill tone="neutral">Off</Pill>}
                    </td>
                    <td className="num text-fg-tertiary">{ago(r.lastAt)}</td>
                    <td className="text-right whitespace-nowrap">
                      <span className="inline-flex items-center gap-2">
                        <Switch checked={r.enabled} onCheckedChange={(on) => setEnabled({ id: r._id, enabled: on }).catch((e: unknown) => toast.error(errorMessage(e)))} aria-label="Rule on" />
                        <button type="button" onClick={() => remove({ id: r._id }).then(() => toast.success("Rule removed")).catch((e: unknown) => toast.error(errorMessage(e)))} className="hd-press rounded p-1 text-fg-tertiary hover:bg-muted hover:text-error" aria-label="Remove rule"><Trash2 className="size-3.5" /></button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {rules && rules.length > 0 && <p className="mt-2 text-[11px] text-fg-tertiary">{active} of {rules.length} rules filing automatically.</p>}
      </Panel>
      <Panel title="Add a rule" blurb="Manual rules fire on the next matching email.">
        <form className="space-y-3" onSubmit={async (e) => { e.preventDefault(); const l = labels.find((x) => x.id === labelId); if (!l) { toast.error("Pick a folder."); return; } setBusy(true); try { await add({ kind, value, labelId: l.id, labelName: l.name }); setValue(""); toast.success("Rule added"); } catch (err) { toast.error(errorMessage(err)); } finally { setBusy(false); } }}>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-fg-secondary">When</label>
            <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className="h-8 w-full rounded-md border border-input bg-card px-2 text-sm"><option value="sender">Sender is</option><option value="domain">Sender&apos;s domain is</option><option value="subject">Subject contains</option></select>
          </div>
          <div>
            <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === "sender" ? "someone@example.com" : kind === "domain" ? "example.com" : "e.g. subpoena"} className="h-8 w-full rounded-md border border-input bg-card px-2 text-sm" />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-fg-secondary">File into</label>
            <select value={labelId} onChange={(e) => setLabelId(e.target.value)} className="h-8 w-full rounded-md border border-input bg-card px-2 text-sm"><option value="">Choose a folder…</option>{labels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select>
            {labelsLive.data !== undefined && labels.length === 0 && <p className="mt-1 text-[11px] text-fg-tertiary">Make a folder in Mail first.</p>}
          </div>
          <Button type="submit" size="sm" disabled={busy || !value.trim() || !labelId}>{busy ? "Adding…" : "Add rule"}</Button>
        </form>
      </Panel>
    </div>
  );
}
