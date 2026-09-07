import { action, internalAction, internalMutation, internalQuery, mutation, query, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

type MatterRef = { _id: Id<"matters">; name: string; status: Doc<"matters">["status"] };
import { requireUser } from "./lib/auth";
import { audit } from "./lib/audit";
import * as cliniko from "./lib/cliniko";

/* ------------------------------ live Cliniko reads (staff) ------------------------------ */

type RefData = { businesses: cliniko.Business[]; practitioners: cliniko.Practitioner[]; types: cliniko.AppointmentType[]; at: number };
const REF_TTL = 10 * 60_000;

/** Practitioners, businesses and appointment types change rarely; keep them for ten minutes so every screen doesn't re-ask Cliniko. */
async function refData(ctx: ActionCtx, force = false): Promise<RefData> {
  const cached = (await ctx.runQuery(internal.settings.getInternal, { key: "cliniko.refCache" })) as RefData | null;
  if (!force && cached && Date.now() - cached.at < REF_TTL) return cached;
  const [businesses, practitioners, types] = await Promise.all([cliniko.listBusinesses(), cliniko.listPractitioners(), cliniko.listAppointmentTypes()]);
  const fresh: RefData = { businesses, practitioners, types, at: Date.now() };
  await ctx.runMutation(internal.settings.setInternal, { key: "cliniko.refCache", value: fresh });
  return fresh;
}

export const practice = action({
  args: {},
  handler: async (ctx) => {
    await ctx.runQuery(internal.bookings.requireStaff, {});
    const { businesses, practitioners, types } = await refData(ctx);
    return { businesses, practitioners: practitioners.filter((p) => p.active), appointmentTypes: types.filter((t) => !t.archived_at) };
  },
});

export const calendar = action({
  args: { fromIso: v.string(), toIso: v.string(), practitionerId: v.optional(v.string()) },
  handler: async (ctx, { fromIso, toIso, practitionerId }) => {
    await ctx.runQuery(internal.bookings.requireStaff, {});
    const [appointments, availability, unavailable, ref, groups] = await Promise.all([cliniko.listAppointments(fromIso, toIso, practitionerId), cliniko.availabilityBlocks(fromIso, toIso), cliniko.unavailableBlocks(fromIso, toIso), refData(ctx), cliniko.groupAppointments(fromIso, toIso).catch(() => [] as cliniko.GroupAppointment[])]);
    const { types, practitioners } = ref;
    const attendeeCounts = new Map<string, number>();
    await Promise.all(groups.filter((g) => !g.deleted_at).slice(0, 30).map(async (g) => { try { attendeeCounts.set(g.id, await cliniko.attendeeCount(g.id)); } catch { /* fine */ } }));
    const typeById = new Map(types.map((t) => [t.id, t]));
    const pracById = new Map(practitioners.map((p) => [p.id, p]));
    // Appointments can reference practitioners the list omits (inactive, other business); resolve them by id.
    const missing = Array.from(new Set([...appointments.map((a) => cliniko.idFromLink(a.practitioner)), ...groups.map((g) => cliniko.idFromLink(g.practitioner))].filter((x): x is string => !!x && !pracById.has(x))));
    await Promise.all(missing.map(async (id) => { try { pracById.set(id, await cliniko.getPractitioner(id)); } catch { pracById.set(id, { id, first_name: "Practitioner", last_name: id, active: false }); } }));
    return {
      practitioners: Array.from(pracById.values()).map((p) => ({ id: p.id, name: `${p.first_name} ${p.last_name}`.trim(), active: p.active !== false })),
      appointments: appointments.map((a) => {
        const pid = cliniko.idFromLink(a.patient);
        const t = typeById.get(cliniko.idFromLink(a.appointment_type) ?? "");
        const p = pracById.get(cliniko.idFromLink(a.practitioner) ?? "");
        return { id: a.id, startsAt: a.starts_at, endsAt: a.ends_at, notes: a.notes, cancelledAt: a.cancelled_at ?? null, didNotArrive: !!a.did_not_arrive, arrived: !!a.patient_arrived, telehealthUrl: t?.telehealth_enabled ? a.telehealth_url : undefined, patientId: pid, patientName: a.patient_name ?? "Patient", typeId: t?.id, typeName: t?.name ?? "Appointment", color: t?.color, practitionerId: p?.id, practitionerName: p ? `${p.first_name} ${p.last_name}` : "", clinikoUrl: cliniko.clinikoWebUrl(`/appointments/${a.id}`), patientUrl: pid ? cliniko.clinikoWebUrl(`/patients/${pid}`) : undefined };
      }),
      groups: groups.filter((g) => !g.deleted_at).map((g) => { const t = typeById.get(cliniko.idFromLink(g.appointment_type) ?? ""); const p = pracById.get(cliniko.idFromLink(g.practitioner) ?? ""); return { id: g.id, startsAt: g.starts_at, endsAt: g.ends_at, notes: g.notes, typeName: t?.name ?? "Group", color: t?.color, practitionerId: p?.id, practitionerName: p ? `${p.first_name} ${p.last_name}` : "", attendees: attendeeCounts.get(g.id), maxAttendees: g.max_attendees, clinikoUrl: cliniko.clinikoWebUrl(`/appointments/${g.id}`) }; }),
      availability: availability.filter((b) => !b.deleted_at).map((b) => ({ id: b.id, startsAt: b.starts_at, endsAt: b.ends_at, practitionerId: cliniko.idFromLink(b.practitioner) })),
      unavailable: unavailable.filter((b) => !b.deleted_at).map((b) => ({ id: b.id, startsAt: b.starts_at, endsAt: b.ends_at, notes: b.notes, practitionerId: cliniko.idFromLink(b.practitioner) })),
    };
  },
});

/** Cheap freshness check: has any appointment in this window changed since the calendar last fetched it? */
export const changedSince = action({
  args: { fromIso: v.string(), toIso: v.string(), sinceIso: v.string() },
  handler: async (ctx, { fromIso, toIso, sinceIso }) => {
    await ctx.runQuery(internal.bookings.requireStaff, {});
    const changed = await cliniko.listAppointments(fromIso, toIso, undefined, sinceIso);
    return { changed: changed.length };
  },
});

/** Patients page: the most recently updated records, straight from Cliniko. */
export const recentPatients = action({
  args: {},
  handler: async (ctx) => {
    const me = await ctx.runQuery(internal.bookings.requireStaff, {});
    const patients = await cliniko.recentPatients(50);
    await ctx.runMutation(internal.bookings.logAccess, { userId: me._id, action: "cliniko.patientList" });
    return patients.filter((p) => !p.archived_at).map(shapePatient);
  },
});

/** Payments page: Cliniko invoices issued in the last N days. */
export const clinikoInvoices = action({
  args: { days: v.number() },
  handler: async (ctx, { days }) => {
    await ctx.runQuery(internal.bookings.requireStaff, {});
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const invoices = await cliniko.listInvoices(since);
    // Invoices carry only a patient link. Resolve names for the unique patients, most recent first, capped so a
    // long period still loads quickly; the rest fall back to the id with a link to the record.
    const ids = Array.from(new Set(invoices.map((i) => cliniko.idFromLink(i.patient)).filter((x): x is string => !!x))).slice(0, 60);
    const names = new Map<string, string>();
    await Promise.all(ids.map(async (id) => { try { const p = await cliniko.getPatient(id); names.set(id, `${p.preferred_first_name || p.first_name} ${p.last_name}`); } catch { /* archived or no access */ } }));
    return invoices.map((i) => ({ id: i.id, number: i.number, patientId: cliniko.idFromLink(i.patient), patientName: i.patient_name ?? names.get(cliniko.idFromLink(i.patient) ?? "") ?? "", issueDate: i.issue_date, closedAt: i.closed_at ?? null, status: i.status_description ?? String(i.status), total: Number(i.total_amount) || 0, net: Number(i.net_amount ?? i.total_amount) || 0, clinikoUrl: cliniko.clinikoWebUrl(`/invoices/${i.id}`), payUrl: i.online_payment_url }));
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
    const [p, appointments, attachments, alerts, invoices, ref, notes, cases, forms, users] = await Promise.all([cliniko.getPatient(patientId), cliniko.patientAppointments(patientId), cliniko.patientAttachments(patientId), cliniko.patientMedicalAlerts(patientId), cliniko.patientInvoices(patientId).catch(() => [] as cliniko.Invoice[]), refData(ctx), cliniko.treatmentNotes(patientId).catch(() => [] as cliniko.TreatmentNote[]), cliniko.patientCases(patientId).catch(() => [] as cliniko.PatientCase[]), cliniko.patientForms(patientId).catch(() => [] as cliniko.PatientForm[]), cliniko.listUsers().catch(() => [] as cliniko.User[])]);
    const { types, practitioners } = ref;
    const userName = (link?: { links: { self: string } }) => { const u = users.find((x) => x.id === cliniko.idFromLink(link)); return u ? (u.display_name || `${u.first_name} ${u.last_name}`) : undefined; };
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
      invoices: invoices.map((i) => ({ id: i.id, number: i.number, status: i.status_description ?? String(i.status), issueDate: i.issue_date, closedAt: i.closed_at ?? null, total: Number(i.total_amount) || 0, clinikoUrl: cliniko.clinikoWebUrl(`/invoices/${i.id}`) })),
      // Titles and dates only. Note content never leaves Cliniko.
      treatmentNotes: notes.filter((n) => !n.deleted_at).map((n) => ({ id: n.id, title: n.title || "Treatment note", draft: n.draft, createdAt: n.created_at, finalizedAt: n.finalized_at ?? null, author: userName(n.author), clinikoUrl: cliniko.clinikoWebUrl(`/patients/${patientId}/treatment_notes/${n.id}`) })),
      cases: cases.filter((c) => !c.deleted_at).map((c) => ({ id: c.id, name: c.name, closed: c.closed, issueDate: c.issue_date, expiryDate: c.expiry_date, notes: c.notes, clinikoUrl: cliniko.clinikoWebUrl(`/patients/${patientId}/cases/${c.id}`) })),
      forms: forms.filter((f) => !f.deleted_at).map((f) => ({ id: f.id, name: f.name ?? "Form", completed: f.completed, completedAt: f.completed_at ?? null, createdAt: f.created_at, url: f.url, clinikoUrl: cliniko.clinikoWebUrl(`/patients/${patientId}/patient_forms/${f.id}`) })),
      matters,
    };
  },
});

