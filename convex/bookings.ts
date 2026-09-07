import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

type MatterRef = { _id: Id<"matters">; name: string; status: Doc<"matters">["status"] };
import { requireUser } from "./lib/auth";
import { audit } from "./lib/audit";
import * as cliniko from "./lib/cliniko";

/* ------------------------------ live Cliniko reads (staff) ------------------------------ */

export const practice = action({
  args: {},
  handler: async (ctx) => {
    await ctx.runQuery(internal.bookings.requireStaff, {});
    const [businesses, practitioners, types] = await Promise.all([cliniko.listBusinesses(), cliniko.listPractitioners(), cliniko.listAppointmentTypes()]);
    return { businesses, practitioners: practitioners.filter((p) => p.active), appointmentTypes: types.filter((t) => !t.archived_at) };
  },
});

export const calendar = action({
  args: { fromIso: v.string(), toIso: v.string(), practitionerId: v.optional(v.string()) },
  handler: async (ctx, { fromIso, toIso, practitionerId }) => {
    await ctx.runQuery(internal.bookings.requireStaff, {});
    const [appointments, availability, unavailable, types, practitioners] = await Promise.all([cliniko.listAppointments(fromIso, toIso, practitionerId), cliniko.availabilityBlocks(fromIso, toIso), cliniko.unavailableBlocks(fromIso, toIso), cliniko.listAppointmentTypes(), cliniko.listPractitioners()]);
    const typeById = new Map(types.map((t) => [t.id, t]));
    const pracById = new Map(practitioners.map((p) => [p.id, p]));
    // Patient names are not on the appointment payload; fetch the few unique patients in this window.
    const patientIds = Array.from(new Set(appointments.map((a) => cliniko.idFromLink(a.patient)).filter((x): x is string => !!x)));
    const patients = new Map<string, cliniko.Patient>();
    await Promise.all(patientIds.slice(0, 60).map(async (id) => { try { patients.set(id, await cliniko.getPatient(id)); } catch { /* archived */ } }));
    return {
      appointments: appointments.map((a) => {
        const pid = cliniko.idFromLink(a.patient);
        const t = typeById.get(cliniko.idFromLink(a.appointment_type) ?? "");
        const p = pracById.get(cliniko.idFromLink(a.practitioner) ?? "");
        const pat = pid ? patients.get(pid) : undefined;
        return { id: a.id, startsAt: a.starts_at, endsAt: a.ends_at, notes: a.notes, cancelledAt: a.cancelled_at ?? null, didNotArrive: !!a.did_not_arrive, arrived: !!a.patient_arrived, telehealthUrl: a.telehealth_url, patientId: pid, patientName: pat ? `${pat.first_name} ${pat.last_name}` : a.patient_name ?? "Patient", typeId: t?.id, typeName: t?.name ?? "Appointment", color: t?.color, practitionerId: p?.id, practitionerName: p ? `${p.first_name} ${p.last_name}` : "", clinikoUrl: cliniko.clinikoWebUrl(`/appointments/${a.id}`), patientUrl: pid ? cliniko.clinikoWebUrl(`/patients/${pid}`) : undefined };
      }),
      availability: availability.filter((b) => !b.deleted_at).map((b) => ({ id: b.id, startsAt: b.starts_at, endsAt: b.ends_at, practitionerId: cliniko.idFromLink(b.practitioner) })),
      unavailable: unavailable.filter((b) => !b.deleted_at).map((b) => ({ id: b.id, startsAt: b.starts_at, endsAt: b.ends_at, notes: b.notes, practitionerId: cliniko.idFromLink(b.practitioner) })),
    };
  },
});

export const searchPatients = action({
  args: { q: v.string() },
  handler: async (ctx, { q }) => {
    const me = await ctx.runQuery(internal.bookings.requireStaff, {});
    if (q.trim().length < 2) return [];
    const patients = await cliniko.searchPatients(q);
    await ctx.runMutation(internal.bookings.logAccess, { userId: me._id, action: "cliniko.patientSearch", detail: q });
    return patients.filter((p) => !p.archived_at).map(shapePatient);
  },
});

