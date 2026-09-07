"use client";

import { useEffect, useState } from "react";
import { useLive } from "@/lib/hooks";
import { useSearchParams } from "next/navigation";
import { replaceUrl } from "@/lib/shallow";
import { useAction, useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { PageHeader, Panel, Pill, Dot, Facts, Empty, Loading } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ago, aud, TONES, TONE_CLASS, TONE_DOT } from "@/lib/format";
import { cn, errorMessage } from "@/lib/utils";
import { siteUrl } from "@/lib/public-url";
import type { Id } from "../../../convex/_generated/dataModel";
import { AutoRepliesTab } from "./auto-replies";
import { FolderRulesTab } from "./folder-rules";
import { NotificationsTab } from "./notifications-tab";
import { mailStore } from "@/lib/mail-store";
import { bytes } from "@/lib/format";

const TABS = [["setup", "Setup"], ["google", "Google"], ["autoreplies", "Auto-replies"], ["folders", "Folder rules"], ["notifications", "Notifications"], ["cliniko", "Cliniko & pricing"], ["stripe", "Stripe"], ["signatures", "Signatures"], ["tags", "Tags"], ["practice", "Practice"]] as const;
type Tab = (typeof TABS)[number][0];

export function SettingsPage() {
  const params = useSearchParams();
  const tab = (params.get("tab") as Tab | null) ?? (params.get("google") ? "google" : "setup");
  useEffect(() => {
    const g = params.get("google");
    if (g === "connected") toast.success(`Google connected as ${params.get("email")}`);
    if (g === "error") toast.error(params.get("message") ?? "Google connection failed");
    if (g) replaceUrl("/settings?tab=google");
  }, [params]);
  return (
    <div className="space-y-5">
      <PageHeader title="Settings" blurb="Connections, pricing, signatures and tags. Secrets live on the Convex deployment, never in this page." />
      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map(([key, label]) => <button key={key} type="button" onClick={() => replaceUrl(`/settings?tab=${key}`)} className={cn("-mb-px border-b-2 px-3 py-2 text-sm", tab === key ? "border-foreground font-medium text-foreground" : "border-transparent text-fg-tertiary hover:text-foreground")}>{label}</button>)}
      </div>
      {tab === "setup" && <SetupTab />}
      {tab === "google" && <GoogleTab />}
      {tab === "autoreplies" && <AutoRepliesTab />}
      {tab === "folders" && <FolderRulesTab />}
      {tab === "notifications" && <NotificationsTab />}
      {tab === "cliniko" && <ClinikoTab />}
      {tab === "stripe" && <StripeTab />}
      {tab === "signatures" && <SignaturesTab />}
      {tab === "tags" && <TagsTab />}
      {tab === "practice" && <PracticeTab />}
    </div>
  );
}

/* ------------------------------ setup checklist ------------------------------ */