function shapePatient(p: cliniko.Patient) {
  return { id: p.id, firstName: p.first_name, lastName: p.last_name, preferredName: p.preferred_first_name, name: `${p.preferred_first_name || p.first_name} ${p.last_name}`, email: p.email, phone: p.patient_phone_numbers?.[0]?.number, phones: p.patient_phone_numbers ?? [], dob: p.date_of_birth, medicalAlerts: typeof p.medical_alerts === "string" ? p.medical_alerts : undefined, updatedAt: p.updated_at, clinikoUrl: cliniko.clinikoWebUrl(`/patients/${p.id}`) };
}

/* ------------------------------ cases, forms, billing, users ------------------------------ */

export const createCase = action({
  args: { patientId: v.string(), name: v.string(), notes: v.optional(v.string()), matterId: v.optional(v.id("matters")) },
  handler: async (ctx, a) => {
    const me = await ctx.runQuery(internal.bookings.requireStaff, {});
    const c = await cliniko.createPatientCase({ patient_id: a.patientId, name: a.name, notes: a.notes, issue_date: new Date().toISOString().slice(0, 10) });
    await ctx.runMutation(internal.bookings.logAccess, { userId: me._id, action: "cliniko.caseCreate", subjectId: a.patientId, detail: c.name });
    if (a.matterId) await ctx.runMutation(internal.bookings.linkCase, { matterId: a.matterId, patientId: a.patientId, caseId: c.id, name: c.name });
    return { id: c.id, name: c.name };
  },
});