export const patient = action({
  args: { patientId: v.string() },
  handler: async (ctx, { patientId }) => {
    const me = await ctx.runQuery(internal.bookings.requireStaff, {});
    const [p, appointments, attachments, alerts, invoices, types, practitioners] = await Promise.all([cliniko.getPatient(patientId), cliniko.patientAppointments(patientId), cliniko.patientAttachments(patientId), cliniko.patientMedicalAlerts(patientId), cliniko.patientInvoices(patientId).catch(() => [] as cliniko.Invoice[]), cliniko.listAppointmentTypes(), cliniko.listPractitioners()]);
    await ctx.runMutation(internal.bookings.logAccess, { userId: me._id, action: "cliniko.patientView", subjectId: patientId });
    const typeById = new Map(types.map((t) => [t.id, t]));
    const pracById = new Map(practitioners.map((x) => [x.id, x]));
    const matters: MatterRef[] = await ctx.runQuery(internal.bookings.mattersForPatient, { patientId });
    return {
      ...shapePatient(p),
      notes: p.notes,
      address: [p.address_1, p.address_2, p.city, p.state, p.post_code].filter(Boolean).join(", "),
      alerts: alerts.filter((a) => !a.archived_at).map((a) => a.name),
      appointments: appointments.map((a) => ({ id: a.id, startsAt: a.starts_at, endsAt: a.ends_at, cancelledAt: a.cancelled_at ?? null, didNotArrive: !!a.did_not_arrive, typeName: typeById.get(cliniko.idFromLink(a.appointment_type) ?? "")?.name ?? "Appointment", practitionerName: (() => { const x = pracById.get(cliniko.idFromLink(a.practitioner) ?? ""); return x ? `${x.first_name} ${x.last_name}` : ""; })(), clinikoUrl: cliniko.clinikoWebUrl(`/appointments/${a.id}`) })),
      attachments: attachments.filter((a) => !a.archived_at).map((a) => ({ id: a.id, filename: a.filename ?? a.description ?? `Attachment ${a.id}`, description: a.description, contentType: a.content_type, createdAt: a.created_at, url: a.content_url })),
      invoices: invoices.map((i) => ({ id: i.id, number: i.number, status: i.status_description ?? String(i.status), issueDate: i.issue_date, closedAt: i.closed_at ?? null, total: i.total_amount, clinikoUrl: cliniko.clinikoWebUrl(`/invoices/${i.id}`) })),
      matters,
    };
  },
});

function shapePatient(p: cliniko.Patient) {
  return { id: p.id, firstName: p.first_name, lastName: p.last_name, preferredName: p.preferred_first_name, name: `${p.preferred_first_name || p.first_name} ${p.last_name}`, email: p.email, phone: p.patient_phone_numbers?.[0]?.number, phones: p.patient_phone_numbers ?? [], dob: p.date_of_birth, medicalAlerts: p.medical_alerts, updatedAt: p.updated_at, clinikoUrl: cliniko.clinikoWebUrl(`/patients/${p.id}`) };
}

export const requireStaff = internalQuery({ args: {}, handler: async (ctx) => { const u = await requireUser(ctx); return { _id: u._id, email: u.email, name: u.name }; } });
export const logAccess = internalMutation({ args: { userId: v.id("users"), action: v.string(), subjectId: v.optional(v.string()), detail: v.optional(v.string()) }, handler: async (ctx, a) => { await audit(ctx, { userId: a.userId, action: a.action, subjectKind: "clinikoPatient", subjectId: a.subjectId, detail: a.detail }); } });
export const mattersForPatient = internalQuery({ args: { patientId: v.string() }, handler: async (ctx, { patientId }): Promise<MatterRef[]> => (await ctx.db.query("matters").collect()).filter((m) => m.clinikoPatientIds.includes(patientId)).map((m) => ({ _id: m._id, name: m.name, status: m.status })) });

/* ------------------------------ staff writes ------------------------------ */

export const createAppointment = action({
  args: { patientId: v.string(), practitionerId: v.string(), businessId: v.string(), appointmentTypeId: v.string(), startsAt: v.string(), endsAt: v.string(), notes: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const me = await ctx.runQuery(internal.bookings.requireStaff, {});
    const appt = await cliniko.createAppointment({ patient_id: a.patientId, practitioner_id: a.practitionerId, business_id: a.businessId, appointment_type_id: a.appointmentTypeId, starts_at: a.startsAt, ends_at: a.endsAt, notes: a.notes });
    await ctx.runMutation(internal.bookings.logAccess, { userId: me._id, action: "cliniko.appointmentCreate", subjectId: appt.id });
    return { id: appt.id };
  },
});

