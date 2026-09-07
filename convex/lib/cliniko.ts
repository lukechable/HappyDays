/**
 * Cliniko API v1 client. Basic auth with an API key that inherits its owner's permissions; 200 requests a minute.
 * Everything here is read live; nothing about a patient is written to our database.
 */

const shard = () => process.env.CLINIKO_SHARD ?? "au1";
const base = () => `https://api.${shard()}.cliniko.com/v1`;
export const clinikoWebUrl = (path: string) => `https://${process.env.CLINIKO_SUBDOMAIN ?? "barbara-fraser-and-associates"}.${shard()}.cliniko.com${path}`;

export class ClinikoError extends Error { constructor(message: string, public status: number) { super(message); } }

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const key = process.env.CLINIKO_API_KEY;
  if (!key) throw new ClinikoError("CLINIKO_API_KEY is not set on the Convex deployment.", 500);
  const res = await fetch(path.startsWith("http") ? path : `${base()}${path}`, {
    ...init,
    headers: { Authorization: `Basic ${btoa(`${key}:`)}`, Accept: "application/json", "User-Agent": "Happy Days (luke@barbarafraser.net)", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) },
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { const j = JSON.parse(text) as { message?: string; errors?: Record<string, string[]> }; msg = j.message ?? (j.errors ? Object.entries(j.errors).map(([k, v]) => `${k} ${v.join(", ")}`).join("; ") : text); } catch { /* raw */ }
    throw new ClinikoError(msg || `Cliniko returned ${res.status}`, res.status);
  }
  return text ? (JSON.parse(text) as T) : (undefined as T);
}

type Links = { links?: { next?: string; previous?: string; self?: string } };
async function all<T>(path: string, key: string, max = 1000): Promise<T[]> {
  const out: T[] = [];
  let url: string | undefined = `${base()}${path}${path.includes("?") ? "&" : "?"}per_page=100`;
  while (url && out.length < max) {
    const page: Record<string, T[]> & Links = await call<Record<string, T[]> & Links>(url);
    out.push(...(page[key] ?? []));
    url = page.links?.next;
  }
  return out;
}

/* ------------------------------ types ------------------------------ */

export type Business = { id: string; business_name: string; display_name?: string; address_1?: string; address_2?: string; city?: string; post_code?: string; state?: string; country?: string; time_zone?: string; time_zone_identifier?: string; email_reply_to?: string; website_address?: string; show_in_online_bookings?: boolean };
export type Practitioner = { id: string; first_name: string; last_name: string; display_name?: string; title?: string; designation?: string; active: boolean; show_in_online_bookings?: boolean; description?: string; user?: { links: { self: string } } };
export type AppointmentType = { id: string; name: string; category?: string; color?: string; duration_in_minutes: number; description?: string; show_in_online_bookings: boolean; online_bookings_lead_time_hours?: number; max_attendees?: number; telehealth_enabled?: boolean; archived_at?: string | null; billable_items?: unknown; practitioners?: { links: { self: string } } };
export type Patient = { id: string; first_name: string; last_name: string; preferred_first_name?: string; title?: string; email?: string; date_of_birth?: string; sex?: string; address_1?: string; address_2?: string; city?: string; post_code?: string; state?: string; country?: string; notes?: string; created_at: string; updated_at: string; archived_at?: string | null; medical_alerts?: unknown; patient_phone_numbers?: Array<{ number: string; phone_type: string }>; referral_source?: unknown; links?: { self: string } };
export type Appointment = { id: string; starts_at: string; ends_at: string; notes?: string; cancelled_at?: string | null; cancellation_reason?: number; cancellation_note?: string; did_not_arrive?: boolean; patient_arrived?: boolean; telehealth_url?: string; online_booking_policy_accepted?: boolean; created_at: string; updated_at: string; patient?: { links: { self: string } }; practitioner?: { links: { self: string } }; appointment_type?: { links: { self: string } }; business?: { links: { self: string } }; invoices?: { links: { self: string } }; patient_name?: string; conflicts?: { exists: boolean } };
export type AvailableTime = { appointment_start: string };
export type AvailabilityBlock = { id: string; starts_at: string; ends_at: string; practitioner?: { links: { self: string } }; business?: { links: { self: string } }; deleted_at?: string | null };
export type UnavailableBlock = { id: string; starts_at: string; ends_at: string; notes?: string; practitioner?: { links: { self: string } }; business?: { links: { self: string } }; deleted_at?: string | null };
export type PatientAttachment = { id: string; description?: string; content_type?: string; filename?: string; upload_url?: string; content_url?: string; created_at: string; updated_at: string; archived_at?: string | null; user?: { links: { self: string } }; patient?: { links: { self: string } }; links?: { self: string } };
export type MedicalAlert = { id: string; name: string; created_at: string; archived_at?: string | null; patient?: { links: { self: string } } };
export type Invoice = { id: string; number: number; patient_name?: string; status: number; status_description?: string; issue_date: string; closed_at?: string | null; total_amount: number | string; net_amount?: number | string; discounted_amount?: number | string; created_at: string; updated_at: string; patient?: { links: { self: string } }; appointment?: { links: { self: string } }; online_payment_url?: string };

