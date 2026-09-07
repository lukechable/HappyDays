"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Kpi, PageHeader, Panel, Pill, statusTone, Empty, Loading, ErrorBox } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { aud, dueLabel, mailDate, time, weekday } from "@/lib/format";
import { useLive, useNow } from "@/lib/hooks";

type Appt = { id: string; startsAt: string; endsAt: string; patientName: string; typeName: string; color?: string; cancelledAt: string | null; didNotArrive: boolean; practitionerName: string; clinikoUrl: string; patientId?: string; telehealthUrl?: string };
type OverdueItem = { gmailThreadId: string; subject: string; senders: Array<{ name: string }>; lastAt: number };

/** Today at a glance: appointments from Cliniko, overdue mail, tasks due, and the money table's two red flags. */
export function Dashboard() {
  const me = useQuery(api.users.me);
  const tasks = useQuery(api.tasks.list, { view: "week" });
  const money = useQuery(api.money.table);
  const matters = useQuery(api.matters.list, {});
  const setup = useQuery(api.settings.setupStatus);
  const now = useNow();
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
  const live = useLive(api.bookings.calendar, setup?.cliniko ? { fromIso: dayStart.toISOString(), toIso: dayEnd.toISOString() } : "skip");
  const appts: Appt[] | null | undefined = !setup ? undefined : !setup.cliniko || live.error ? null : live.data?.appointments;
  const apptError = live.error ?? null;
  const overdueLive = useLive(api.mail.listThreads, me?.google?.status === "connected" ? { view: "overdue" } : "skip");
  const overdue: OverdueItem[] | undefined = me === undefined ? undefined : !me?.google || me.google.status !== "connected" ? [] : overdueLive.error ? [] : overdueLive.data?.items.slice(0, 6);

  const today = new Date(now);
  const dueToday = (tasks ?? []).filter((t) => t.dueAt !== undefined && new Date(t.dueAt).toDateString() === today.toDateString());
  const overdueTasks = (tasks ?? []).filter((t) => t.dueAt !== undefined && t.dueAt < now && t.status !== "done");
  const reportDue = (matters ?? []).filter((m) => m.status === "report_due");

  return (
    <div className="space-y-5">
      <PageHeader title={greeting(me?.first, now)} blurb={today.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })} actions={<Button variant="outline" render={<Link href="/mail?view=overdue" />}>Overdue mail</Button>} />

      {me && !me.google && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-warning-soft px-4 py-3 text-sm">
          <span><b className="font-semibold">Gmail isn’t connected yet.</b> Mail, replied pills and overdue tracking start once you connect.</span>
          <Button size="sm" render={<Link href="/settings" />}>Connect Google</Button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Kpi label="Appointments today" value={appts === undefined ? "…" : appts === null ? "—" : appts.filter((a) => !a.cancelledAt).length} sub={appts === null ? (apptError ? "Cliniko error" : "Cliniko not connected") : "from Cliniko"} href="/bookings" />
        <Kpi label="Overdue mail" value={me?.badges.overdue ?? 0} tone={(me?.badges.overdue ?? 0) > 0 ? "bad" : undefined} sub="both of you on it, nobody replied" href="/mail?view=overdue" />
        <Kpi label="Tasks due today" value={dueToday.length} tone={overdueTasks.length ? "warn" : undefined} sub={overdueTasks.length ? `${overdueTasks.length} overdue` : "nothing overdue"} href="/tasks?view=today" />
        <Kpi label="Paid, report not delivered" value={money?.counts.paidNotDelivered ?? 0} tone={(money?.counts.paidNotDelivered ?? 0) > 0 ? "warn" : undefined} sub={money ? `${aud(money.counts.outstandingCents, { whole: true })} outstanding` : "…"} href="/money" />
      </div>

      <div className="grid gap-3 lg:grid-cols-[3fr_2fr]">
        <Panel title="Today's appointments" blurb="Live from Cliniko. Click one to open it there." actions={<Button variant="ghost" size="sm" render={<Link href="/bookings" />}>Calendar</Button>}>
          {appts === undefined ? <Loading rows={3} /> : apptError ? <ErrorBox title="Couldn't reach Cliniko" message={apptError} /> : appts === null ? <Empty title="Cliniko isn’t connected" body="Add the API key in Settings and today's list appears here." action={<Button size="sm" variant="outline" render={<Link href="/settings#cliniko" />}>Settings</Button>} /> : appts.length === 0 ? <Empty title="No appointments today" /> : (
            <ul className="divide-y divide-border/70">
              {appts.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-1.5">
                  <span className="num w-[52px] shrink-0 text-sm text-fg-secondary">{time(a.startsAt)}</span>
                  <span className="size-2.5 shrink-0 rounded-full" style={{ background: a.color ?? "#0081f2" }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2"><Link href={a.patientId ? `/bookings/patients/${a.patientId}` : "/bookings"} className="truncate text-sm font-medium hover:underline">{a.patientName}</Link>{a.cancelledAt && <Pill tone="bad">cancelled</Pill>}{a.didNotArrive && <Pill tone="warn">did not arrive</Pill>}{a.telehealthUrl && <Pill tone="info">telehealth</Pill>}</div>
                    <div className="truncate text-xs text-fg-tertiary">{a.typeName} · {a.practitionerName}</div>
                  </div>
                  <a href={a.clinikoUrl} target="_blank" rel="noreferrer" className="text-xs text-fg-tertiary hover:text-foreground">Cliniko ↗</a>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="space-y-3">
          <Panel title="Overdue mail" blurb="Threads both of you were on, last message inbound, no reply." dense>
            {overdue === undefined ? <Loading rows={2} /> : overdue.length === 0 ? <p className="py-3 text-center text-sm text-fg-tertiary">Nothing overdue.</p> : (
              <ul className="divide-y divide-border/70">
                {overdue.map((t) => (
                  <li key={t.gmailThreadId}><Link href={`/mail?view=overdue&thread=${t.gmailThreadId}`} className="flex items-baseline gap-2 py-2 hover:underline"><span className="min-w-0 flex-1 truncate text-sm">{t.subject}</span><span className="shrink-0 text-xs text-fg-tertiary">{t.senders[0]?.name}</span><span className="num shrink-0 text-[11px] text-fg-quaternary">{mailDate(t.lastAt)}</span></Link></li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Tasks this week" dense actions={<Button variant="ghost" size="sm" render={<Link href="/tasks?view=week" />}>All</Button>}>
            {tasks === undefined ? <Loading rows={2} /> : tasks.length === 0 ? <p className="py-3 text-center text-sm text-fg-tertiary">Nothing due this week.</p> : (
              <ul className="divide-y divide-border/70">
                {tasks.slice(0, 6).map((t) => (
                  <li key={t._id}><Link href={`/tasks?task=${t._id}`} className="flex items-center gap-2 py-2"><span className={`size-1.5 shrink-0 rounded-full ${t.priority === "high" ? "bg-error" : t.priority === "medium" ? "bg-warning" : "bg-fg-quaternary"}`} /><span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>{t.assignee && <span className="text-xs text-fg-tertiary">{t.assignee}</span>}<span className={`shrink-0 text-[11px] ${t.dueAt && t.dueAt < now ? "text-error" : "text-fg-quaternary"}`}>{dueLabel(t.dueAt)}</span></Link></li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title="Reports due" dense actions={<Button variant="ghost" size="sm" render={<Link href="/matters" />}>Matters</Button>}>
            {matters === undefined ? <Loading rows={2} /> : reportDue.length === 0 ? <p className="py-3 text-center text-sm text-fg-tertiary">No matters waiting on a report.</p> : (
              <ul className="divide-y divide-border/70">
                {reportDue.slice(0, 5).map((m) => (
                  <li key={m._id}><Link href={`/matters/${m._id}`} className="flex items-center gap-2 py-2"><span className="min-w-0 flex-1 truncate text-sm">{m.name}</span><Pill tone={m.paid ? "good" : "warn"}>{m.paid ? "paid" : "unpaid"}</Pill><Pill tone={statusTone(m.status)}>{m.status.replace("_", " ")}</Pill></Link></li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
      <p className="text-xs text-fg-quaternary">{weekday(now)} · Cliniko and Gmail are read live; nothing on this page is stored by Happy Days.</p>
    </div>
  );
}

function greeting(first: string | undefined, now: number) {
  const h = new Date(now).getHours();
  const part = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  return first ? `${part}, ${first}.` : `${part}.`;
}