export const linkCase = internalMutation({
  args: { matterId: v.id("matters"), patientId: v.string(), caseId: v.string(), name: v.string() },
  handler: async (ctx, a) => { const m = await ctx.db.get(a.matterId); if (!m) return; await ctx.db.patch(a.matterId, { clinikoCases: [...(m.clinikoCases ?? []).filter((c) => c.caseId !== a.caseId), { patientId: a.patientId, caseId: a.caseId, name: a.name }], updatedAt: Date.now() }); },
});

export const formTemplates = action({
  args: {},
  handler: async (ctx) => { await ctx.runQuery(internal.bookings.requireStaff, {}); return (await cliniko.patientFormTemplates()).filter((t) => !t.archived_at).map((t) => ({ id: t.id, name: t.name })); },
});

/** Create a Cliniko patient form from a template and return the link the patient fills in. */
export const sendForm = action({
  args: { patientId: v.string(), templateId: v.string(), appointmentId: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const me = await ctx.runQuery(internal.bookings.requireStaff, {});
    const f = await cliniko.createPatientForm({ patient_form_template_id: a.templateId, patient_id: a.patientId, appointment_id: a.appointmentId, email_to_patient_on_completion: true });
    await ctx.runMutation(internal.bookings.logAccess, { userId: me._id, action: "cliniko.formCreate", subjectId: a.patientId, detail: f.name });
    return { id: f.id, url: f.url ?? null, name: f.name ?? "Form" };
  },
});