export const idFromLink = (link?: { links: { self: string } }) => (link ? link.links.self.split("/").pop() : undefined);

/* ------------------------------ reads ------------------------------ */

export const listBusinesses = () => all<Business>("/businesses", "businesses");
export const listPractitioners = () => all<Practitioner>("/practitioners", "practitioners");
export const getPractitioner = (id: string) => call<Practitioner>(`/practitioners/${id}`);
export const listAppointmentTypes = () => all<AppointmentType>("/appointment_types", "appointment_types");
export const listAppointmentTypesForPractitioner = (practitionerId: string) => all<AppointmentType>(`/practitioners/${practitionerId}/appointment_types`, "appointment_types");
export const getPatient = (id: string) => call<Patient>(`/patients/${id}`);
export const searchPatients = (q: string, limit = 25) => {
  const term = q.trim();
  const p = new URLSearchParams();
  if (term.includes("@")) p.append("q[]", `email:=${term}`);
  else if (/^\+?\d[\d\s]+$/.test(term)) p.append("q[]", `patient_phone_numbers.number:~${term.replace(/\s/g, "")}`);
  else {
    const [first, ...rest] = term.split(/\s+/);
    p.append("q[]", `first_name:~${first}`);
    if (rest.length) p.append("q[]", `last_name:~${rest.join(" ")}`);
  }
  p.set("per_page", String(limit));
  p.set("sort", "updated_at:desc");
  return call<{ patients: Patient[] }>(`/patients?${p}`).then((r) => r.patients);
};
export const searchPatientsByLastName = (last: string, limit = 25) => call<{ patients: Patient[] }>(`/patients?q[]=last_name:~${encodeURIComponent(last)}&per_page=${limit}&sort=updated_at:desc`).then((r) => r.patients);
export const patientAppointments = (patientId: string) => all<Appointment>(`/patients/${patientId}/appointments?sort=starts_at:desc`, "appointments", 200);
export const patientAttachments = (patientId: string) => all<PatientAttachment>(`/patients/${patientId}/patient_attachments`, "patient_attachments", 200);
export const patientMedicalAlerts = (patientId: string) => all<MedicalAlert>(`/patients/${patientId}/medical_alerts`, "medical_alerts", 50);
export const patientInvoices = (patientId: string) => all<Invoice>(`/patients/${patientId}/invoices?sort=issue_date:desc`, "invoices", 100);
export const listAppointments = (fromIso: string, toIso: string, practitionerId?: string, updatedSinceIso?: string) => {
  const p = new URLSearchParams();
  p.append("q[]", `starts_at:>=${fromIso}`);
  p.append("q[]", `starts_at:<${toIso}`);
  if (practitionerId) p.append("q[]", `practitioner_id:=${practitionerId}`);
  if (updatedSinceIso) p.append("q[]", `updated_at:>${updatedSinceIso}`);
  p.set("sort", "starts_at:asc");
  return all<Appointment>(`/individual_appointments?${p}`, "individual_appointments", 500);
};
export const getAppointment = (id: string) => call<Appointment>(`/individual_appointments/${id}`);
export const availableTimes = (businessId: string, practitionerId: string, appointmentTypeId: string, from: string, to: string) => all<AvailableTime>(`/businesses/${businessId}/practitioners/${practitionerId}/appointment_types/${appointmentTypeId}/available_times?from=${from}&to=${to}`, "available_times", 500);
export const availabilityBlocks = (fromIso: string, toIso: string) => all<AvailabilityBlock>(`/availability_blocks?q[]=starts_at:>=${fromIso}&q[]=starts_at:<${toIso}`, "availability_blocks", 500);
export const unavailableBlocks = (fromIso: string, toIso: string) => all<UnavailableBlock>(`/unavailable_blocks?q[]=starts_at:>=${fromIso}&q[]=starts_at:<${toIso}`, "unavailable_blocks", 500);
export const recentPatients = (limit = 50) => call<{ patients: Patient[] }>(`/patients?per_page=${limit}&sort=updated_at:desc`).then((r) => r.patients);
export const listInvoices = (sinceDate: string) => all<Invoice>(`/invoices?q[]=issue_date:>=${sinceDate}&sort=issue_date:desc`, "invoices", 300);
export const me = () => call<{ id: string; first_name: string; last_name: string; email: string }>("/user");