export const rescheduleAppointment = action({
  args: { appointmentId: v.string(), startsAt: v.string(), endsAt: v.string(), practitionerId: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const me = await ctx.runQuery(internal.bookings.requireStaff, {});
    await cliniko.updateAppointment(a.appointmentId, { starts_at: a.startsAt, ends_at: a.endsAt, ...(a.practitionerId ? { practitioner_id: a.practitionerId } : {}) });
    await ctx.runMutation(internal.bookings.logAccess, { userId: me._id, action: "cliniko.appointmentReschedule", subjectId: a.appointmentId });
  },
});

export const updateAppointmentFlags = action({
  args: { appointmentId: v.string(), didNotArrive: v.optional(v.boolean()), arrived: v.optional(v.boolean()), notes: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const me = await ctx.runQuery(internal.bookings.requireStaff, {});
    await cliniko.updateAppointment(a.appointmentId, { ...(a.didNotArrive !== undefined ? { did_not_arrive: a.didNotArrive } : {}), ...(a.arrived !== undefined ? { patient_arrived: a.arrived } : {}), ...(a.notes !== undefined ? { notes: a.notes } : {}) });
    await ctx.runMutation(internal.bookings.logAccess, { userId: me._id, action: "cliniko.appointmentUpdate", subjectId: a.appointmentId });
  },
});

export const cancelAppointment = action({
  args: { appointmentId: v.string(), reason: v.number(), note: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const me = await ctx.runQuery(internal.bookings.requireStaff, {});
    await cliniko.cancelAppointment(a.appointmentId, a.reason, a.note);
    await ctx.runMutation(internal.bookings.logAccess, { userId: me._id, action: "cliniko.appointmentCancel", subjectId: a.appointmentId, detail: a.note });
  },
});

/* ------------------------------ pricing (ours) ------------------------------ */

export const pricing = query({ args: {}, handler: async (ctx) => { await requireUser(ctx); return await ctx.db.query("appointmentPricing").collect(); } });

/** Pull appointment types from Cliniko and make sure each has a pricing row (default: not bookable online). */
export const syncPricing = action({
  args: {},
  handler: async (ctx) => {
    await ctx.runQuery(internal.bookings.requireStaff, {});
    const types = (await cliniko.listAppointmentTypes()).filter((t) => !t.archived_at);
    await ctx.runMutation(internal.bookings.ensurePricingRows, { types: types.map((t) => ({ id: t.id, name: t.name, duration: t.duration_in_minutes, online: !!t.show_in_online_bookings })) });
    return types.length;
  },
});

export const ensurePricingRows = internalMutation({
  args: { types: v.array(v.object({ id: v.string(), name: v.string(), duration: v.number(), online: v.boolean() })) },
  handler: async (ctx, { types }) => {
    for (const t of types) {
      const row = await ctx.db.query("appointmentPricing").withIndex("by_cliniko", (q) => q.eq("clinikoAppointmentTypeId", t.id)).unique();
      if (row) await ctx.db.patch(row._id, { name: t.name, durationMinutes: t.duration, updatedAt: Date.now() });
      else await ctx.db.insert("appointmentPricing", { clinikoAppointmentTypeId: t.id, name: t.name, durationMinutes: t.duration, mode: "none", feeCents: 0, bookableOnline: t.online, updatedAt: Date.now() });
    }
  },
});

export const setPricing = mutation({
  args: { id: v.id("appointmentPricing"), mode: v.union(v.literal("full"), v.literal("deposit"), v.literal("none")), feeCents: v.number(), depositCents: v.optional(v.number()), bookableOnline: v.boolean() },
  handler: async (ctx, { id, ...patch }) => {
    const user = await requireUser(ctx);
    await ctx.db.patch(id, { ...patch, updatedAt: Date.now() });
    await audit(ctx, { userId: user._id, action: "bookings.pricing", subjectKind: "appointmentPricing", subjectId: id });
  },
});

/* ------------------------------ public booking flow ------------------------------ */

