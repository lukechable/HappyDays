"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAction } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { ChevronLeft, ChevronRight, Check } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useLive, useNow } from "@/lib/hooks";
import { aud, time } from "@/lib/format";
import { cn, errorMessage } from "@/lib/utils";

type TypeOpt = { id: string; name: string; description?: string; durationMinutes: number; telehealth: boolean; feeCents: number; mode: "full" | "deposit" | "none"; payNowCents: number };
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Public booking page. Four steps: appointment type, practitioner, time (from Cliniko's Available Times), details.
 * Payment goes through Stripe Checkout and the appointment is only created in Cliniko once Stripe confirms.
 */
export function PublicBooking() {
  const practice = useQuery(api.settings.publicPractice);
  const options = useLive(api.bookings.publicOptions, {});
  const start = useAction(api.bookings.startPublicBooking);
  const params = useSearchParams();
  const now = useNow();
  const [typeId, setTypeId] = useState<string | null>(null);
  const [pracId, setPracId] = useState<string | null>(null);
  const [weekStart, setWeekStart] = useState(() => { const d = new Date(now); d.setHours(0, 0, 0, 0); return d; });
  const [slot, setSlot] = useState<string | null>(null);
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", phone: "", dob: "", notes: "", agree: false });
  const [busy, setBusy] = useState(false);
  const business = options.data?.business ?? null;
  const type: TypeOpt | undefined = options.data?.appointmentTypes.find((t) => t.id === typeId);
  const weekEnd = useMemo(() => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); return d; }, [weekStart]);
  const availability = useLive(api.bookings.publicAvailability, business && pracId && typeId ? { businessId: business.id, practitionerId: pracId, appointmentTypeId: typeId, from: iso(weekStart), to: iso(weekEnd) } : "skip");
  const byDay = useMemo(() => { const m = new Map<string, string[]>(); for (const s of availability.data ?? []) { const k = new Date(s).toDateString(); m.set(k, [...(m.get(k) ?? []), s]); } return m; }, [availability.data]);
  const step = !typeId ? 1 : !pracId ? 2 : !slot ? 3 : 4;
  const submit = async () => {
    if (!business || !type || !pracId || !slot) return;
    if (!form.agree) { toast.error("Please accept the cancellation policy."); return; }
    setBusy(true);
    try { const r = await start({ businessId: business.id, practitionerId: pracId, appointmentTypeId: type.id, startsAt: slot, patient: { firstName: form.firstName.trim(), lastName: form.lastName.trim(), email: form.email.trim(), phone: form.phone.trim() || undefined, dob: form.dob || undefined, notes: form.notes.trim() || undefined }, origin: window.location.origin }); window.location.assign(r.url); }
    catch (e) { toast.error(errorMessage(e)); setBusy(false); }
  };

  return (
    <main className="min-h-svh bg-background">
      <header className="border-b border-border bg-card"><div className="mx-auto flex max-w-3xl items-baseline justify-between px-6 py-4"><span className="font-display text-xl">{practice?.name ?? "Barbara Fraser & Associates"}</span><span className="text-xs text-fg-tertiary">Online booking</span></div></header>
      <div className="mx-auto max-w-3xl px-6 py-8">
        {params.get("cancelled") && <p className="mb-4 rounded-xl bg-warning-soft px-4 py-2 text-sm">Payment was cancelled, so nothing was booked. Pick a time to try again.</p>}
        <ol className="mb-6 flex flex-wrap gap-2 text-xs">{["Appointment", "Practitioner", "Time", "Your details"].map((l, i) => <li key={l} className={cn("flex items-center gap-1.5 rounded-full px-2.5 py-1", step === i + 1 ? "bg-foreground text-background" : step > i + 1 ? "bg-success-soft text-success" : "bg-muted text-fg-tertiary")}>{step > i + 1 ? <Check className="size-3" /> : <span className="num">{i + 1}</span>}{l}</li>)}</ol>

        {options.error ? <p className="text-sm text-error">{options.error}</p> : !options.data ? <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />)}</div> : options.data.appointmentTypes.length === 0 ? <p className="text-sm text-fg-tertiary">Online booking isn’t open at the moment. Please call the practice.</p> : (
          <>
            {step === 1 && <ul className="grid gap-3 sm:grid-cols-2">{options.data.appointmentTypes.map((t) => <li key={t.id}><button type="button" onClick={() => { setTypeId(t.id); if (options.data!.practitioners.length === 1) setPracId(options.data!.practitioners[0].id); }} className="hd-lift w-full rounded-2xl bg-card p-4 text-left shadow-xs ring-1 ring-black/[0.06] dark:ring-white/10"><div className="font-display text-lg">{t.name}</div><div className="mt-1 text-sm text-fg-secondary">{t.durationMinutes} minutes{t.telehealth ? " · telehealth available" : ""}</div>{t.description && <p className="mt-2 text-sm text-fg-tertiary">{t.description}</p>}<div className="num mt-3 text-sm"><b>{aud(t.payNowCents)}</b> {t.mode === "deposit" ? `deposit now, ${aud(t.feeCents)} total` : "paid now"}</div></button></li>)}</ul>}
            {step === 2 && <div><Back onClick={() => setTypeId(null)} /><ul className="grid gap-3 sm:grid-cols-2">{options.data.practitioners.map((p) => <li key={p.id}><button type="button" onClick={() => setPracId(p.id)} className="hd-lift w-full rounded-2xl bg-card p-4 text-left shadow-xs ring-1 ring-black/[0.06] dark:ring-white/10"><div className="font-display text-lg">{p.name}</div>{p.designation && <div className="text-sm text-fg-secondary">{p.designation}</div>}{p.description && <p className="mt-2 text-sm text-fg-tertiary">{p.description}</p>}</button></li>)}</ul></div>}
            {step === 3 && (
              <div>
                <Back onClick={() => setPracId(null)} />
                <div className="mb-3 flex items-center gap-2"><Button size="icon-sm" variant="outline" aria-label="Previous week" disabled={weekStart.getTime() <= new Date(now).setHours(0, 0, 0, 0)} onClick={() => setWeekStart((d) => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; })}><ChevronLeft className="size-4" /></Button><span className="text-sm font-medium">{weekStart.toLocaleDateString("en-AU", { day: "numeric", month: "short" })} – {new Date(weekEnd.getTime() - 1).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}</span><Button size="icon-sm" variant="outline" aria-label="Next week" onClick={() => setWeekStart((d) => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; })}><ChevronRight className="size-4" /></Button>{availability.loading && <span className="text-xs text-fg-tertiary">Checking availability…</span>}</div>
                {availability.error ? <p className="text-sm text-error">{availability.error}</p> : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                    {Array.from({ length: 7 }, (_, i) => <DaySlots key={i} day={addDays(weekStart, i)} slots={byDay.get(addDays(weekStart, i).toDateString()) ?? []} onPick={setSlot} />)}
                  </div>
                )}
                {!availability.loading && !availability.error && (availability.data?.length ?? 0) === 0 && <p className="mt-3 text-sm text-fg-tertiary">No times this week. Try the next one.</p>}
              </div>
            )}
            {step === 4 && type && slot && (
              <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
                <Back onClick={() => setSlot(null)} />
                <div className="rounded-2xl bg-card p-4 ring-1 ring-black/[0.06] dark:ring-white/10"><div className="font-display text-lg">{type.name}</div><div className="text-sm text-fg-secondary">{new Date(slot).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })} at {time(slot)} · {type.durationMinutes} min · {options.data.practitioners.find((p) => p.id === pracId)?.name}</div><div className="num mt-1 text-sm"><b>{aud(type.payNowCents)}</b> {type.mode === "deposit" ? `deposit today (total ${aud(type.feeCents)})` : "today"}</div>{business?.address && <div className="mt-1 text-xs text-fg-tertiary">{business.address}</div>}</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><Label htmlFor="b-first">First name</Label><Input id="b-first" required value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></div>
                  <div><Label htmlFor="b-last">Last name</Label><Input id="b-last" required value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></div>
                  <div><Label htmlFor="b-email">Email</Label><Input id="b-email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
                  <div><Label htmlFor="b-phone">Mobile</Label><Input id="b-phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
                  <div><Label htmlFor="b-dob">Date of birth</Label><Input id="b-dob" type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} /></div>
                  <div className="sm:col-span-2"><Label htmlFor="b-notes">Anything we should know?</Label><Textarea id="b-notes" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
                </div>
                <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 size-4 accent-foreground" checked={form.agree} onChange={(e) => setForm({ ...form, agree: e.target.checked })} /><span>I understand that {type.mode === "deposit" ? "the deposit" : "the fee"} is taken now and that cancellations with less than 48 hours’ notice may not be refunded.</span></label>
                <Button type="submit" size="lg" disabled={busy}>{busy ? "Taking you to payment…" : `Pay ${aud(type.payNowCents)} and book`}</Button>
                <p className="text-xs text-fg-tertiary">Payment is handled by Stripe. Your appointment is confirmed the moment payment succeeds and you’ll get an email.</p>
              </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}