/* ------------------------------ writes ------------------------------ */

export const createPatient = (p: { first_name: string; last_name: string; email?: string; date_of_birth?: string; patient_phone_numbers?: Array<{ number: string; phone_type: "Mobile" | "Home" | "Work" | "Other" }>; notes?: string }) => call<Patient>("/patients", { method: "POST", body: JSON.stringify(p) });
export const createAppointment = (a: { appointment_type_id: string; business_id: string; practitioner_id: string; patient_id: string; starts_at: string; ends_at: string; notes?: string; online_booking_policy_accepted?: boolean }) => call<Appointment>("/individual_appointments", { method: "POST", body: JSON.stringify(a) });
export const updateAppointment = (id: string, a: Partial<{ starts_at: string; ends_at: string; notes: string; practitioner_id: string; appointment_type_id: string; did_not_arrive: boolean; patient_arrived: boolean }>) => call<Appointment>(`/individual_appointments/${id}`, { method: "PATCH", body: JSON.stringify(a) });
export const cancelAppointment = (id: string, reason = 50, note?: string) => call<Appointment>(`/individual_appointments/${id}/cancel`, { method: "PATCH", body: JSON.stringify({ cancellation_reason: reason, cancellation_note: note }) });
export const appointmentConflicts = (id: string) => call<{ conflicts?: unknown[] }>(`/individual_appointments/${id}/conflicts`);

/** Cliniko's cancellation reason codes. */
export const CANCELLATION_REASONS: Record<number, string> = { 10: "Feeling better", 20: "Condition worse", 30: "Sick", 31: "COVID-19 related", 40: "Away", 50: "Other", 60: "Work" };

/* ------------------------------ extras: notes, cases, forms, groups, billing, users ------------------------------ */