/** What the public page shows: bookable appointment types with their price, practitioners and the business. */
export const publicOptions = action({
  args: {},
  handler: async (ctx) => {
    const pricing: Doc<"appointmentPricing">[] = await ctx.runQuery(internal.bookings.publicPricing, {});
    const [businesses, practitioners, types] = await Promise.all([cliniko.listBusinesses(), cliniko.listPractitioners(), cliniko.listAppointmentTypes()]);
    const priced = new Map<string, Doc<"appointmentPricing">>(pricing.map((p) => [p.clinikoAppointmentTypeId, p]));
    const business = businesses.find((b) => b.show_in_online_bookings !== false) ?? businesses[0];
    return {
      business: business ? { id: business.id, name: business.display_name || business.business_name, address: [business.address_1, business.city, business.state, business.post_code].filter(Boolean).join(", "), timeZone: business.time_zone_identifier ?? "Australia/Melbourne" } : null,
      practitioners: practitioners.filter((p) => p.active && p.show_in_online_bookings !== false).map((p) => ({ id: p.id, name: `${p.title ? p.title + " " : ""}${p.first_name} ${p.last_name}`, designation: p.designation, description: p.description })),
      appointmentTypes: types.filter((t) => !t.archived_at && priced.get(t.id)?.bookableOnline && (priced.get(t.id)?.mode ?? "none") !== "none").map((t) => { const p = priced.get(t.id)!; return { id: t.id, name: t.name, description: t.description, durationMinutes: t.duration_in_minutes, telehealth: !!t.telehealth_enabled, feeCents: p.feeCents, mode: p.mode, payNowCents: p.mode === "deposit" ? (p.depositCents ?? 0) : p.feeCents }; }),
    };
  },
});

export const publicPricing = internalQuery({ args: {}, handler: async (ctx): Promise<Doc<"appointmentPricing">[]> => (await ctx.db.query("appointmentPricing").collect()).filter((p) => p.bookableOnline) });

export const publicAvailability = action({
  args: { businessId: v.string(), practitionerId: v.string(), appointmentTypeId: v.string(), from: v.string(), to: v.string() },
  handler: async (_ctx, a) => {
    const times = await cliniko.availableTimes(a.businessId, a.practitionerId, a.appointmentTypeId, a.from, a.to);
    return times.map((t) => t.appointment_start);
  },
});

export const startPublicBooking = action({
  args: { businessId: v.string(), practitionerId: v.string(), appointmentTypeId: v.string(), startsAt: v.string(), patient: v.object({ firstName: v.string(), lastName: v.string(), email: v.string(), phone: v.optional(v.string()), dob: v.optional(v.string()), notes: v.optional(v.string()) }), origin: v.string() },
  handler: async (ctx, a): Promise<{ url: string }> => {
    const all: Doc<"appointmentPricing">[] = await ctx.runQuery(internal.bookings.publicPricing, {});
    const pricing = all.find((p) => p.clinikoAppointmentTypeId === a.appointmentTypeId);
    if (!pricing || pricing.mode === "none") throw new Error("This appointment type can't be booked online.");
    const amount = pricing.mode === "deposit" ? (pricing.depositCents ?? 0) : pricing.feeCents;
    if (amount < 100) throw new Error("This appointment type has no price set.");
    const start = new Date(a.startsAt);
    const end = new Date(start.getTime() + pricing.durationMinutes * 60_000);
    const holdMinutes = 15;
    const sessionId = await ctx.runMutation(internal.bookings.createSession, { businessId: a.businessId, practitionerId: a.practitionerId, appointmentTypeId: a.appointmentTypeId, startsAt: start.toISOString(), endsAt: end.toISOString(), patient: a.patient, amountCents: amount, mode: pricing.mode, expiresAt: Date.now() + holdMinutes * 60_000 });
    const checkout = await ctx.runAction(internal.stripe.createBookingCheckout, { bookingSessionId: sessionId, amountCents: amount, description: `${pricing.name}${pricing.mode === "deposit" ? " (deposit)" : ""} — ${start.toLocaleString("en-AU", { timeZone: "Australia/Melbourne", dateStyle: "medium", timeStyle: "short" })}`, customerEmail: a.patient.email, customerName: `${a.patient.firstName} ${a.patient.lastName}`, successUrl: `${a.origin}/book/done?session=${sessionId}`, cancelUrl: `${a.origin}/book?cancelled=1`, expiresAt: Date.now() + holdMinutes * 60_000 });
    await ctx.runMutation(internal.bookings.attachCheckout, { bookingSessionId: sessionId, stripeCheckoutSessionId: checkout.id });
    return { url: checkout.url };
  },
});

