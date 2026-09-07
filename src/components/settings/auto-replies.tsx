"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Panel, Pill, Empty, Loading, DataTable } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn, errorMessage } from "@/lib/utils";
import { ago, TONE_CLASS } from "@/lib/format";

type Rule = { id?: Id<"autoReplyRules">; name: string; enabled: boolean; trigger: "first" | "followUp" | "any"; contentMode: "none" | "keywords" | "ai"; keywords: string; aiPrompt: string; senderDomains: string; businessHoursOnly: boolean; mode: "send" | "draft"; subjectTemplate: string; bodyTemplate: string; addTagIds: Id<"tags">[]; assignTo?: Id<"users">; stopAfterMatch: boolean; appliesToAccountIds: Id<"googleAccounts">[] };

const blank = (): Rule => ({ name: "", enabled: false, trigger: "first", contentMode: "none", keywords: "", aiPrompt: "", senderDomains: "", businessHoursOnly: false, mode: "draft", subjectTemplate: "", bodyTemplate: "<p>Hi {{first_name}},</p><p>Thanks for your email. We’ve received it and will reply within two business days.</p><p>Kind regards,<br>{{my_name}}<br>{{practice}}</p>", addTagIds: [], stopAfterMatch: true, appliesToAccountIds: [] });

/** Auto-reply rules: first-in-chain vs follow-up, keyword or plain-English conditions, send or draft, tags and assignment. */
export function AutoRepliesTab() {
  const rules = useQuery(api.autoReply.list);
  const log = useQuery(api.autoReply.log, { limit: 30 });
  const tags = useQuery(api.tags.list);
  const users = useQuery(api.users.all);
  const setup = useQuery(api.settings.setupStatus);
  const save = useMutation(api.autoReply.save);
  const remove = useMutation(api.autoReply.remove);
  const [editing, setEditing] = useState<Rule | null>(null);
  if (rules === undefined) return <Loading rows={4} />;
  const edit = (r: NonNullable<typeof rules>[number]) => setEditing({ id: r._id, name: r.name, enabled: r.enabled, trigger: r.trigger, contentMode: r.contentMode, keywords: r.keywords.join(", "), aiPrompt: r.aiPrompt ?? "", senderDomains: r.senderDomains.join(", "), businessHoursOnly: r.businessHoursOnly, mode: r.mode, subjectTemplate: r.subjectTemplate ?? "", bodyTemplate: r.bodyTemplate, addTagIds: r.addTagIds, assignTo: r.assignTo, stopAfterMatch: r.stopAfterMatch, appliesToAccountIds: r.appliesToAccountIds });
  const submit = async () => {
    if (!editing) return;
    try {
      await save({ id: editing.id, name: editing.name.trim() || "Untitled rule", enabled: editing.enabled, trigger: editing.trigger, contentMode: editing.contentMode, keywords: editing.keywords.split(",").map((k) => k.trim()).filter(Boolean), aiPrompt: editing.aiPrompt || undefined, senderDomains: editing.senderDomains.split(",").map((k) => k.trim().replace(/^@/, "")).filter(Boolean), businessHoursOnly: editing.businessHoursOnly, mode: editing.mode, subjectTemplate: editing.subjectTemplate || undefined, bodyTemplate: editing.bodyTemplate, addTagIds: editing.addTagIds, assignTo: editing.assignTo, stopAfterMatch: editing.stopAfterMatch, appliesToAccountIds: editing.appliesToAccountIds });
      setEditing(null); toast.success("Rule saved");
    } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <div className="space-y-4">
      {!setup?.pubsub && <p className="rounded-xl bg-warning-soft px-4 py-2 text-xs text-fg-secondary">Rules run when new mail is synced: instantly with Gmail push configured, otherwise within 10 minutes.</p>}
      <Panel title="Auto-reply rules" blurb="Evaluated top to bottom on every new inbound message. Never replies to newsletters, auto-replies or yourselves, and at most once per sender per thread per week." actions={<Button size="sm" onClick={() => setEditing(blank())}>New rule</Button>}>
        {rules.length === 0 && !editing ? <Empty title="No rules yet" body="Start with a first-contact acknowledgement in draft mode, check the drafts for a week, then switch it to send." /> : (
          <ul className="divide-y divide-border/70">
            {rules.map((r) => (
              <li key={r._id} className="flex items-center gap-3 py-2.5">
                <Switch checked={r.enabled} onCheckedChange={(v) => save({ id: r._id, name: r.name, enabled: v, trigger: r.trigger, contentMode: r.contentMode, keywords: r.keywords, aiPrompt: r.aiPrompt, senderDomains: r.senderDomains, businessHoursOnly: r.businessHoursOnly, mode: r.mode, subjectTemplate: r.subjectTemplate, bodyTemplate: r.bodyTemplate, addTagIds: r.addTagIds, assignTo: r.assignTo, stopAfterMatch: r.stopAfterMatch, appliesToAccountIds: r.appliesToAccountIds })} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium">{r.name}<Pill tone={r.mode === "send" ? "warn" : "info"}>{r.mode === "send" ? "sends" : "drafts"}</Pill><Pill>{r.trigger === "first" ? "first in chain" : r.trigger === "followUp" ? "follow-ups" : "any message"}</Pill>{r.contentMode !== "none" && <Pill>{r.contentMode === "ai" ? "Claude condition" : "keywords"}</Pill>}{r.businessHoursOnly && <Pill>business hours</Pill>}</div>
                  <div className="text-xs text-fg-tertiary">{r.sent} sent · {r.drafted} drafted{r.lastAt ? ` · last ${ago(r.lastAt)}` : ""}</div>
                </div>
                <Button size="xs" variant="ghost" onClick={() => edit(r)}>Edit</Button>
                <Button size="xs" variant="ghost" onClick={() => { if (confirm(`Delete “${r.name}”?`)) void remove({ id: r._id }); }}>Delete</Button>
              </li>
            ))}
          </ul>
        )}
        {editing && (
          <form className="mt-4 space-y-4 rounded-xl bg-muted/50 p-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
              <div><Label htmlFor="r-name">Rule name</Label><Input id="r-name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="First-contact acknowledgement" required /></div>
              <div className="flex items-end gap-4"><label className="flex items-center gap-2 text-sm"><Switch checked={editing.enabled} onCheckedChange={(v) => setEditing({ ...editing, enabled: v })} />Enabled</label><label className="flex items-center gap-2 text-sm"><Switch checked={editing.businessHoursOnly} onCheckedChange={(v) => setEditing({ ...editing, businessHoursOnly: v })} />Only outside business hours</label></div>
            </div>
            <fieldset className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-3">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-fg-tertiary">When</legend>
              <div><Label>Message is</Label><div className="mt-1 flex gap-1">{([["first", "First in a chain"], ["followUp", "A follow-up"], ["any", "Either"]] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setEditing({ ...editing, trigger: k })} className={cn("rounded-full px-2.5 py-1 text-xs", editing.trigger === k ? "bg-foreground text-background" : "bg-card text-fg-secondary ring-1 ring-border")}>{l}</button>)}</div></div>
              <div><Label>Content</Label><div className="mt-1 flex gap-1">{([["none", "Any"], ["keywords", "Has keywords"], ["ai", "Claude decides"]] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setEditing({ ...editing, contentMode: k })} className={cn("rounded-full px-2.5 py-1 text-xs", editing.contentMode === k ? "bg-foreground text-background" : "bg-card text-fg-secondary ring-1 ring-border")}>{l}</button>)}</div></div>
              <div><Label htmlFor="r-dom">Only from domains (optional)</Label><Input id="r-dom" value={editing.senderDomains} onChange={(e) => setEditing({ ...editing, senderDomains: e.target.value })} placeholder="legalaid.vic.gov.au, firm.com.au" /></div>
              {editing.contentMode === "keywords" && <div className="sm:col-span-3"><Label htmlFor="r-kw">Keywords (any of, comma separated)</Label><Input id="r-kw" value={editing.keywords} onChange={(e) => setEditing({ ...editing, keywords: e.target.value })} placeholder="family report, assessment, appointment" /></div>}
              {editing.contentMode === "ai" && <div className="sm:col-span-3"><Label htmlFor="r-ai">Condition in plain English</Label><Input id="r-ai" value={editing.aiPrompt} onChange={(e) => setEditing({ ...editing, aiPrompt: e.target.value })} placeholder="The sender is a parent or solicitor asking to book a family assessment for the first time" />{!setup?.anthropic && <p className="mt-1 text-xs text-warning">ANTHROPIC_API_KEY isn’t set, so this rule will be skipped.</p>}</div>}
            </fieldset>
            <fieldset className="space-y-3">
              <legend className="mb-1 text-xs font-semibold uppercase tracking-wider text-fg-tertiary">Then</legend>
              <div className="flex flex-wrap gap-1">{([["draft", "Create a draft for me to check"], ["send", "Send the reply automatically"]] as const).map(([k, l]) => <button key={k} type="button" onClick={() => setEditing({ ...editing, mode: k })} className={cn("rounded-full px-2.5 py-1 text-xs", editing.mode === k ? "bg-foreground text-background" : "bg-card text-fg-secondary ring-1 ring-border")}>{l}</button>)}</div>
              <div><Label htmlFor="r-subj">Subject (blank = “Re: original subject”)</Label><Input id="r-subj" value={editing.subjectTemplate} onChange={(e) => setEditing({ ...editing, subjectTemplate: e.target.value })} placeholder="Re: {{subject}}" /></div>
              <div><Label htmlFor="r-body">Reply (HTML). Merge fields: {"{{first_name}} {{name}} {{subject}} {{my_name}} {{practice}}"}</Label><Textarea id="r-body" rows={6} className="font-mono text-xs" value={editing.bodyTemplate} onChange={(e) => setEditing({ ...editing, bodyTemplate: e.target.value })} /><div className="mt-2 rounded-lg bg-card p-3 text-sm ring-1 ring-border" dangerouslySetInnerHTML={{ __html: editing.bodyTemplate.replace(/\{\{\s*first_name\s*\}\}/g, "Jane").replace(/\{\{\s*name\s*\}\}/g, "Jane Smith").replace(/\{\{\s*subject\s*\}\}/g, "Family report").replace(/\{\{\s*my_name\s*\}\}/g, "Barbara").replace(/\{\{\s*practice\s*\}\}/g, "Barbara Fraser & Associates") }} /></div>
              <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2">
                <div><Label>Add tags</Label><div className="mt-1 flex flex-wrap gap-1">{(tags ?? []).map((t) => { const on = editing.addTagIds.includes(t._id); return <button key={t._id} type="button" onClick={() => setEditing({ ...editing, addTagIds: on ? editing.addTagIds.filter((x) => x !== t._id) : [...editing.addTagIds, t._id] })} className={cn("rounded-full px-2 py-0.5 text-[11px]", on ? TONE_CLASS[t.color] : "bg-card text-fg-tertiary ring-1 ring-border")}>{t.name}</button>; })}{tags?.length === 0 && <span className="text-xs text-fg-quaternary">No tags yet.</span>}</div></div>
                <div><Label>Assign to</Label><div className="mt-1 flex gap-1">{(users ?? []).map((u) => <button key={u._id} type="button" onClick={() => setEditing({ ...editing, assignTo: editing.assignTo === u._id ? undefined : u._id })} className={cn("rounded-full px-2.5 py-1 text-xs", editing.assignTo === u._id ? "bg-foreground text-background" : "bg-card text-fg-secondary ring-1 ring-border")}>{u.first}</button>)}</div></div>
              </div>
              <label className="flex items-center gap-2 text-sm"><Switch checked={editing.stopAfterMatch} onCheckedChange={(v) => setEditing({ ...editing, stopAfterMatch: v })} />Stop checking other rules after this one matches</label>
            </fieldset>
            <div className="flex gap-2"><Button type="submit">Save rule</Button><Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div>
          </form>
        )}
      </Panel>
      <Panel title="Recent activity" dense>
        {log === undefined ? <Loading rows={2} /> : log.length === 0 ? <p className="text-sm text-fg-tertiary">Nothing yet.</p> : (
          <DataTable head={<><th>When</th><th>Rule</th><th>Conversation</th><th>Action</th></>} minWidth={520}>
            {log.map((l) => <tr key={l._id}><td className="text-xs text-fg-tertiary">{ago(l.at)}</td><td>{l.rule}</td><td className="truncate">{l.subject}</td><td><Pill tone={l.action === "sent" ? "good" : l.action === "drafted" ? "info" : "neutral"}>{l.action}</Pill>{l.reason && <span className="ml-1 text-xs text-fg-tertiary">{l.reason}</span>}</td></tr>)}
          </DataTable>
        )}
      </Panel>
    </div>
  );
}