export type TreatmentNote = { id: string; title?: string; draft: boolean; finalized_at?: string | null; created_at: string; updated_at: string; author?: { links: { self: string } }; practitioner?: { links: { self: string } }; patient?: { links: { self: string } }; deleted_at?: string | null };
export type PatientCase = { id: string; name: string; notes?: string; issue_date?: string; expiry_date?: string; closed: boolean; created_at: string; updated_at: string; patient?: { links: { self: string } }; deleted_at?: string | null };
export type PatientForm = { id: string; name?: string; completed: boolean; completed_at?: string | null; email_to_patient_on_completion?: boolean; url?: string; created_at: string; updated_at: string; patient_form_template?: { links: { self: string } }; appointment?: { links: { self: string } }; deleted_at?: string | null };
export type PatientFormTemplate = { id: string; name: string; email_to_patient_on_completion?: boolean; restricted_to_practitioner?: boolean; created_at: string; archived_at?: string | null };
export type GroupAppointment = { id: string; starts_at: string; ends_at: string; max_attendees?: number; notes?: string; created_at: string; updated_at: string; appointment_type?: { links: { self: string } }; practitioner?: { links: { self: string } }; business?: { links: { self: string } }; attendees?: { links: { self: string } }; deleted_at?: string | null };
export type BillableItem = { id: string; name: string; item_code?: string; price: number | string; tax?: { links: { self: string } }; archived_at?: string | null };
export type Product = { id: string; name: string; item_code?: string; price: number | string; stock_level?: number; tax?: { links: { self: string } }; archived_at?: string | null };
export type Tax = { id: string; name: string; rate: number | string; amount?: number | string };
export type ConcessionType = { id: string; name: string; archived_at?: string | null };
export type ConcessionPrice = { id: string; price: number | string; billable_item?: { links: { self: string } }; concession_type?: { links: { self: string } } };
export type User = { id: string; first_name: string; last_name: string; display_name?: string; email: string; role?: string; active?: boolean; title?: string };

export const treatmentNotes = (patientId: string) => all<TreatmentNote>(`/patients/${patientId}/treatment_notes?sort=created_at:desc`, "treatment_notes", 20);
export const patientCases = (patientId: string) => all<PatientCase>(`/patients/${patientId}/patient_cases`, "patient_cases", 50);
export const createPatientCase = (c: { patient_id: string; name: string; notes?: string; issue_date?: string; expiry_date?: string }) => call<PatientCase>("/patient_cases", { method: "POST", body: JSON.stringify(c) });
export const patientForms = (patientId: string) => all<PatientForm>(`/patients/${patientId}/patient_forms?sort=created_at:desc`, "patient_forms", 50);
export const patientFormTemplates = () => all<PatientFormTemplate>("/patient_form_templates", "patient_form_templates", 100);
export const createPatientForm = (f: { patient_form_template_id: string; patient_id: string; appointment_id?: string; email_to_patient_on_completion?: boolean }) => call<PatientForm>("/patient_forms", { method: "POST", body: JSON.stringify(f) });
export const groupAppointments = (fromIso: string, toIso: string) => all<GroupAppointment>(`/group_appointments?q[]=starts_at:>=${fromIso}&q[]=starts_at:<${toIso}&sort=starts_at:asc`, "group_appointments", 200);
export const attendeeCount = (groupId: string) => call<{ attendees?: unknown[]; total_entries?: number }>(`/group_appointments/${groupId}/attendees?per_page=1`).then((r) => r.total_entries ?? r.attendees?.length ?? 0);
export const listBillableItems = () => all<BillableItem>("/billable_items", "billable_items", 300);
export const listProducts = () => all<Product>("/products", "products", 300);
export const listTaxes = () => all<Tax>("/taxes", "taxes", 50);
export const listConcessionTypes = () => all<ConcessionType>("/concession_types", "concession_types", 50);
export const listConcessionPrices = () => all<ConcessionPrice>("/concession_prices", "concession_prices", 1000);
export const listUsers = () => all<User>("/users", "users", 100);
export type InvoiceCreate = { patient_id: string; business_id: string; practitioner_id: string; appointment_id?: string; issue_date: string; notes?: string; invoice_items: Array<{ billable_item_id?: string; product_id?: string; quantity: number; unit_price: number; tax_id?: string; concession_type_id?: string; discount_percentage?: number; name?: string }> };
export const createInvoice = (i: InvoiceCreate) => call<Invoice>("/invoices", { method: "POST", body: JSON.stringify(i) });