const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

function DaySlots({ day, slots, onPick }: { day: Date; slots: string[]; onPick: (s: string) => void }) {
  return (
    <div className="rounded-xl bg-card p-2 ring-1 ring-black/[0.06] dark:ring-white/10">
      <div className="mb-1 text-center text-xs font-medium">{day.toLocaleDateString("en-AU", { weekday: "short" })}<div className="num text-fg-tertiary">{day.getDate()}</div></div>
      {slots.length === 0 ? <div className="py-2 text-center text-[11px] text-fg-quaternary">—</div> : (
        <ul className="space-y-1">{slots.map((s) => <li key={s}><button type="button" onClick={() => onPick(s)} className="num w-full rounded-lg bg-muted px-1 py-1 text-xs hover:bg-foreground hover:text-background">{time(s)}</button></li>)}</ul>
      )}
    </div>
  );
}

const Back = ({ onClick }: { onClick: () => void }) => <button type="button" onClick={onClick} className="mb-3 inline-flex items-center gap-1 text-xs text-fg-tertiary hover:text-foreground"><ChevronLeft className="size-3.5" />Back</button>;

/** After Stripe: shows the booking state live; the webhook flips it from paid to booked within seconds. */
export function BookingDone() {
  const params = useSearchParams();
  const id = params.get("session") as Id<"bookingSessions"> | null;
  const s = useQuery(api.bookings.publicSessionStatus, id ? { id } : "skip");
  const practice = useQuery(api.settings.publicPractice);
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center px-6 py-12 text-center">
      <p className="text-xs uppercase tracking-[0.14em] text-fg-tertiary">{practice?.name}</p>
      {!id || s === null ? <p className="mt-4 text-sm text-fg-secondary">We couldn’t find that booking.</p> : !s ? <p className="mt-4 text-sm text-fg-tertiary">Checking…</p> : (
        <>
          <h1 className="mt-2 font-display text-3xl">{s.status === "booked" ? "You’re booked." : s.status === "paid" ? "Payment received." : s.status === "failed" ? "Almost there." : s.status === "expired" ? "That session expired." : "Waiting for payment…"}</h1>
          <p className="mt-3 text-sm text-fg-secondary">{s.status === "booked" ? `${s.firstName}, your appointment on ${new Date(s.startsAt).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })} at ${time(s.startsAt)} is confirmed. A confirmation is on its way to ${s.email}.` : s.status === "paid" ? "Confirming your appointment now. This takes a few seconds." : s.error ?? "If you didn’t complete payment, nothing has been booked."}</p>
          <p className="num mt-4 text-xs text-fg-tertiary">{aud(s.amountCents)} {s.mode === "deposit" ? "deposit" : "paid"}</p>
        </>
      )}
    </main>
  );
}
