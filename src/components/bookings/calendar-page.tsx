"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import { ChevronLeft, ChevronRight, RefreshCw, Plus, X, ExternalLink, Video, Users, Receipt } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Empty, ErrorBox, Pill } from "@/components/primitives";
import { useLive, useNow } from "@/lib/hooks";
import { useCalendarWindow } from "./use-calendar-window";
import { cn, errorMessage } from "@/lib/utils";
import { time } from "@/lib/format";
import { PatientSearch } from "./patient-search";
import { InvoiceDialog } from "./invoice-dialog";

type Appt = { id: string; startsAt: string; endsAt: string; notes?: string; cancelledAt: string | null; didNotArrive: boolean; arrived: boolean; telehealthUrl?: string; patientId?: string; patientName: string; typeId?: string; typeName: string; color?: string; practitionerId?: string; practitionerName: string; clinikoUrl: string; patientUrl?: string };
type Block = { id: string; startsAt: string; endsAt: string; practitionerId?: string; notes?: string };
type Group = { id: string; startsAt: string; endsAt: string; notes?: string; typeName: string; color?: string; practitionerId?: string; practitionerName: string; attendees?: number; maxAttendees?: number; clinikoUrl: string };

const HOUR_PX = 64;
const DAY_START = 7;
const DAY_END = 20;
const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d; };
const startOfWeek = (t: number) => { const d = startOfDay(t); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; };
const CANCEL_REASONS: Array<[number, string]> = [[50, "Other"], [10, "Feeling better"], [20, "Condition worse"], [30, "Sick"], [40, "Away"], [60, "Work"]];

/**
 * The Cliniko calendar, read live. Day and week views with one column per practitioner in day view; drag an
 * appointment to reschedule it in Cliniko, click empty space to book, click an appointment for the details card.
 */