/** Everything needed to raise a Cliniko invoice: items, products, taxes, concession types and prices. */
export const billingCatalogue = action({
  args: {},
  handler: async (ctx) => {
    await ctx.runQuery(internal.bookings.requireStaff, {});
    const [items, products, taxes, concessionTypes, concessionPrices] = await Promise.all([cliniko.listBillableItems(), cliniko.listProducts().catch(() => [] as cliniko.Product[]), cliniko.listTaxes(), cliniko.listConcessionTypes().catch(() => [] as cliniko.ConcessionType[]), cliniko.listConcessionPrices().catch(() => [] as cliniko.ConcessionPrice[])]);
    return {
      items: items.filter((i) => !i.archived_at).map((i) => ({ id: i.id, name: i.name, code: i.item_code, price: Number(i.price) || 0, taxId: cliniko.idFromLink(i.tax) })),
      products: products.filter((p) => !p.archived_at).map((p) => ({ id: p.id, name: p.name, code: p.item_code, price: Number(p.price) || 0, taxId: cliniko.idFromLink(p.tax), stock: p.stock_level })),
      taxes: taxes.map((t) => ({ id: t.id, name: t.name, rate: Number(t.rate) || 0 })),
      concessionTypes: concessionTypes.filter((c) => !c.archived_at).map((c) => ({ id: c.id, name: c.name })),
      concessionPrices: concessionPrices.map((c) => ({ itemId: cliniko.idFromLink(c.billable_item), concessionTypeId: cliniko.idFromLink(c.concession_type), price: Number(c.price) || 0 })),
    };
  },
});

export const createClinikoInvoice = action({
  args: { patientId: v.string(), businessId: v.string(), practitionerId: v.string(), appointmentId: v.optional(v.string()), notes: v.optional(v.string()), items: v.array(v.object({ billableItemId: v.optional(v.string()), productId: v.optional(v.string()), quantity: v.number(), unitPrice: v.number(), taxId: v.optional(v.string()), concessionTypeId: v.optional(v.string()), discountPercentage: v.optional(v.number()) })) },
  handler: async (ctx, a) => {
    const me = await ctx.runQuery(internal.bookings.requireStaff, {});
    if (!a.items.length) throw new Error("Add at least one item.");
    const inv = await cliniko.createInvoice({ patient_id: a.patientId, business_id: a.businessId, practitioner_id: a.practitionerId, appointment_id: a.appointmentId, issue_date: new Date().toISOString().slice(0, 10), notes: a.notes, invoice_items: a.items.map((i) => ({ billable_item_id: i.billableItemId, product_id: i.productId, quantity: i.quantity, unit_price: i.unitPrice, tax_id: i.taxId, concession_type_id: i.concessionTypeId, discount_percentage: i.discountPercentage })) });
    await ctx.runMutation(internal.bookings.logAccess, { userId: me._id, action: "cliniko.invoiceCreate", subjectId: a.patientId, detail: `#${inv.number}` });
    return { id: inv.id, number: inv.number, total: Number(inv.total_amount) || 0, clinikoUrl: cliniko.clinikoWebUrl(`/invoices/${inv.id}`), payUrl: inv.online_payment_url };
  },
});

