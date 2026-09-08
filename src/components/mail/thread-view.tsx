/* eslint-disable @next/next/no-img-element -- attachment previews are proxied Gmail bytes, not optimisable assets */
"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import Link from "next/link";
import { PrefetchLink } from "@/components/prefetch-link";
import { FileText, Archive, ArchiveRestore, Reply, ReplyAll, Forward, Star, Trash2, Tag, UserCheck, Briefcase, ListTodo, MailOpen, FolderInput, Paperclip, Download, Eye, ChevronDown, ChevronUp, Sparkles, X, Bot, CalendarCheck2, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { MessageView, ThreadMeta } from "../../../convex/mail";
import { MessageFrame } from "./message-frame";
import { CreateCaseDialog } from "./create-case-dialog";
import { TagPicker, AssignPicker, MatterPicker, LabelPicker } from "./pickers";
import type { Label } from "./folder-list";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, errorMessage } from "@/lib/utils";
import { bytes, when, TONE_CLASS, initials } from "@/lib/format";

export type ThreadData = { gmailThreadId: string; subject: string; messages: MessageView[]; labelIds: string[] };

const attachmentUrl = (m: MessageView, a: MessageView["attachments"][number], inline = false) => `/api/mail/attachment?message=${encodeURIComponent(m.gmailMessageId)}&id=${encodeURIComponent(a.attachmentId)}&name=${encodeURIComponent(a.filename)}&mime=${encodeURIComponent(a.mime)}${inline ? "&inline=1" : ""}`;

/** The reader: conversation header with actions, then each message with its sandboxed body and attachments. */
const PLAN_RE = /mental\s*health\s*(care|treatment)?\s*plan|\bMHCP\b|\bMHTP\b|better\s*access/i;