export const createSession = internalMutation({
  args: { businessId: v.string(), practitionerId: v.string(), appointmentTypeId: v.string(), startsAt: v.string(), endsAt: v.string(), patient: v.object({ firstName: v.string(), lastName: v.string(), email: v.string(), phone: v.optional(v.string()), dob: v.optional(v.string()), notes: v.optional(v.string()) }), amountCents: v.number(), mode: v.union(v.literal("full"), v.literal("deposit")), expiresAt: v.number() },
  handler: async (ctx, a) => await ctx.db.insert("bookingSessions", { ...a, status: "pending", createdAt: Date.now() }),
});
export const attachCheckout = internalMutation({ args: { bookingSessionId: v.id("bookingSessions"), stripeCheckoutSessionId: v.string() }, handler: async (ctx, a) => { await ctx.db.patch(a.bookingSessionId, { stripeCheckoutSessionId: a.stripeCheckoutSessionId }); } });
export const markFailed = internalMutation({ args: { bookingSessionId: v.id("bookingSessions"), error: v.string() }, handler: async (ctx, a) => { const s = await ctx.db.get(a.bookingSessionId); if (s && s.status === "pending") await ctx.db.patch(a.bookingSessionId, { status: "failed", error: a.error }); } });
export const sessionById = internalQuery({ args: { id: v.id("bookingSessions") }, handler: async (ctx, { id }) => await ctx.db.get(id) });
export const finishSession = internalMutation({
  args: { id: v.id("bookingSessions"), status: v.union(v.literal("paid"), v.literal("booked"), v.literal("failed")), clinikoPatientId: v.optional(v.string()), clinikoAppointmentId: v.optional(v.string()), stripePaymentIntentId: v.optional(v.string()), error: v.optional(v.string()) },
  handler: async (ctx, { id, ...patch }) => { await ctx.db.patch(id, patch); },
});

/** Stripe confirmed payment: create the patient if new, then the appointment in Cliniko. */
export const completePaid = internalAction({
  args: { bookingSessionId: v.id("bookingSessions"), stripeCheckoutSessionId: v.string(), stripePaymentIntentId: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const s = await ctx.runQuery(internal.bookings.sessionById, { id: a.bookingSessionId });
    if (!s || s.status === "booked") return;
    await ctx.runMutation(internal.bookings.finishSession, { id: s._id, status: "paid", stripePaymentIntentId: a.stripePaymentIntentId });
    try {
      let patientId = s.clinikoPatientId;
      if (!patientId) {
        const matches = await cliniko.searchPatients(s.patient.email).catch(() => [] as cliniko.Patient[]);
        const hit = matches.find((p) => p.email?.toLowerCase() === s.patient.email.toLowerCase() && !p.archived_at);
        patientId = hit?.id ?? (await cliniko.createPatient({ first_name: s.patient.firstName, last_name: s.patient.lastName, email: s.patient.email, date_of_birth: s.patient.dob, patient_phone_numbers: s.patient.phone ? [{ number: s.patient.phone, phone_type: "Mobile" }] : undefined, notes: s.patient.notes })).id;
      }
      const appt = await cliniko.createAppointment({ appointment_type_id: s.appointmentTypeId, business_id: s.businessId, practitioner_id: s.practitionerId, patient_id: patientId, starts_at: s.startsAt, ends_at: s.endsAt, notes: `Booked and paid online via Happy Days (${s.mode === "deposit" ? "deposit" : "full fee"} $${(s.amountCents / 100).toFixed(2)}, Stripe ${a.stripeCheckoutSessionId}).${s.patient.notes ? `\n${s.patient.notes}` : ""}`, online_booking_policy_accepted: true });
      await ctx.runMutation(internal.bookings.finishSession, { id: s._id, status: "booked", clinikoPatientId: patientId, clinikoAppointmentId: appt.id });
    } catch (e) {
      await ctx.runMutation(internal.bookings.finishSession, { id: s._id, status: "failed", error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  },
});

export const expireSessions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const stale = await ctx.db.query("bookingSessions").withIndex("by_status", (q) => q.eq("status", "pending").lt("expiresAt", Date.now())).take(100);
    for (const s of stale) await ctx.db.patch(s._id, { status: "expired" });
  },
});

/** Public: the "thanks" page after Stripe. Reveals only what the booker already knows. */
export const publicSessionStatus = query({
  args: { id: v.id("bookingSessions") },
  handler: async (ctx, { id }) => {
    const s = await ctx.db.get(id);
    if (!s) return null;
    return { status: s.status, startsAt: s.startsAt, endsAt: s.endsAt, firstName: s.patient.firstName, email: s.patient.email, amountCents: s.amountCents, mode: s.mode, error: s.status === "failed" ? "We took the payment but couldn't confirm the appointment automatically. The practice has been notified and will confirm by email." : undefined };
  },
});

/** Staff: recent online bookings and anything that needs a hand. */
export const recentSessions = query({
  args: {},
  handler: async (ctx) => { await requireUser(ctx); return await ctx.db.query("bookingSessions").order("desc").take(50); },
});