export const clinikoUsers = action({
  args: {},
  handler: async (ctx) => {
    await ctx.runQuery(internal.bookings.requireStaff, {});
    const [users, current] = await Promise.all([cliniko.listUsers(), cliniko.me().catch(() => null)]);
    return { users: users.map((u) => ({ id: u.id, name: u.display_name || `${u.first_name} ${u.last_name}`, email: u.email, role: u.role, active: u.active !== false })), apiKeyOwner: current ? `${current.first_name} ${current.last_name}` : null };
  },
});

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
    const updated = await cliniko.updateAppointment(a.appointmentId, { starts_at: a.startsAt, ends_at: a.endsAt, ...(a.practitionerId ? { practitioner_id: a.practitionerId } : {}) });
    await ctx.runMutation(internal.bookings.logAccess, { userId: me._id, action: "cliniko.appointmentReschedule", subjectId: a.appointmentId });
    // Any email from this patient asking for a reschedule is now answered.
    const pid = cliniko.idFromLink(updated.patient);
    if (pid) { try { const p = await cliniko.getPatient(pid); if (p.email) await ctx.runMutation(internal.mail.markRescheduledForEmail, { email: p.email }); } catch { /* best effort */ } }
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
    const types = (await refData(ctx, true)).types.filter((t) => !t.archived_at);
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
    const { businesses, practitioners, types } = await refData(ctx);
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
    const open = await ctx.runQuery(internal.bookings.pendingForEmail, { email: a.patient.email.toLowerCase() });
    if (open >= 5) throw new Error("Too many booking attempts for this email address. Please try again in an hour or call the practice.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.patient.email) || !a.patient.firstName.trim() || !a.patient.lastName.trim()) throw new Error("Please enter your name and a valid email address.");
    if (Number.isNaN(start.getTime()) || start.getTime() < Date.now()) throw new Error("That time has passed. Pick another.");
    const sessionId = await ctx.runMutation(internal.bookings.createSession, { businessId: a.businessId, practitionerId: a.practitionerId, appointmentTypeId: a.appointmentTypeId, startsAt: start.toISOString(), endsAt: end.toISOString(), patient: a.patient, amountCents: amount, mode: pricing.mode, expiresAt: Date.now() + holdMinutes * 60_000 });
    const checkout = await ctx.runAction(internal.stripe.createBookingCheckout, { bookingSessionId: sessionId, amountCents: amount, description: `${pricing.name}${pricing.mode === "deposit" ? " (deposit)" : ""} — ${start.toLocaleString("en-AU", { timeZone: "Australia/Melbourne", dateStyle: "medium", timeStyle: "short" })}`, customerEmail: a.patient.email, customerName: `${a.patient.firstName} ${a.patient.lastName}`, successUrl: `${a.origin}/book/done?session=${sessionId}`, cancelUrl: `${a.origin}/book?cancelled=1`, expiresAt: Date.now() + holdMinutes * 60_000 });
    await ctx.runMutation(internal.bookings.attachCheckout, { bookingSessionId: sessionId, stripeCheckoutSessionId: checkout.id });
    return { url: checkout.url };
  },
});