export function ThreadView({ thread, meta, labels, loading, error, myFirst, showImagesDefault, onAction, onReply, onClose }: {
  thread?: ThreadData; meta?: ThreadMeta; labels: Label[]; loading: boolean; error?: string; myFirst?: string; showImagesDefault: boolean;
  onAction: (op: "archive" | "unarchive" | "trash" | "untrash" | "star" | "unstar" | "unread" | "spam" | "labels", payload?: { add: string[]; remove: string[] }) => void;
  onReply: (mode: "reply" | "replyAll" | "forward", message: MessageView) => void;
  onClose: () => void;
}) {
  const finishAssignment = useMutation(api.mail.finishAssignment);
  const setTags = useMutation(api.mail.setTags);
  const toggleRescheduled = useMutation(api.mail.toggleRescheduled);
  const saveTask = useMutation(api.tasks.save);
  const router = useRouter();
  const [expandedOverride, setExpandedOverride] = useState<{ threadId: string; set: Set<string> } | null>(null);
  const [caseFor, setCaseFor] = useState<{ gmailMessageId: string; attachment: { attachmentId: string; filename: string; mime: string } } | null>(null);
  const [preview, setPreview] = useState<{ url: string; name: string; mime: string } | null>(null);
  const detail = useQuery(api.mail.threadDetail, meta?.threadId ? { threadId: meta.threadId } : "skip");
  const nonDraft = useMemo(() => (thread?.messages ?? []).filter((m) => !m.isDraft), [thread]);
  const last = nonDraft[nonDraft.length - 1];
  const expanded = expandedOverride && expandedOverride.threadId === thread?.gmailThreadId ? expandedOverride.set : new Set(last ? [last.gmailMessageId] : []);
  const setExpanded = (fn: (s: Set<string>) => Set<string>) => { if (thread) setExpandedOverride({ threadId: thread.gmailThreadId, set: fn(expanded) }); };

  if (!thread && !loading && !error) return <div className="flex h-full items-center justify-center text-sm text-fg-tertiary">Select a conversation, or press <kbd className="mx-1 rounded border border-border px-1 font-mono text-[10px]">c</kbd> to compose.</div>;
  if (error) return <div className="p-6 text-sm text-error">{error}</div>;
  if (!thread) return <div className="space-y-3 p-6">{[0, 1, 2].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-muted" />)}</div>;

  const inInbox = thread.labelIds.includes("INBOX");
  const inTrash = thread.labelIds.includes("TRASH");
  const starred = thread.labelIds.includes("STARRED");
  const cidMapFor = (m: MessageView) => Object.fromEntries(m.attachments.filter((a) => a.contentId && a.attachmentId).map((a) => [a.contentId!, attachmentUrl(m, a, true)]));
  const realAttachments = (m: MessageView) => m.attachments.filter((a) => a.attachmentId && !(a.inline && a.contentId && (m.html ?? "").includes(`cid:${a.contentId}`)));
  const makeTask = async () => {
    if (!meta?.threadId || !last) return;
    try { const id = await saveTask({ title: thread.subject, notes: `From ${last.from.name} <${last.from.email}>\n\n${(last.text ?? last.snippet).slice(0, 2000)}`, sourceThreadId: meta.threadId, matterId: meta.matter?._id }); toast.success("Task created", { action: { label: "Open", onClick: () => router.push(`/tasks?task=${id}`) } }); } catch (e) { toast.error(errorMessage(e)); }
  };

  return (
    <div className="flex h-full min-w-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-3 py-2">
        <Act label="Back" onClick={onClose} className="md:hidden"><X className="size-4" /></Act>
        {inTrash ? <Act label="Restore" onClick={() => onAction("untrash")}><ArchiveRestore className="size-4" /></Act> : inInbox ? <Act label="Archive (e)" onClick={() => onAction("archive")}><Archive className="size-4" /></Act> : <Act label="Move to inbox" onClick={() => onAction("unarchive")}><ArchiveRestore className="size-4" /></Act>}
        <Act label={inTrash ? "Delete forever" : "Delete (#)"} onClick={() => onAction("trash")}><Trash2 className="size-4" /></Act>
        <Act label="Mark unread (u)" onClick={() => onAction("unread")}><MailOpen className="size-4" /></Act>
        <Act label={starred ? "Unstar (s)" : "Star (s)"} onClick={() => onAction(starred ? "unstar" : "star")}><Star className={cn("size-4", starred && "text-gold")} fill={starred ? "currentColor" : "none"} /></Act>
        <LabelPicker labels={labels} currentLabelIds={thread.labelIds} onApply={(add, remove) => onAction("labels", { add, remove })} trigger={<Act label="Move to folder" asSpan><FolderInput className="size-4" /></Act>} />
        <div className="mx-1 h-5 w-px bg-border" />
        <TagPicker threadId={meta?.threadId} current={meta?.tags.map((t) => t._id) ?? []} trigger={<Act label="Tags" asSpan><Tag className="size-4" /></Act>} />
        <AssignPicker threadId={meta?.threadId} subject={thread.subject} assignedTo={meta?.assignedTo?.userId} otherMailboxHasIt={meta?.otherMailboxHasIt ?? false} trigger={<Act label="Assign" asSpan><UserCheck className="size-4" /></Act>} />
        <MatterPicker threadId={meta?.threadId} current={meta?.matter?._id} trigger={<Act label="Matter" asSpan><Briefcase className="size-4" /></Act>} />
        <Act label="Turn into task" onClick={makeTask}><ListTodo className="size-4" /></Act>
        <div className="ml-auto flex items-center gap-1">
          {last && <><Button size="sm" variant="outline" onClick={() => onReply("reply", last)}><Reply className="size-3.5" />Reply</Button><Button size="sm" variant="outline" onClick={() => onReply("replyAll", last)}><ReplyAll className="size-3.5" />All</Button><Button size="sm" variant="outline" onClick={() => onReply("forward", last)}><Forward className="size-3.5" />Forward</Button></>}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
        <div className="px-5 pb-3 pt-4">
          <h2 className="font-display text-[22px] leading-snug">{thread.subject}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {meta?.overdue && <Pill className="bg-error-soft text-error">Overdue · no reply from either of you</Pill>}
            {meta?.repliedBy.filter((r) => r.first !== myFirst).map((r) => <Pill key={r.email} className="bg-success-soft text-success"><Reply className="size-3" />{r.first} replied</Pill>)}
            {meta?.repliedBy.some((r) => r.first === myFirst) && <Pill className="bg-success-soft text-success"><Reply className="size-3" />You replied</Pill>}
            {meta?.autoReplied && <Pill className="bg-success-soft text-success"><Bot className="size-3" />Auto replied</Pill>}
            {meta?.rescheduled && <button type="button" title="Click to clear" onClick={() => meta.threadId && toggleRescheduled({ threadId: meta.threadId })}><Pill className="bg-success-soft text-success"><CalendarCheck2 className="size-3" />Already rescheduled</Pill></button>}
            {meta?.rescheduleRequested && <button type="button" title="Click once the appointment has been moved" onClick={() => meta.threadId && toggleRescheduled({ threadId: meta.threadId })}><Pill className="bg-warning-soft text-warning"><CalendarClock className="size-3" />Reschedule requested · mark done</Pill></button>}
            {meta?.assignedTo && <Pill className="bg-warning-soft text-warning"><UserCheck className="size-3" />{meta.assignedTo.first} to follow up{meta.assignedBy ? ` (from ${meta.assignedBy.first})` : ""}{meta.assignmentNote ? `: ${meta.assignmentNote}` : ""}<button type="button" className="ml-1 underline" onClick={() => meta.threadId && finishAssignment({ threadId: meta.threadId })}>done</button></Pill>}
            {meta?.matter && <PrefetchLink href={`/matters/${meta.matter._id}`} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-fg-secondary hover:text-foreground"><Briefcase className="size-3" />{meta.matter.name}</PrefetchLink>}
            {meta?.tags.map((t) => <Pill key={t._id} className={TONE_CLASS[t.color]}>{t.name}</Pill>)}
            {meta?.suggestedTags.map((t) => <button key={t._id} type="button" title="Suggested by Claude. Click to apply." onClick={() => meta.threadId && setTags({ threadId: meta.threadId, tagIds: [...meta.tags.map((x) => x._id), t._id] })} className={cn("inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-[11px] font-medium opacity-80 hover:opacity-100", TONE_CLASS[t.color])}><Sparkles className="size-3" />{t.name}</button>)}
            {(detail?.tasks.length ?? 0) > 0 && <Link href={`/tasks?task=${detail!.tasks[0]._id}`} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px] text-fg-secondary hover:text-foreground"><ListTodo className="size-3" />{detail!.tasks.length} task{detail!.tasks.length === 1 ? "" : "s"}</Link>}
          </div>
          {meta?.aiSummary && <p className="mt-2 flex items-start gap-1.5 text-xs text-fg-tertiary"><Sparkles className="mt-0.5 size-3 shrink-0" />{meta.aiSummary}</p>}
        </div>

        <ol className="space-y-2 px-3 pb-6">
          {thread.messages.map((m) => {
            const open = expanded.has(m.gmailMessageId) || m.isDraft;
            const atts = realAttachments(m);
            // A mental health plan in the conversation, with a PDF or photo attached: offer to turn it into a Cliniko case.
            const planAtt = PLAN_RE.test(`${thread.subject}\n${m.text ?? m.snippet ?? ""}`) ? atts.find((a) => a.attachmentId && /^(application\/pdf|image\/(jpeg|png|webp|gif))$/.test(a.mime)) : undefined;
            return (
              <li key={m.gmailMessageId} className={cn("hd-enter rounded-xl bg-card shadow-xs ring-1 ring-black/[0.06] dark:ring-white/10", m.isDraft && "ring-error/40")}>
                <button type="button" onClick={() => setExpanded((s) => { const n = new Set(s); if (n.has(m.gmailMessageId)) n.delete(m.gmailMessageId); else n.add(m.gmailMessageId); return n; })} className="flex w-full items-start gap-3 px-4 py-3 text-left">
                  <span className={cn("mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold", m.fromOrg ? "bg-foreground text-background" : "bg-muted text-fg-secondary")}>{initials(m.from.name || m.from.email)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2"><span className={cn("truncate text-sm", m.unread ? "font-semibold" : "font-medium")}>{m.fromMe ? "me" : m.from.name}</span><span className="truncate text-xs text-fg-tertiary">{m.from.email}</span>{m.isDraft && <span className="text-xs font-medium text-error">Draft</span>}{m.autoSubmitted && <span className="text-[10px] uppercase tracking-wide text-fg-quaternary">auto</span>}<span className="num ml-auto shrink-0 text-xs text-fg-tertiary">{when(m.date)}</span></span>
                    {open ? <span className="mt-0.5 block truncate text-xs text-fg-tertiary">to {[...m.to, ...m.cc].map((a) => (a.name && a.name !== a.email ? a.name : a.email)).join(", ") || "—"}</span> : <span className="mt-0.5 block truncate text-xs text-fg-tertiary">{m.snippet}</span>}
                  </span>
                  <span className="mt-1 text-fg-quaternary">{open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}</span>
                </button>
                {planAtt && <div className="flex items-center gap-2 px-4 pb-2 text-xs text-fg-secondary"><FileText className="size-3.5 text-fg-tertiary" />Looks like a mental health plan.<Button size="xs" onClick={() => setCaseFor({ gmailMessageId: m.gmailMessageId, attachment: { attachmentId: planAtt.attachmentId!, filename: planAtt.filename, mime: planAtt.mime } })}>Create Case</Button></div>}
                {open && (
                  <div className="border-t border-border/70 px-4 py-3">
                    <MessageFrame html={m.html} text={m.text} cidMap={cidMapFor(m)} showImagesDefault={showImagesDefault || m.fromOrg} />
                    {atts.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {atts.map((a) => (
                          <div key={a.attachmentId} className="flex items-center gap-2 rounded-lg bg-muted px-2.5 py-1.5 text-xs">
                            {a.mime.startsWith("image/") ? <img src={attachmentUrl(m, a, true)} alt="" className="size-8 rounded object-cover" /> : <Paperclip className="size-3.5 text-fg-tertiary" />}
                            <span className="max-w-[180px] truncate" title={a.filename}>{a.filename}</span>
                            <span className="text-fg-quaternary">{bytes(a.size)}</span>
                            {(a.mime.startsWith("image/") || a.mime === "application/pdf" || a.mime.startsWith("text/")) && <button type="button" onClick={() => setPreview({ url: attachmentUrl(m, a, true), name: a.filename, mime: a.mime })} className="rounded p-0.5 text-fg-tertiary hover:text-foreground" aria-label="Preview"><Eye className="size-3.5" /></button>}
                            <a href={attachmentUrl(m, a)} className="rounded p-0.5 text-fg-tertiary hover:text-foreground" aria-label="Download"><Download className="size-3.5" /></a>
                            {a.mime === "application/pdf" && <Link href={`/pdf?sign=${encodeURIComponent(attachmentUrl(m, a, true))}&name=${encodeURIComponent(a.filename)}&reply=${encodeURIComponent(m.gmailMessageId)}`} className="rounded px-1 text-[11px] font-medium text-blue hover:underline">Sign</Link>}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mt-3 flex gap-1">
                      <Button size="xs" variant="ghost" onClick={() => onReply("reply", m)}><Reply className="size-3" />Reply</Button>
                      <Button size="xs" variant="ghost" onClick={() => onReply("replyAll", m)}><ReplyAll className="size-3" />Reply all</Button>
                      <Button size="xs" variant="ghost" onClick={() => onReply("forward", m)}><Forward className="size-3" />Forward</Button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black/80 p-4" onClick={() => setPreview(null)}>
          <div className="flex items-center gap-3 pb-3 text-white"><span className="min-w-0 flex-1 truncate text-sm">{preview.name}</span><a href={preview.url.replace("&inline=1", "")} className="text-xs underline" onClick={(e) => e.stopPropagation()}>Download</a><button type="button" className="rounded p-1 hover:bg-white/10" aria-label="Close"><X className="size-5" /></button></div>
          <div className="min-h-0 flex-1 overflow-hidden rounded-lg bg-white" onClick={(e) => e.stopPropagation()}>
            {preview.mime.startsWith("image/") ? <img src={preview.url} alt={preview.name} className="mx-auto h-full object-contain" /> : <iframe title={preview.name} src={preview.url} className="h-full w-full" />}
          </div>
        </div>
      )}
      {caseFor && <CreateCaseDialog gmailMessageId={caseFor.gmailMessageId} attachment={caseFor.attachment} onClose={() => setCaseFor(null)} />}
    </div>
  );
}

const Pill = ({ children, className }: { children: React.ReactNode; className?: string }) => <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4", className)}>{children}</span>;

function Act({ children, label, onClick, className, asSpan }: { children: React.ReactNode; label: string; onClick?: () => void; className?: string; asSpan?: boolean }) {
  const cls = cn("inline-flex size-8 items-center justify-center rounded-lg text-fg-secondary hover:bg-muted hover:text-foreground", className);
  return (
    <Tooltip>
      <TooltipTrigger render={asSpan ? <span className={cls} /> : <button type="button" onClick={onClick} className={cls} aria-label={label} />}>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