function SetupTab() {
  const s = useQuery(api.settings.setupStatus);
  const me = useQuery(api.users.me);
  if (!s) return <Loading rows={6} />;
  const site = process.env.NEXT_PUBLIC_CONVEX_URL?.replace(".convex.cloud", ".convex.site");
  const here = typeof window !== "undefined" ? window.location.origin : "";
  const built = process.env.NEXT_PUBLIC_SITE_URL ?? "";
  const urlsOk = !!s.appUrl && !/localhost/.test(s.appUrl) && !/localhost/.test(built) && (!built || built === here) && s.appUrl === here;
  const rows: Array<[string, boolean, string]> = [
    ["Public URL (NEXT_PUBLIC_SITE_URL on Railway, APP_URL on Convex)", urlsOk, urlsOk ? `Both are ${here}.` : `This page is ${here}; the app was built with “${built || "unset"}” and Convex has “${s.appUrl ?? "unset"}”. All three must match or Google sign-in and emailed links break.`],
    ["Clerk JWT template (CLERK_JWT_ISSUER_DOMAIN)", s.clerkJwt, "Create a JWT template named “convex” in Clerk and copy its issuer."],
    ["Google OAuth app (GOOGLE_CLIENT_ID / SECRET)", s.googleOAuth, `Internal app on the barbarafraser.net Workspace. Redirect URI: ${s.appUrl ?? here}/api/google/callback`],
    ["Token encryption key (TOKEN_ENCRYPTION_KEY)", s.tokenKey, "32 random bytes, base64. Encrypts Google refresh tokens at rest."],
    ["Gmail push (GOOGLE_PUBSUB_TOPIC / VERIFICATION_TOKEN)", s.pubsub, `Optional. Without it mail syncs every 10 minutes. Push endpoint: ${site}/gmail/push?token=…`],
    ["Cliniko API key (CLINIKO_API_KEY)", s.cliniko, `Shard ${s.clinikoShard}, subdomain ${s.clinikoSubdomain ?? "not set"}.`],
    ["Stripe secret key (STRIPE_SECRET_KEY)", s.stripe, "Live or test key from the Stripe dashboard."],
    ["Stripe webhook (STRIPE_WEBHOOK_SECRET)", s.stripeWebhook, `Endpoint: ${site}/stripe/webhook — events: invoice.*, checkout.session.*, payment_intent.*`],
    ["Claude (ANTHROPIC_API_KEY)", s.anthropic, "Powers tag suggestions, smart inbox fallback and AI auto-reply conditions."],
  ];
  const done = rows.filter((r) => r[1]).length;
  return (
    <div className="space-y-4">
      <Panel title="Deployment checklist" blurb={`${done} of ${rows.length} configured. Set each with: npx convex env set NAME value`}>
        <ul className="divide-y divide-border/70">
          {rows.map(([label, ok, hint]) => (
            <li key={label} className="flex items-start gap-3 py-2.5">
              <Dot tone={ok ? "good" : "warn"} className="mt-1.5" />
              <div className="min-w-0 flex-1"><p className="text-sm font-medium">{label}</p><p className="text-xs text-fg-tertiary break-all">{hint}</p></div>
              <Pill tone={ok ? "good" : "warn"}>{ok ? "set" : "missing"}</Pill>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="You" dense>
        <Facts items={[["Signed in as", me?.email], ["Gmail", me?.google ? `${me.google.email} (${me.google.status})` : "not connected"], ["Last mail sync", me?.google?.lastSyncAt ? ago(me.google.lastSyncAt) : "—"], ["Push watch expires", me?.google?.watchExpiresAt ? ago(me.google.watchExpiresAt).replace(" ago", "") : "no push (polling)"]]} />
      </Panel>
    </div>
  );
}

/* ------------------------------ google ------------------------------ */

function GoogleTab() {
  const me = useQuery(api.users.me);
  const disconnect = useAction(api.google.disconnect);
  const [busy, setBusy] = useState(false);
  const g = me?.google;
  return (
    <Panel title="Google Workspace" blurb="Each of you connects your own mailbox. Happy Days reads and sends through the Gmail API and keeps only message headers.">
      <div className="flex flex-wrap items-center gap-4">
        <Dot tone={g?.status === "connected" ? "good" : g ? "warn" : "neutral"} pulse={g?.status === "needs_reauth"} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{g ? g.email : "Not connected"}</p>
          <p className="text-xs text-fg-tertiary">{g?.status === "connected" ? `Connected · last sync ${ago(g.lastSyncAt)}` : g?.status === "needs_reauth" ? "Google revoked access. Connect again." : g ? "Disconnected" : "Connect the Google account that matches your sign-in email."}</p>
        </div>
        {g?.status === "connected" ? (
          <><Button variant="outline" render={<a href="/api/google/connect" />}>Reconnect</Button><Button variant="destructive" disabled={busy} onClick={async () => { setBusy(true); try { await disconnect({}); toast.success("Disconnected"); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } }}>Disconnect</Button></>
        ) : (
          <Button render={<a href="/api/google/connect" />}>Connect Google</Button>
        )}
      </div>
      <div className="mt-5 rounded-xl bg-muted/60 p-4 text-xs text-fg-secondary">
        <p className="font-medium text-foreground">What Happy Days asks Google for</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li>Read, label, archive and delete mail (gmail.modify)</li>
          <li>Send mail and manage drafts as you (gmail.send, gmail.compose)</li>
          <li>Your email address, to check it matches your Happy Days sign-in</li>
        </ul>
        <p className="mt-2">Bodies and attachments are fetched when you open them and are never stored. The refresh token is encrypted at rest.</p>
      </div>
    </Panel>
  );
}

/* ------------------------------ cliniko + pricing ------------------------------ */

type Practice = { businesses: Array<{ id: string; business_name: string; display_name?: string }>; practitioners: Array<{ id: string; first_name: string; last_name: string; designation?: string }>; appointmentTypes: Array<{ id: string; name: string; duration_in_minutes: number; show_in_online_bookings: boolean }> };

function ClinikoTab() {
  const status = useQuery(api.settings.setupStatus);
  const pricing = useQuery(api.bookings.pricing);
  const syncPricing = useAction(api.bookings.syncPricing);
  const settings = useQuery(api.settings.all);
  const setSetting = useMutation(api.settings.set);
  const live = useLive(api.bookings.practice, status?.cliniko ? {} : "skip");
  const practice: Practice | null | undefined = !status ? undefined : !status.cliniko ? null : live.error ? null : live.data;
  const error = live.error ?? null;
  if (!status || pricing === undefined || practice === undefined) return <Loading rows={5} />;
  return (
    <div className="space-y-4" id="cliniko">
      <Panel title="Cliniko" blurb={`api.${status.clinikoShard}.cliniko.com · ${status.clinikoSubdomain ?? "subdomain not set"}`} actions={practice && <Button size="sm" variant="outline" onClick={async () => { try { const n = await syncPricing({}); toast.success(`${n} appointment types refreshed`); } catch (e) { toast.error(errorMessage(e)); } }}>Refresh appointment types</Button>}>
        {!status.cliniko ? <Empty title="No API key yet" body="Set CLINIKO_API_KEY, CLINIKO_SHARD and CLINIKO_SUBDOMAIN on the Convex deployment. The key inherits Luke's permissions." /> : error ? <p className="text-sm text-error">{error}</p> : practice && (
          <div className="grid gap-4 sm:grid-cols-3">
            <Facts items={[["Business", practice.businesses.map((b) => b.display_name || b.business_name).join(", ")], ["Default business id", String(settings?.["cliniko.businessId"] ?? practice.businesses[0]?.id ?? "")]]} />
            <Facts items={[["Practitioners", practice.practitioners.map((p) => `${p.first_name} ${p.last_name}`).join(", ")], ["Default practitioner id", String(settings?.["cliniko.practitionerId"] ?? practice.practitioners[0]?.id ?? "")]]} />
            <Facts items={[["Appointment types", String(practice.appointmentTypes.length)], ["Priced for online booking", String(pricing.filter((p) => p.bookableOnline && p.mode !== "none").length)]]} />
          </div>
        )}
        {practice && <IntakeFormSetting value={(settings?.["cliniko.intakeFormTemplateId"] as string | undefined) ?? ""} onChange={(v) => setSetting({ key: "cliniko.intakeFormTemplateId", value: v || null })} />}
        {practice && (
          <div className="mt-4 flex flex-wrap gap-3 text-sm">
            <label className="flex items-center gap-2">Default business<select className="h-8 rounded-lg border border-input bg-card px-2 text-sm" value={String(settings?.["cliniko.businessId"] ?? practice.businesses[0]?.id ?? "")} onChange={(e) => void setSetting({ key: "cliniko.businessId", value: e.target.value })}>{practice.businesses.map((b) => <option key={b.id} value={b.id}>{b.display_name || b.business_name}</option>)}</select></label>
            <label className="flex items-center gap-2">Default practitioner<select className="h-8 rounded-lg border border-input bg-card px-2 text-sm" value={String(settings?.["cliniko.practitionerId"] ?? practice.practitioners[0]?.id ?? "")} onChange={(e) => void setSetting({ key: "cliniko.practitionerId", value: e.target.value })}>{practice.practitioners.map((p) => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}</select></label>
          </div>
        )}
      </Panel>
      <p className="text-xs text-fg-tertiary">Prices for online booking are set per appointment type under Cliniko Link → Appointment Types.</p>
      {status.cliniko && <ClinikoUsersPanel />}
    </div>
  );
}

export function PricingRow({ p, color, telehealth, clinikoOnline, onSave }: { p: { name: string; durationMinutes: number; mode: "full" | "deposit" | "none"; feeCents: number; depositCents?: number; bookableOnline: boolean }; color?: string; telehealth?: boolean; clinikoOnline?: boolean; onSave: (patch: Partial<{ mode: "full" | "deposit" | "none"; feeCents: number; depositCents: number; bookableOnline: boolean }>) => void }) {
  const [fee, setFee] = useState((p.feeCents / 100).toFixed(2));
  const [dep, setDep] = useState(((p.depositCents ?? 0) / 100).toFixed(2));
  return (
    <tr>
      <td className="font-medium"><span className="mr-2 inline-block size-3 rounded-full align-middle ring-1 ring-black/10" style={{ background: color ?? "#0081f2" }} />{p.name}{telehealth && <Pill tone="info" className="ml-1">telehealth</Pill>}</td>
      <td className="num text-fg-secondary">{p.durationMinutes} min</td>
      <td>{clinikoOnline ? <Pill tone="good">yes</Pill> : <Pill>no</Pill>}</td>
      <td><Switch checked={p.bookableOnline} onCheckedChange={(v) => onSave({ bookableOnline: v })} /></td>
      <td><select className="h-8 rounded-lg border border-input bg-card px-2 text-sm" value={p.mode} onChange={(e) => onSave({ mode: e.target.value as "full" | "deposit" | "none" })}><option value="none">Not payable online</option><option value="full">Full fee</option><option value="deposit">Deposit</option></select></td>
      <td><Input className="num h-8 w-28" inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} onBlur={() => onSave({ feeCents: Math.round(Number(fee) * 100) || 0 })} /></td>
      <td><Input className="num h-8 w-28" inputMode="decimal" value={dep} disabled={p.mode !== "deposit"} onChange={(e) => setDep(e.target.value)} onBlur={() => onSave({ depositCents: Math.round(Number(dep) * 100) || 0 })} /></td>
    </tr>
  );
}

function LocalDataPanel() {
  const [stats, setStats] = useState<{ threads: number; lists: number; bytes?: number } | null>(null);
  useEffect(() => { let live = true; void mailStore.stats().then((s) => { if (live) setStats(s); }); return () => { live = false; }; }, []);
  return (
    <Panel title="Local copy on this device" blurb="Mail you have viewed is kept in this browser so folders, messages and search open instantly. It never leaves your device and is cleared when you sign out." dense actions={<Button size="xs" variant="outline" onClick={async () => { await mailStore.clear(); setStats(await mailStore.stats()); toast.success("Local copy cleared"); }}>Clear local data</Button>}>
      <Facts items={[["Conversations stored", stats ? String(stats.threads) : "…"], ["Folder views stored", stats ? String(stats.lists) : "…"], ["Space used", stats?.bytes !== undefined ? bytes(stats.bytes) : "—"]]} />
    </Panel>
  );
}

function IntakeFormSetting({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const templates = useLive(api.bookings.formTemplates, {});
  return (
    <div className="mt-4 text-sm">
      <label className="flex flex-wrap items-center gap-2">Intake form for online bookings
        <select className="h-8 rounded-lg border border-input bg-card px-2 text-sm" value={value} onChange={(e) => onChange(e.target.value)}><option value="">None</option>{(templates.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
      </label>
      <p className="mt-1 text-xs text-fg-tertiary">After a paid online booking, this Cliniko form is created against the appointment and its link is emailed from the practice mailbox.</p>
    </div>
  );
}

function ClinikoUsersPanel() {
  const users = useLive(api.bookings.clinikoUsers, {});
  return (
    <Panel title="Cliniko users" blurb="Who exists in Cliniko, and whose permissions the API key carries." dense>
      {users.error ? <p className="text-sm text-error">{users.error}</p> : !users.data ? <Loading rows={2} /> : (
        <ul className="divide-y divide-border/70 text-sm">
          {users.data.users.map((u) => <li key={u.id} className="flex items-center gap-2 py-1.5"><span className="font-medium">{u.name}</span><span className="text-xs text-fg-tertiary">{u.email}{u.role ? ` · ${u.role}` : ""}</span>{!u.active && <Pill>inactive</Pill>}{users.data!.apiKeyOwner === u.name && <Pill tone="info">API key owner</Pill>}</li>)}
        </ul>
      )}
    </Panel>
  );
}

/* ------------------------------ stripe ------------------------------ */

function StripeTab() {
  const status = useQuery(api.settings.setupStatus);
  const money = useQuery(api.money.table);
  const backfill = useAction(api.stripe.backfill);
  const [busy, setBusy] = useState(false);
  if (!status) return <Loading />;
  const site = process.env.NEXT_PUBLIC_CONVEX_URL?.replace(".convex.cloud", ".convex.site");
  return (
    <Panel title="Stripe" blurb="Online bookings pay through Stripe Checkout; report invoices are Stripe invoices raised against a matter." actions={status.stripe && <Button size="sm" variant="outline" disabled={busy} onClick={async () => { setBusy(true); try { const r = await backfill({}); toast.success(`Imported ${r.count} invoices and payments from the last 90 days`); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } }}>{busy ? "Importing…" : "Import last 90 days"}</Button>}>
      <Facts items={[["Secret key", <Pill key="k" tone={status.stripe ? "good" : "warn"}>{status.stripe ? "set" : "missing"}</Pill>], ["Webhook secret", <Pill key="w" tone={status.stripeWebhook ? "good" : "warn"}>{status.stripeWebhook ? "set" : "missing"}</Pill>], ["Webhook endpoint", <code key="e" className="rounded bg-muted px-1 text-xs">{site}/stripe/webhook</code>], ["Invoices mirrored", money ? String(money.rows.length) : "…"], ["Outstanding", money ? aud(money.counts.outstandingCents) : "…"]]} />
    </Panel>
  );
}

/* ------------------------------ signatures ------------------------------ */

function SignaturesTab() {
  const sigs = useQuery(api.signaturesEmail.mine);
  const save = useMutation(api.signaturesEmail.save);
  const remove = useMutation(api.signaturesEmail.remove);
  const me = useQuery(api.users.me);
  const updatePrefs = useMutation(api.users.updatePrefs);
  const [editing, setEditing] = useState<{ id?: Id<"signatures">; name: string; html: string; isDefaultNew: boolean; isDefaultReply: boolean } | null>(null);
  if (sigs === undefined) return <Loading />;
  return (
    <div className="space-y-4">
      <Panel title="Email signatures" blurb="HTML is fine. The default for new mail and for replies can differ." actions={<Button size="sm" onClick={() => setEditing({ name: "", html: `<p>${me?.name ?? ""}<br>Barbara Fraser &amp; Associates</p>`, isDefaultNew: sigs.length === 0, isDefaultReply: sigs.length === 0 })}>New signature</Button>}>
        {sigs.length === 0 && !editing ? <Empty title="No signatures yet" body="Add one and it is inserted when you compose." /> : (
          <ul className="divide-y divide-border/70">
            {sigs.map((s) => (
              <li key={s._id} className="flex items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">{s.name}{s.isDefaultNew && <Pill tone="info">new mail</Pill>}{s.isDefaultReply && <Pill tone="info">replies</Pill>}</div>
                  <div className="prose prose-sm mt-1 max-w-none text-xs text-fg-secondary [&_p]:m-0" dangerouslySetInnerHTML={{ __html: s.html }} />
                </div>
                <Button size="xs" variant="ghost" onClick={() => setEditing({ id: s._id, name: s.name, html: s.html, isDefaultNew: s.isDefaultNew, isDefaultReply: s.isDefaultReply })}>Edit</Button>
                <Button size="xs" variant="ghost" onClick={() => remove({ id: s._id })}>Delete</Button>
              </li>
            ))}
          </ul>
        )}
        {editing && (
          <form className="mt-4 space-y-3 rounded-xl bg-muted/50 p-4" onSubmit={async (e) => { e.preventDefault(); try { await save(editing); setEditing(null); toast.success("Signature saved"); } catch (err) { toast.error(errorMessage(err)); } }}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor="sig-name">Name</Label><Input id="sig-name" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Standard" required /></div>
              <div className="flex items-end gap-4 text-sm"><label className="flex items-center gap-2"><Switch checked={editing.isDefaultNew} onCheckedChange={(v) => setEditing({ ...editing, isDefaultNew: v })} />Default for new</label><label className="flex items-center gap-2"><Switch checked={editing.isDefaultReply} onCheckedChange={(v) => setEditing({ ...editing, isDefaultReply: v })} />Default for replies</label></div>
            </div>
            <div><Label htmlFor="sig-html">HTML</Label><Textarea id="sig-html" rows={6} className="font-mono text-xs" value={editing.html} onChange={(e) => setEditing({ ...editing, html: e.target.value })} /></div>
            <div className="rounded-lg bg-card p-3 text-sm ring-1 ring-border" dangerouslySetInnerHTML={{ __html: editing.html }} />
            <div className="flex gap-2"><Button type="submit">Save</Button><Button type="button" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button></div>
          </form>
        )}
      </Panel>
      <Panel title="Placement" dense>
        <label className="flex items-center gap-3 text-sm"><Switch checked={me?.prefs.signatureAbove ?? true} onCheckedChange={(v) => updatePrefs({ prefs: { signatureAbove: v } })} />Put my signature above the quoted message when replying</label>
      </Panel>
    </div>
  );
}

/* ------------------------------ tags ------------------------------ */

function TagsTab() {
  const tags = useQuery(api.tags.list);
  const save = useMutation(api.tags.save);
  const remove = useMutation(api.tags.remove);
  const [draft, setDraft] = useState<{ id?: Id<"tags">; name: string; color: (typeof TONES)[number]; aiHint: string } | null>(null);
  if (tags === undefined) return <Loading />;
  const seed = async () => { for (const [name, color, aiHint] of [["Family Report", "blue", "Family Court reports, family assessments, s62G or 11F reports"], ["Medicare Rebate", "green", "Medicare rebates, item numbers, mental health care plans, receipts for rebate"], ["Subpoena", "red", "Subpoenas, court orders, requests for records from a court or solicitor"], ["Solicitor", "purple", "Correspondence from lawyers, solicitors, barristers, legal aid"], ["Booking", "amber", "Appointment requests, reschedules, cancellations"]] as const) await save({ name, color, aiHint }); toast.success("Starter tags added"); };
  return (
    <Panel title="Organisation tags" blurb="Both of you see the same tags on mail and tasks. The hint tells Claude when to suggest one." actions={<div className="flex gap-2">{tags.length === 0 && <Button size="sm" variant="outline" onClick={seed}>Add starter tags</Button>}<Button size="sm" onClick={() => setDraft({ name: "", color: "blue", aiHint: "" })}>New tag</Button></div>}>
      {tags.length === 0 && !draft ? <Empty title="No tags yet" body="Try the starter set: Family Report, Medicare Rebate, Subpoena, Solicitor, Booking." /> : (
        <ul className="divide-y divide-border/70">
          {tags.map((t) => (
            <li key={t._id} className="flex items-center gap-3 py-2.5">
              <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium", TONE_CLASS[t.color])}><span className={cn("size-1.5 rounded-full", TONE_DOT[t.color])} />{t.name}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-fg-tertiary">{t.aiHint || "No hint"}</span>
              <Button size="xs" variant="ghost" onClick={() => setDraft({ id: t._id, name: t.name, color: t.color, aiHint: t.aiHint ?? "" })}>Edit</Button>
              <Button size="xs" variant="ghost" onClick={() => { if (confirm(`Delete “${t.name}” from every thread and task?`)) void remove({ id: t._id }); }}>Delete</Button>
            </li>
          ))}
        </ul>
      )}
      {draft && (
        <form className="mt-4 grid gap-3 rounded-xl bg-muted/50 p-4 sm:grid-cols-[1fr_auto_2fr_auto]" onSubmit={async (e) => { e.preventDefault(); try { await save({ id: draft.id, name: draft.name, color: draft.color, aiHint: draft.aiHint || undefined }); setDraft(null); } catch (err) { toast.error(errorMessage(err)); } }}>
          <Input placeholder="Tag name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required autoFocus />
          <div className="flex items-center gap-1">{TONES.map((c) => <button key={c} type="button" aria-label={c} onClick={() => setDraft({ ...draft, color: c })} className={cn("size-6 rounded-full ring-offset-2 ring-offset-background", TONE_DOT[c], draft.color === c && "ring-2 ring-foreground")} />)}</div>
          <Input placeholder="When should Claude suggest this? e.g. Medicare rebates, item numbers" value={draft.aiHint} onChange={(e) => setDraft({ ...draft, aiHint: e.target.value })} />
          <div className="flex gap-1"><Button type="submit" size="sm">Save</Button><Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button></div>
        </form>
      )}
    </Panel>
  );
}

/* ------------------------------ practice + preferences ------------------------------ */

function PracticeTab() {
  const settings = useQuery(api.settings.all);
  const set = useMutation(api.settings.set);
  const me = useQuery(api.users.me);
  const updatePrefs = useMutation(api.users.updatePrefs);
  const [name, setName] = useState<string | null>(null);
  const [slug, setSlug] = useState<string | null>(null);
  if (!settings || !me) return <Loading />;
  const hours = (settings["practice.hours"] as { start?: number; end?: number; days?: number[]; tz?: string } | undefined) ?? { start: 9, end: 17, days: [1, 2, 3, 4, 5], tz: "Australia/Melbourne" };
  const site = siteUrl();
  return (
    <div className="space-y-4">
      <Panel title="Practice" dense>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label htmlFor="pname">Name shown to clients</Label><Input id="pname" value={name ?? (settings["practice.name"] as string | undefined) ?? "Barbara Fraser & Associates"} onChange={(e) => setName(e.target.value)} onBlur={() => name !== null && set({ key: "practice.name", value: name })} /></div>
          <div><Label htmlFor="pslug">Booking page</Label><div className="flex items-center gap-1 text-sm text-fg-tertiary">{site}/book/<Input id="pslug" className="w-44" value={slug ?? (settings["booking.slug"] as string | undefined) ?? "barbara-fraser"} onChange={(e) => setSlug(e.target.value.replace(/[^a-z0-9-]/gi, "-").toLowerCase())} onBlur={() => slug !== null && set({ key: "booking.slug", value: slug })} /></div></div>
        </div>
      </Panel>
      <Panel title="Business hours" blurb="Used by auto-reply rules that only fire out of hours, and by the booking page." dense>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">From<select className="h-8 rounded-lg border border-input bg-card px-2" value={hours.start ?? 9} onChange={(e) => set({ key: "practice.hours", value: { ...hours, start: Number(e.target.value) } })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h}:00</option>)}</select></label>
          <label className="flex items-center gap-2">To<select className="h-8 rounded-lg border border-input bg-card px-2" value={hours.end ?? 17} onChange={(e) => set({ key: "practice.hours", value: { ...hours, end: Number(e.target.value) } })}>{Array.from({ length: 24 }, (_, h) => <option key={h} value={h + 1}>{h + 1}:00</option>)}</select></label>
          <div className="flex gap-1">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => { const on = (hours.days ?? []).includes(i); return <button key={d} type="button" onClick={() => set({ key: "practice.hours", value: { ...hours, days: on ? (hours.days ?? []).filter((x) => x !== i) : [...(hours.days ?? []), i].sort() } })} className={cn("h-8 rounded-lg px-2.5 text-xs font-medium", on ? "bg-foreground text-background" : "bg-muted text-fg-tertiary")}>{d}</button>; })}</div>
        </div>
      </Panel>
      <LocalDataPanel />
      <Panel title="Your preferences" dense>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">Overdue after<div className="mt-1 flex items-center gap-2"><Input type="number" min={1} max={240} className="num w-24" defaultValue={me.prefs.overdueHours ?? 48} onBlur={(e) => updatePrefs({ prefs: { overdueHours: Math.max(1, Number(e.target.value) || 48) } })} /><span className="text-fg-tertiary">hours without a reply from either of you</span></div></label>
          <label className="flex items-center gap-3 text-sm"><Switch checked={me.prefs.showImages ?? false} onCheckedChange={(v) => updatePrefs({ prefs: { showImages: v } })} />Always show remote images in mail</label>
        </div>
      </Panel>
    </div>
  );
}