export const pendingForEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => (await ctx.db.query("bookingSessions").withIndex("by_status", (q) => q.eq("status", "pending").gt("expiresAt", Date.now() - 3_600_000)).collect()).filter((s) => s.patient.email.toLowerCase() === email).length,
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
    // Stripe delivers at least once: if the appointment already exists from an earlier attempt, just finish.
    if (s.clinikoAppointmentId) { await ctx.runMutation(internal.bookings.finishSession, { id: s._id, status: "booked", clinikoAppointmentId: s.clinikoAppointmentId, clinikoPatientId: s.clinikoPatientId }); return; }
    await ctx.runMutation(internal.bookings.finishSession, { id: s._id, status: "paid", stripePaymentIntentId: a.stripePaymentIntentId });
    try {
      let patientId = s.clinikoPatientId;
      if (!patientId) {
        const matches = await cliniko.searchPatients(s.patient.email).catch(() => [] as cliniko.Patient[]);
        const hit = matches.find((p) => p.email?.toLowerCase() === s.patient.email.toLowerCase() && !p.archived_at);
        patientId = hit?.id ?? (await cliniko.createPatient({ first_name: s.patient.firstName, last_name: s.patient.lastName, email: s.patient.email, date_of_birth: s.patient.dob, patient_phone_numbers: s.patient.phone ? [{ number: s.patient.phone, phone_type: "Mobile" }] : undefined, notes: s.patient.notes })).id;
        // Remember the patient now so a retry after an appointment failure never creates a second record.
        await ctx.runMutation(internal.bookings.finishSession, { id: s._id, status: "paid", clinikoPatientId: patientId });
      }
      const appt = await cliniko.createAppointment({ appointment_type_id: s.appointmentTypeId, business_id: s.businessId, practitioner_id: s.practitionerId, patient_id: patientId, starts_at: s.startsAt, ends_at: s.endsAt, notes: `Booked and paid online via Happy Days (${s.mode === "deposit" ? "deposit" : "full fee"} $${(s.amountCents / 100).toFixed(2)}, Stripe ${a.stripeCheckoutSessionId}).${s.patient.notes ? `\n${s.patient.notes}` : ""}`, online_booking_policy_accepted: true });
      // Record the appointment id before anything else that could fail (intake form, email).
      await ctx.runMutation(internal.bookings.finishSession, { id: s._id, status: "booked", clinikoPatientId: patientId, clinikoAppointmentId: appt.id });
      // Intake form: if a template is chosen in Settings, create the form against this appointment and email its link.
      const templateId = (await ctx.runQuery(internal.settings.getInternal, { key: "cliniko.intakeFormTemplateId" })) as string | null;
      if (templateId) {
        try {
          const f = await cliniko.createPatientForm({ patient_form_template_id: templateId, patient_id: patientId, appointment_id: appt.id, email_to_patient_on_completion: true });
          if (f.url) await ctx.runAction(internal.mail.sendFromPractice, { to: { name: `${s.patient.firstName} ${s.patient.lastName}`, email: s.patient.email }, subject: `Before your appointment: a short form to complete`, html: `<p>Hello ${s.patient.firstName},</p><p>Thanks for booking. Before your appointment on ${new Date(s.startsAt).toLocaleDateString("en-AU", { timeZone: "Australia/Melbourne", weekday: "long", day: "numeric", month: "long" })}, please complete this short form:</p><p><a href="${f.url}">${f.url}</a></p><p>Kind regards,<br>Barbara Fraser &amp; Associates</p>` });
        } catch (e) { console.error("intake form failed", e); }
      }
    } catch (e) {
      await ctx.runMutation(internal.bookings.finishSession, { id: s._id, status: "failed", error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  },
});

/**
 * Reschedule requests that were detected in mail: look the sender up in Cliniko and see whether an appointment
 * now sits on the requested date, or has moved since the request arrived. Runs hourly and right after detection.
 */
export const recheckReschedules = internalAction({
  args: {},
  handler: async (ctx) => {
    const open: Array<{ threadId: Id<"threads">; request: { senderEmail: string; fromDate?: string; toDate?: string; detectedAt: number } }> = await ctx.runQuery(internal.mail.openRescheduleRequests, {});
    if (!open.length || !process.env.CLINIKO_API_KEY) return;
    for (const { threadId, request } of open.slice(0, 40)) {
      try {
        const matches = await cliniko.searchPatients(request.senderEmail).catch(() => [] as cliniko.Patient[]);
        const patient = matches.find((p) => p.email?.toLowerCase() === request.senderEmail);
        if (!patient) continue;
        const appts = (await cliniko.patientAppointments(patient.id)).filter((a) => !a.cancelled_at);
        const onRequestedDay = request.toDate ? appts.some((a) => new Date(a.starts_at).toLocaleDateString("en-CA", { timeZone: "Australia/Melbourne" }) === request.toDate) : false;
        const movedSince = appts.some((a) => Date.parse(a.updated_at) > request.detectedAt && Date.parse(a.created_at) < request.detectedAt && Date.parse(a.starts_at) > request.detectedAt);
        if (onRequestedDay || movedSince) await ctx.runMutation(internal.mail.setRescheduled, { threadId });
      } catch (e) { console.error("recheck reschedule failed", threadId, e); }
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