export function CalendarPage() {
  const params = useSearchParams();
  const router = useRouter();
  const now = useNow();
  const mode = (params.get("mode") as "day" | "week" | null) ?? "week";
  const anchor = Number(params.get("d")) || startOfDay(now).getTime();
  const setParams = (next: Record<string, string | undefined>) => { const p = new URLSearchParams(params.toString()); for (const [k, v] of Object.entries(next)) { if (!v) p.delete(k); else p.set(k, v); } router.replace(`/bookings${p.size ? `?${p}` : ""}`, { scroll: false }); };
  const rangeStart = mode === "day" ? startOfDay(anchor) : startOfWeek(anchor);
  const rangeEnd = new Date(rangeStart); rangeEnd.setDate(rangeEnd.getDate() + (mode === "day" ? 1 : 7));
  const setup = useQuery(api.settings.setupStatus);
  const practice = useLive(api.bookings.practice, setup?.cliniko ? {} : "skip");
  const live = useCalendarWindow(setup?.cliniko ? { fromIso: rangeStart.toISOString(), toIso: rangeEnd.toISOString() } : null);
  const reschedule = useAction(api.bookings.rescheduleAppointment);
  const cancel = useAction(api.bookings.cancelAppointment);
  const flags = useAction(api.bookings.updateAppointmentFlags);
  const create = useAction(api.bookings.createAppointment);
  const settings = useQuery(api.settings.all);
  const [selected, setSelected] = useState<Appt | null>(null);
  const [creating, setCreating] = useState<{ startsAt: Date; practitionerId?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [invoicing, setInvoicing] = useState<Appt | null>(null);

  const practitioners = practice.data?.practitioners ?? [];
  const types = practice.data?.appointmentTypes ?? [];
  // Day columns: every practitioner Cliniko lists, plus any who has an appointment in view but isn't listed.
  const dayPractitioners: Array<{ id: string; name: string }> = [...practitioners.map((p) => ({ id: p.id, name: `${p.first_name} ${p.last_name}`.trim() })), ...(live.data?.practitioners ?? []).filter((p) => !practitioners.some((q) => q.id === p.id) && (live.data?.appointments ?? []).some((a) => a.practitionerId === p.id)).map((p) => ({ id: p.id, name: p.name }))];
  const columns: Array<{ key: string; label: string; day: Date; practitionerId?: string }> = mode === "week"
    ? Array.from({ length: 7 }, (_, i) => { const d = new Date(rangeStart); d.setDate(d.getDate() + i); return { key: d.toDateString(), label: d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric" }), day: d }; })
    : (dayPractitioners.length ? dayPractitioners : [{ id: undefined as string | undefined, name: "All" }]).map((p) => ({ key: String(p.id ?? "all"), label: p.name, day: rangeStart, practitionerId: p.id }));

  const inColumn = (a: { startsAt: string; practitionerId?: string }, c: (typeof columns)[number]) => { const d = new Date(a.startsAt); return d.toDateString() === c.day.toDateString() && (mode === "week" || c.practitionerId === undefined || a.practitionerId === c.practitionerId); };
  const yFor = (iso: string) => { const d = new Date(iso); return ((d.getHours() - DAY_START) * 60 + d.getMinutes()) * (HOUR_PX / 60); };
  const hFor = (s: string, e: string) => Math.max(18, ((new Date(e).getTime() - new Date(s).getTime()) / 60_000) * (HOUR_PX / 60));

  const onDrop = async (e: React.DragEvent, col: (typeof columns)[number]) => {
    e.preventDefault();
    const id = e.dataTransfer.getData("appt");
    const a = live.data?.appointments.find((x) => x.id === id);
    if (!a) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const minutes = Math.round(((e.clientY - rect.top) / HOUR_PX) * 60 / 15) * 15;
    const start = new Date(col.day); start.setHours(DAY_START, 0, 0, 0); start.setMinutes(start.getMinutes() + minutes);
    const dur = new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime();
    const end = new Date(start.getTime() + dur);
    if (!confirm(`Move ${a.patientName} to ${start.toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}?`)) return;
    setBusy(true);
    try { await reschedule({ appointmentId: a.id, startsAt: start.toISOString(), endsAt: end.toISOString(), practitionerId: col.practitionerId }); toast.success("Rescheduled in Cliniko"); live.reload(); }
    catch (err) { toast.error(errorMessage(err)); }
    finally { setBusy(false); }
  };
  const onEmptyClick = (e: React.MouseEvent, col: (typeof columns)[number]) => {
    if ((e.target as HTMLElement).closest("[data-appt]")) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const minutes = Math.floor(((e.clientY - rect.top) / HOUR_PX) * 60 / 15) * 15;
    const start = new Date(col.day); start.setHours(DAY_START, 0, 0, 0); start.setMinutes(start.getMinutes() + minutes);
    setCreating({ startsAt: start, practitionerId: col.practitionerId ?? (settings?.["cliniko.practitionerId"] as string | undefined) ?? practitioners[0]?.id });
  };

  if (setup && !setup.cliniko) return <div className="p-8"><Empty title="Cliniko isn’t connected" body="Add CLINIKO_API_KEY on the Convex deployment and the calendar appears here, read live." action={<Button render={<Link href="/settings?tab=cliniko" />}>Settings</Button>} /></div>;

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:h-[calc(100svh-48px)]">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Button size="sm" variant="outline" onClick={() => setParams({ d: String(startOfDay(now).getTime()) })}>Today</Button>
        <div className="flex items-center"><Button size="icon-sm" variant="ghost" aria-label="Previous" onClick={() => { const d = new Date(rangeStart); d.setDate(d.getDate() - (mode === "day" ? 1 : 7)); setParams({ d: String(d.getTime()) }); }}><ChevronLeft className="size-4" /></Button><Button size="icon-sm" variant="ghost" aria-label="Next" onClick={() => { const d = new Date(rangeStart); d.setDate(d.getDate() + (mode === "day" ? 1 : 7)); setParams({ d: String(d.getTime()) }); }}><ChevronRight className="size-4" /></Button></div>
        <h1 className="font-display text-lg">{mode === "day" ? rangeStart.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" }) : `${rangeStart.toLocaleDateString("en-AU", { day: "numeric", month: "short" })} – ${new Date(rangeEnd.getTime() - 1).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}`}</h1>
        <div className="ml-auto flex items-center gap-1 rounded-full bg-muted p-0.5">{(["day", "week"] as const).map((m) => <button key={m} type="button" onClick={() => setParams({ mode: m })} className={cn("h-7 rounded-full px-3 text-xs capitalize", mode === m ? "bg-card shadow-xs" : "text-fg-tertiary hover:text-foreground")}>{m}</button>)}</div>
        <PatientSearch onPick={(p) => router.push(`/bookings/patients/${p.id}`)} />
        <Button size="sm" onClick={() => setCreating({ startsAt: (() => { const d = new Date(now); d.setMinutes(0, 0, 0); d.setHours(d.getHours() + 1); return d; })(), practitionerId: (settings?.["cliniko.practitionerId"] as string | undefined) ?? practitioners[0]?.id })}><Plus className="size-3.5" />Book</Button>
        <Button size="icon-sm" variant="ghost" aria-label="Refresh" title={live.fetchedAt ? `Loaded ${new Date(live.fetchedAt).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}. Checks Cliniko for changes when you come back to a week.` : "Refresh"} onClick={() => live.reload()}><RefreshCw className={cn("size-3.5", (live.loading || live.checking) && "animate-spin")} /></Button>
      </div>

      {live.error ? <div className="p-6"><ErrorBox title="Couldn’t read the Cliniko calendar" message={live.error} retry={live.reload} /></div> : (
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="grid min-w-[760px]" style={{ gridTemplateColumns: `56px repeat(${columns.length}, minmax(0, 1fr))` }}>
            <div className="sticky top-0 z-10 bg-background" />
            {columns.map((c) => <div key={c.key} className={cn("sticky top-0 z-10 border-b border-l border-border bg-background px-2 py-1.5 text-xs font-medium", c.day.toDateString() === new Date(now).toDateString() && mode === "week" && "text-blue")}>{c.label}</div>)}
            <div className="relative" style={{ height: (DAY_END - DAY_START) * HOUR_PX }}>
              {Array.from({ length: DAY_END - DAY_START }, (_, i) => <div key={i} className="num absolute right-2 -translate-y-1/2 text-[10.5px] text-fg-quaternary" style={{ top: i * HOUR_PX }}>{i + DAY_START > 12 ? `${i + DAY_START - 12}pm` : i + DAY_START === 12 ? "12pm" : `${i + DAY_START}am`}</div>)}
            </div>
            {columns.map((c) => {
              const appts = (live.data?.appointments ?? []).filter((a) => inColumn(a, c));
              const avail = (live.data?.availability ?? []).filter((b: Block) => inColumn(b, c));
              const unavail = (live.data?.unavailable ?? []).filter((b: Block) => inColumn(b, c));
              const groups = ((live.data?.groups ?? []) as Group[]).filter((g) => inColumn(g, c));
              const isToday = c.day.toDateString() === new Date(now).toDateString();
              return (
                <div key={c.key} className={cn("relative border-l border-border", busy && "opacity-60")} style={{ height: (DAY_END - DAY_START) * HOUR_PX, backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, var(--border) ${HOUR_PX - 1}px, var(--border) ${HOUR_PX}px)` }} onDragOver={(e) => e.preventDefault()} onDrop={(e) => void onDrop(e, c)} onClick={(e) => onEmptyClick(e, c)}>
                  {avail.map((b) => <div key={`a${b.id}`} className="absolute inset-x-0 bg-success/[0.06]" style={{ top: yFor(b.startsAt), height: hFor(b.startsAt, b.endsAt) }} />)}
                  {unavail.map((b) => <div key={`u${b.id}`} className="absolute inset-x-0 bg-[repeating-linear-gradient(45deg,transparent,transparent_6px,rgba(0,0,0,.05)_6px,rgba(0,0,0,.05)_12px)] px-1 text-[10px] text-fg-tertiary" style={{ top: yFor(b.startsAt), height: hFor(b.startsAt, b.endsAt) }} title={b.notes}>{b.notes}</div>)}
                  {isToday && <div className="absolute inset-x-0 z-[5] h-px bg-error" style={{ top: yFor(new Date(now).toISOString()) }} />}
                  {groups.map((g) => (
                    <a key={`g${g.id}`} data-appt href={g.clinikoUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="absolute inset-x-0.5 overflow-hidden rounded-md border-2 border-dashed px-1.5 py-0.5 text-left text-[11px] leading-tight" style={{ top: yFor(g.startsAt), height: hFor(g.startsAt, g.endsAt), borderColor: g.color ?? "#0081f2", background: `${g.color ?? "#0081f2"}22`, color: "var(--foreground)" }} title={g.notes}>
                      <div className="flex items-center gap-1 font-semibold"><Users className="size-3" />{g.typeName}</div>
                      <div className="opacity-80">{time(g.startsAt)} · {g.attendees ?? "?"}{g.maxAttendees ? `/${g.maxAttendees}` : ""} attending</div>
                    </a>
                  ))}
                  {appts.map((a) => (
                    <button key={a.id} type="button" data-appt draggable={!a.cancelledAt} onDragStart={(e) => e.dataTransfer.setData("appt", a.id)} onClick={(e) => { e.stopPropagation(); setSelected(a); }} className={cn("absolute inset-x-0.5 overflow-hidden rounded-md px-1.5 py-0.5 text-left text-[11px] leading-tight text-white shadow-xs ring-1 ring-black/10", a.cancelledAt && "opacity-40 line-through", a.didNotArrive && "ring-2 ring-error")} style={{ top: yFor(a.startsAt), height: hFor(a.startsAt, a.endsAt), background: a.color ?? "#0081f2" }}>
                      <div className="truncate font-semibold">{a.patientName}</div>
                      <div className="truncate opacity-90">{time(a.startsAt)} · {a.typeName}</div>
                      {mode === "week" && practitioners.length > 1 && <div className="truncate opacity-75">{a.practitionerName}</div>}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {selected && (
        <div className="fixed inset-x-0 bottom-0 z-40 sm:inset-auto sm:right-6 sm:top-20 sm:w-[380px]">
          <div className="rounded-t-2xl bg-card p-4 shadow-float ring-1 ring-black/10 dark:ring-white/10 sm:rounded-2xl">
            <div className="flex items-start gap-2">
              <span className="mt-1 size-3 shrink-0 rounded-full" style={{ background: selected.color ?? "#0081f2" }} />
              <div className="min-w-0 flex-1"><div className="font-display text-lg leading-tight">{selected.patientName}</div><div className="text-sm text-fg-secondary">{selected.typeName} · {selected.practitionerName}</div><div className="num text-sm">{new Date(selected.startsAt).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "short" })}, {time(selected.startsAt)}–{time(selected.endsAt)}</div></div>
              <button type="button" onClick={() => setSelected(null)} className="rounded p-1 hover:bg-muted" aria-label="Close"><X className="size-4" /></button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1">{selected.cancelledAt && <Pill tone="bad">cancelled</Pill>}{selected.didNotArrive && <Pill tone="warn">did not arrive</Pill>}{selected.arrived && <Pill tone="good">arrived</Pill>}{selected.telehealthUrl && <a href={selected.telehealthUrl} target="_blank" rel="noreferrer"><Pill tone="info"><Video className="size-3" />telehealth</Pill></a>}</div>
            {selected.notes && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-muted px-2.5 py-1.5 text-xs">{selected.notes}</p>}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {selected.patientId && <Button size="sm" variant="outline" render={<Link href={`/bookings/patients/${selected.patientId}`} />}>Patient</Button>}
              <Button size="sm" variant="outline" render={<a href={selected.clinikoUrl} target="_blank" rel="noreferrer" />}><ExternalLink className="size-3.5" />Cliniko</Button>
              {selected.patientId && <Button size="sm" variant="outline" onClick={() => setInvoicing(selected)}><Receipt className="size-3.5" />Invoice in Cliniko</Button>}
              {!selected.cancelledAt && <>
                <Button size="sm" variant="outline" onClick={async () => { try { await flags({ appointmentId: selected.id, arrived: !selected.arrived }); live.reload(); setSelected({ ...selected, arrived: !selected.arrived }); } catch (e) { toast.error(errorMessage(e)); } }}>{selected.arrived ? "Undo arrived" : "Arrived"}</Button>
                <Button size="sm" variant="outline" onClick={async () => { try { await flags({ appointmentId: selected.id, didNotArrive: !selected.didNotArrive }); live.reload(); setSelected({ ...selected, didNotArrive: !selected.didNotArrive }); } catch (e) { toast.error(errorMessage(e)); } }}>{selected.didNotArrive ? "Undo DNA" : "Did not arrive"}</Button>
                <Button size="sm" variant="destructive" onClick={async () => { const r = prompt(`Cancel ${selected.patientName}'s appointment?\nReason number: ${CANCEL_REASONS.map(([n, l]) => `${n}=${l}`).join(", ")}`, "50"); if (r === null) return; const reason = Number(r) || 50; const note = prompt("Cancellation note (optional)") ?? undefined; try { await cancel({ appointmentId: selected.id, reason, note }); toast.success("Cancelled in Cliniko"); setSelected(null); live.reload(); } catch (e) { toast.error(errorMessage(e)); } }}>Cancel</Button>
              </>}
            </div>
            <p className="mt-3 text-[11px] text-fg-quaternary">Drag the appointment on the calendar to reschedule.</p>
          </div>
        </div>
      )}

      {invoicing && invoicing.patientId && <InvoiceDialog patientId={invoicing.patientId} patientName={invoicing.patientName} businessId={(settings?.["cliniko.businessId"] as string | undefined) ?? practice.data?.businesses[0]?.id ?? ""} practitionerId={invoicing.practitionerId ?? pracDefault(settings, practitioners)} appointmentId={invoicing.id} typeName={invoicing.typeName} onClose={() => setInvoicing(null)} />}
      {creating && (
        <NewAppointment start={creating.startsAt} practitionerId={creating.practitionerId} practitioners={practitioners} types={types} businessId={(settings?.["cliniko.businessId"] as string | undefined) ?? practice.data?.businesses[0]?.id} onClose={() => setCreating(null)} onCreate={async (a) => { try { await create(a); toast.success("Booked in Cliniko"); setCreating(null); live.reload(); } catch (e) { toast.error(errorMessage(e)); } }} />
      )}
    </div>
  );
}

const pracDefault = (settings: Record<string, unknown> | undefined, practitioners: Array<{ id: string }>) => (settings?.["cliniko.practitionerId"] as string | undefined) ?? practitioners[0]?.id ?? "";

function NewAppointment({ start, practitionerId, practitioners, types, businessId, onClose, onCreate }: { start: Date; practitionerId?: string; practitioners: Array<{ id: string; first_name: string; last_name: string }>; types: Array<{ id: string; name: string; duration_in_minutes: number }>; businessId?: string; onClose: () => void; onCreate: (a: { patientId: string; practitionerId: string; businessId: string; appointmentTypeId: string; startsAt: string; endsAt: string; notes?: string }) => Promise<void> }) {
  const [patient, setPatient] = useState<{ id: string; name: string } | null>(null);
  const [typeId, setTypeId] = useState<string>(types[0]?.id ?? "");
  const [pracId, setPracId] = useState<string>(practitionerId ?? practitioners[0]?.id ?? "");
  const [when, setWhen] = useState(() => { const pad = (n: number) => String(n).padStart(2, "0"); return `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}T${pad(start.getHours())}:${pad(start.getMinutes())}`; });
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const type = types.find((t) => t.id === typeId);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <form className="w-full max-w-md space-y-3 rounded-2xl bg-card p-5 shadow-float" onClick={(e) => e.stopPropagation()} onSubmit={async (e) => { e.preventDefault(); if (!patient || !type || !businessId) { toast.error("Pick a patient and an appointment type."); return; } setBusy(true); const s = new Date(when); const en = new Date(s.getTime() + type.duration_in_minutes * 60_000); await onCreate({ patientId: patient.id, practitionerId: pracId, businessId, appointmentTypeId: type.id, startsAt: s.toISOString(), endsAt: en.toISOString(), notes: notes || undefined }); setBusy(false); }}>
        <h2 className="font-display text-xl">New appointment</h2>
        <div><span className="text-xs text-fg-tertiary">Patient</span>{patient ? <div className="flex items-center gap-2 text-sm"><span className="font-medium">{patient.name}</span><button type="button" onClick={() => setPatient(null)} className="text-xs underline">change</button></div> : <PatientSearch onPick={(p) => setPatient({ id: p.id, name: p.name })} inline />}</div>
        <label className="block text-xs text-fg-tertiary">Appointment type<select value={typeId} onChange={(e) => setTypeId(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-input bg-card px-2 text-sm text-foreground">{types.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.duration_in_minutes} min)</option>)}</select></label>
        <label className="block text-xs text-fg-tertiary">Practitioner<select value={pracId} onChange={(e) => setPracId(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-input bg-card px-2 text-sm text-foreground">{practitioners.map((p) => <option key={p.id} value={p.id}>{p.first_name} {p.last_name}</option>)}</select></label>
        <label className="block text-xs text-fg-tertiary">Starts<input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} className="mt-1 h-9 w-full rounded-lg border border-input bg-card px-2 text-sm text-foreground" /></label>
        <label className="block text-xs text-fg-tertiary">Notes<textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-input bg-card px-2 py-1 text-sm text-foreground" /></label>
        <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? "Booking…" : "Book in Cliniko"}</Button><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button></div>
      </form>
    </div>
  );
}
