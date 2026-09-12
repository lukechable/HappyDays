import { action, internalAction } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { MedicareCreateTransactionPayload } from "@medipass/partner-sdk";
import type { ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import * as cliniko from "./lib/cliniko";
import * as tyro from "./lib/tyro";
import { blocksRetry, cents, dateOnly, eligibilityReasons, serviceDate } from "./lib/rebateRules";

async function staff(ctx: ActionCtx): Promise<{ _id: Id<"users">; email: string; name: string }> {
  const user = await ctx.runQuery(internal.bookings.requireStaff, {});
  if (user.email.startsWith("guest@")) throw new Error("Guest accounts cannot manage Medicare rebates.");
  return user;
}

export const patientOptions = action({ args: { patientId: v.string() }, handler: async (ctx, a) => {
  await staff(ctx);
  const [cases, appointments] = await Promise.all([cliniko.patientCases(a.patientId), cliniko.rebateAppointments(a.patientId)]);
  return {
    cases: cases.filter((c) => !c.archived_at).map((c) => ({ id: c.id, name: c.name, maxSessions: c.max_sessions ?? null, issueDate: c.issue_date ?? null, expiryDate: c.expiry_date ?? null, medicare: c.referral_type === "medicare", updatedAt: c.updated_at })),
    appointments: appointments.map((a) => ({ id: a.id, startsAt: a.starts_at, endsAt: a.ends_at, attended: a.patient_arrived === true, cancelled: !!a.cancelled_at, didNotArrive: !!a.did_not_arrive })),
  };
} });

type Inspection = { appointment: cliniko.Appointment; plan: cliniko.PatientCase; patientId: string | undefined; attendee: cliniko.Attendee | undefined; invoice: cliniko.RebateInvoice | undefined; amountCents: number | null; sessionNumber: number | null; reasons: string[]; paid: boolean; reviewed: boolean };
async function inspect(ctx: ActionCtx, appointmentId: string, caseId: string): Promise<Inspection> {
  const [appointment, plan, attendees, caseAttendees, bookings, invoices, state] = await Promise.all([
    cliniko.getAppointment(appointmentId), cliniko.getPatientCase(caseId), cliniko.bookingAttendees(appointmentId),
    cliniko.caseAttendees(caseId), cliniko.caseBookings(caseId), cliniko.appointmentInvoices(appointmentId),
    ctx.runQuery(internal.rebateData.context, { caseId, appointmentId }),
  ]);
  const patientId = cliniko.idFromLink(appointment.patient);
  const attendee = attendees.find((a) => cliniko.idFromLink(a.patient) === patientId && !a.archived_at && !a.deleted_at);
  const linked = attendee && cliniko.idFromLink(attendee.patient_case) === caseId;
  const activeInvoices = invoices.filter((i) => !i.archived_at && !i.deleted_at);
  // Multiple/reversed/consolidated invoices require staff reconciliation; never infer payment from closed_at.
  const invoice = activeInvoices.length === 1 ? activeInvoices[0] : undefined;
  let paid = invoice?.status === 20;
  const amountCents = cents(invoice?.total_amount);
  const bookingPayment = state.bookingPayments.length === 1 ? state.bookingPayments[0] : undefined;
  if (bookingPayment?.mode === "full") {
    // A stale Cliniko "Paid" flag cannot override a known Stripe refund or dispute.
    paid = !!invoice && [10, 20].includes(invoice.status) && !!amountCents && bookingPayment.status === "booked" && bookingPayment.clinikoPatientId === patientId && !!bookingPayment.stripeCheckoutSessionId && bookingPayment.amountCents >= amountCents
      && await ctx.runAction(internal.stripe.verifyRebatePayment, { checkoutId: bookingPayment.stripeCheckoutSessionId, bookingSessionId: bookingPayment._id, requiredCents: amountCents });
  }
  const bookingMap = new Map(bookings.map((b) => [b.id, b]));
  let incomplete = false;
  const counted = caseAttendees.filter((a) => {
    if (a.archived_at || a.deleted_at) return false;
    const b = bookingMap.get(cliniko.idFromLink(a.booking) ?? "");
    if (!b || !Number.isFinite(Date.parse(b.starts_at))) { incomplete = true; return false; }
    if ((a.cancelled_at || b.cancelled_at) && !plan.include_cancelled_attendees) return false;
    if (b.did_not_arrive && !plan.include_dna_attendees) return false;
    return true;
  }).sort((a, b) => {
    const left = bookingMap.get(cliniko.idFromLink(a.booking)!)!, right = bookingMap.get(cliniko.idFromLink(b.booking)!)!;
    return Date.parse(left.starts_at) - Date.parse(right.starts_at) || a.id.localeCompare(b.id);
  });
  const index = counted.findIndex((a) => a.id === attendee?.id);
  const sessionNumber = linked && !incomplete && index >= 0 ? index + 1 : null;
  const reviewed = state.review?.caseUpdatedAt === plan.updated_at && state.review?.patientId === patientId;
  const reasons = eligibilityReasons({ now: Date.now(), goLiveAt: state.goLiveAt, startsAt: appointment.starts_at, endsAt: appointment.ends_at,
    attended: appointment.patient_arrived === true && attendee?.arrived === true,
    cancelled: !!appointment.cancelled_at || !!appointment.archived_at || !!appointment.deleted_at || !!attendee?.cancelled_at, didNotArrive: appointment.did_not_arrive === true,
    paid, amountCents, patientMatches: !!patientId && patientId === cliniko.idFromLink(plan.patient) && patientId === cliniko.idFromLink(invoice?.patient),
    referral: plan.referral === true && plan.referral_type === "medicare", reviewed, archived: !!plan.archived_at,
    issueDate: plan.issue_date, expiryDate: plan.expiry_date, maxSessions: plan.max_sessions, sessionNumber,
    duplicate: state.claims.some((c) => blocksRetry(c.status)),
  });
  if (!linked) reasons.push("Link this appointment to the referral case before claiming.");
  if (plan.max_sessions && state.caseClaims.filter((c) => blocksRetry(c.status)).length >= plan.max_sessions) reasons.push("The referral has no remaining claim allocation.");
  if (activeInvoices.length !== 1) reasons.push("Exactly one active session invoice is required; review the invoices in Cliniko.");
  return { appointment, plan, patientId, attendee, invoice, amountCents, sessionNumber, reasons, paid, reviewed };
}

export const check = action({ args: { appointmentId: v.string(), caseId: v.string() }, handler: async (ctx, a) => {
  await staff(ctx);
  const r = await inspect(ctx, a.appointmentId, a.caseId);
  return { reasons: r.reasons, ready: r.reasons.length === 0, sessionNumber: r.sessionNumber, maxSessions: r.plan.max_sessions ?? null,
    amountCents: r.amountCents, paid: r.paid, attended: r.appointment.patient_arrived === true && r.attendee?.arrived === true,
    reviewed: r.reviewed, caseUpdatedAt: r.plan.updated_at,
    invoiceId: r.invoice?.id ?? null, invoiceNumber: r.invoice?.number ?? null,
    serviceDate: serviceDate(r.appointment.starts_at),
    clinikoUrl: cliniko.clinikoWebUrl(`/patients/${r.patientId}/cases/${a.caseId}`) };
} });

export const verifyReferral = action({ args: { caseId: v.string(), patientId: v.string(), expectedUpdatedAt: v.string() }, handler: async (ctx, a) => {
  const user = await staff(ctx), plan = await cliniko.getPatientCase(a.caseId);
  if (plan.updated_at !== a.expectedUpdatedAt) throw new Error("The case changed. Refresh and review it again.");
  if (cliniko.idFromLink(plan.patient) !== a.patientId || plan.referral_type !== "medicare" || plan.referral !== true || plan.archived_at || !plan.issue_date || !dateOnly(plan.issue_date) || !plan.max_sessions) throw new Error("The case needs a Medicare referral, issue date and session allowance before verification.");
  await ctx.runMutation(internal.rebateData.review, { caseId: a.caseId, patientId: a.patientId, caseUpdatedAt: plan.updated_at, userId: user._id });
} });

export const linkCase = action({ args: { appointmentId: v.string(), caseId: v.string() }, handler: async (ctx, a) => {
  const user = await staff(ctx);
  const [appointment, plan, attendees, state] = await Promise.all([cliniko.getAppointment(a.appointmentId), cliniko.getPatientCase(a.caseId), cliniko.bookingAttendees(a.appointmentId), ctx.runQuery(internal.rebateData.context, a)]);
  if (state.claims.some((c) => blocksRetry(c.status))) throw new Error("Reconcile the existing rebate before changing its case.");
  const patientId = cliniko.idFromLink(appointment.patient);
  if (!patientId || patientId !== cliniko.idFromLink(plan.patient) || plan.archived_at) throw new Error("The case must belong to this patient and be active.");
  const attendee = attendees.find((x) => cliniko.idFromLink(x.patient) === patientId && !x.archived_at && !x.deleted_at);
  if (!attendee) throw new Error("No active patient attendee found.");
  await cliniko.setAttendeeCase(attendee.id, a.caseId);
  await ctx.runMutation(internal.bookings.logAccess, { userId: user._id, action: "rebate.caseLinked", subjectId: a.appointmentId });
} });

export const prepare = action({ args: {
  appointmentId: v.string(), caseId: v.string(), providerNumber: v.string(), referrerProviderNumber: v.string(), itemCode: v.string(),
  claimant: v.optional(v.object({ firstName: v.string(), lastName: v.string(), dob: v.string(), accountNumber: v.string(), reference: v.string() })),
  entitlementConfirmed: v.boolean(), noOtherClaimConfirmed: v.boolean(), serviceConfirmed: v.boolean(),
}, handler: async (ctx, a): Promise<{ claimId: Id<"rebateClaims">; token: string; appId: string; payload: MedicareCreateTransactionPayload }> => {
  const user = await staff(ctx);
  tyro.tyroConfig(); // Fail before reading patient details if the production integration is unavailable.
  if (!a.entitlementConfirmed || !a.noOtherClaimConfirmed || !a.serviceConfirmed) throw new Error("Confirm Medicare entitlement, service details and that this service has not been claimed elsewhere.");
  if (!/^\d{6}[A-Z0-9]{2}$/.test(a.providerNumber) || !/^\d{6}[A-Z0-9]{2}$/.test(a.referrerProviderNumber) || !/^\d{1,8}$/.test(a.itemCode)) throw new Error("Enter valid provider numbers and an MBS item number.");
  // Always read fresh at submission time; the UI's cached eligibility is advisory only.
  const r = await inspect(ctx, a.appointmentId, a.caseId);
  if (r.reasons.length) throw new Error(r.reasons.join("\n"));
  const practitionerId = cliniko.idFromLink(r.appointment.practitioner), businessId = cliniko.idFromLink(r.appointment.business);
  if (!practitionerId || !businessId) throw new Error("The appointment needs a practitioner and business location.");
  const references = await cliniko.practitionerReferences(practitionerId, businessId);
  if (!references.some((p) => p.reference_number?.replace(/\s/g, "").toUpperCase() === a.providerNumber)) throw new Error("The treating provider number must match this practitioner and location in Cliniko.");
  const patient = await cliniko.getPatient(r.patientId!);
  if (!patient.medicare || !/^\d{10}$/.test(patient.medicare.replace(/\s/g, "")) || !/^[1-9]$/.test(patient.medicare_reference_number ?? "") || !patient.date_of_birth || !dateOnly(patient.date_of_birth)) throw new Error("Complete the patient's Medicare card, reference number and date of birth in Cliniko.");
  const serviceDay = serviceDate(r.appointment.starts_at);
  const ageAtService = Number(serviceDay.slice(0, 4)) - Number(patient.date_of_birth.slice(0, 4)) - (serviceDay.slice(5) < patient.date_of_birth.slice(5) ? 1 : 0);
  if (ageAtService < 15 && !a.claimant) throw new Error("Add an adult claimant for a patient under 15.");
  if (a.claimant) {
    const c = a.claimant;
    const age = Number(serviceDay.slice(0, 4)) - Number(c.dob.slice(0, 4)) - (serviceDay.slice(5) < c.dob.slice(5) ? 1 : 0);
    if (!c.firstName.trim() || !c.lastName.trim() || !dateOnly(c.dob) || age < 18 || !/^\d{10}$/.test(c.accountNumber) || !/^[1-9]$/.test(c.reference)) throw new Error("Enter the adult claimant's full Medicare details and date of birth.");
  }
  const invoiceReference = `HD${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
  const claimId = await ctx.runMutation(internal.rebateData.reserve, {
    appointmentId: a.appointmentId, patientId: r.patientId!, caseId: a.caseId, invoiceId: r.invoice!.id,
    serviceDate: serviceDay, amountCents: r.amountCents!, itemCode: a.itemCode, invoiceReference,
    userId: user._id, caseUpdatedAt: r.plan.updated_at, startsAt: Date.parse(r.appointment.starts_at), maxSessions: r.plan.max_sessions!,
  });
  let token: { token: string; appId: string };
  try { token = await tyro.sdkToken(); }
  catch (error) {
    // Nothing has been handed to a browser or submitted to Medicare yet: retry is safe.
    await ctx.runMutation(internal.rebateData.outcome, { id: claimId, status: "not_launched" });
    throw error;
  }
  return { claimId, token: token.token, appId: token.appId, payload: {
    funder: "medicare" as const, providerNumber: a.providerNumber, invoiceReference,
    allowEdit: false, disableModifyServiceItems: true, disableDiscounts: true,
    patient: { firstName: patient.first_name, lastName: patient.last_name, dob: patient.date_of_birth,
      accountNumber: patient.medicare.replace(/\s/g, ""), reference: patient.medicare_reference_number!, refId: patient.id },
    claimableItems: [{ itemCode: a.itemCode, serviceDateString: serviceDay, price: (r.amountCents! / 100).toFixed(2) }],
    funderData: { medicare: { isBulkBilled: false, ...(a.claimant ? { claimant: a.claimant } : {}), referral: { providerNumber: a.referrerProviderNumber, issueDateString: r.plan.issue_date! } } },
  } };
} });

/** Never trust client callbacks for approval or retry permission. Read Tyro by our unique reference. */
export const reconcile = action({ args: { claimId: v.id("rebateClaims") }, handler: async (ctx, a) => {
  await staff(ctx);
  const claim = await ctx.runQuery(internal.rebateData.get, { id: a.claimId });
  if (!claim) throw new Error("Claim not found.");
  const result = await tyro.readClaim(claim.invoiceReference);
  await ctx.runMutation(internal.rebateData.outcome, { id: a.claimId, ...result });
  return result;
} });
export const poll = internalAction({ args: {}, handler: async (ctx) => {
  if (process.env.TYRO_ENV !== "prod" || !process.env.TYRO_API_KEY || !process.env.TYRO_APP_ID || !process.env.TYRO_BUSINESS_ID) return;
  const claims = await ctx.runMutation(internal.rebateData.pending, {});
  for (const claim of claims) {
    try {
      const result = await tyro.readClaim(claim.invoiceReference);
      await ctx.runMutation(internal.rebateData.outcome, { id: claim._id, ...result });
    } catch { /* An absent/ambiguous response never releases the duplicate lock. Staff can reconcile later. */ }
  }
} });
