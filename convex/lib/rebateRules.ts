/** Shared server rules; deliberately independent of SDK/UI state. */
export const PRE_LAUNCH_REASON = "This appointment took place before HappyDays went live and is not eligible for rebate processing through HappyDays.";
export function dateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
export function serviceDate(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(iso));
  return ["year", "month", "day"].map((type) => parts.find((p) => p.type === type)!.value).join("-");
}
export function cents(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || !/^\d+(\.\d{1,2})?$/.test(String(value))) return null;
  const amount = Math.round(Number(value) * 100);
  return Number.isSafeInteger(amount) ? amount : null;
}
export type EligibilityInput = {
  now: number; goLiveAt: number | null; startsAt: string; endsAt: string;
  attended: boolean; cancelled: boolean; didNotArrive: boolean;
  paid: boolean; amountCents: number | null; patientMatches: boolean;
  referral: boolean; reviewed: boolean; archived: boolean;
  issueDate?: string | null; expiryDate?: string | null;
  maxSessions?: number | null; sessionNumber: number | null;
  duplicate: boolean;
};
export function eligibilityReasons(a: EligibilityInput): string[] {
  const reasons: string[] = [];
  const start = Date.parse(a.startsAt), end = Date.parse(a.endsAt);
  if (!Number.isFinite(a.goLiveAt)) reasons.push("The fixed HappyDays go-live cutoff has not been configured.");
  else if (start < a.goLiveAt!) reasons.push(PRE_LAUNCH_REASON);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end > a.now) reasons.push("The session must have finished.");
  if (!a.attended || a.cancelled || a.didNotArrive) reasons.push("Attendance must be explicitly confirmed; cancelled and did-not-arrive appointments cannot be claimed.");
  if (!a.paid || !a.amountCents || a.amountCents < 0) reasons.push("The session invoice must be fully paid. Closed, unpaid and partially paid invoices are not eligible.");
  if (!a.patientMatches) reasons.push("The appointment, invoice and case must belong to the same patient.");
  if (!a.referral || a.archived) reasons.push("A Medicare referral case must cover this session.");
  if (!a.reviewed) reasons.push("Verify the care plan/referral against the current Cliniko case before claiming.");
  const day = Number.isFinite(start) ? serviceDate(a.startsAt) : "";
  if (!a.issueDate || !dateOnly(a.issueDate) || a.issueDate > day) reasons.push("The referral must have a valid issue date covering the service date.");
  if (a.expiryDate && (!dateOnly(a.expiryDate) || a.expiryDate < day)) reasons.push("The recorded referral expiry does not cover the service date.");
  if (!Number.isInteger(a.maxSessions) || !a.maxSessions || a.maxSessions < 1 || !a.sessionNumber || a.sessionNumber > a.maxSessions) reasons.push("This session does not have an available allocation on the referral.");
  if (a.duplicate) reasons.push("A rebate attempt already exists for this appointment. Reconcile it before attempting another claim.");
  return reasons;
}
export function blocksRetry(status: string): boolean {
  // A browser cancellation/error is NOT evidence that Medicare did not receive the claim.
  return !["not_launched", "rejected", "cancelled"].includes(status);
}
export function verifiedTyroStatus(transaction: { claims?: Array<{ status?: string }>; businessStatus?: string }): string {
  const statuses = transaction.claims?.map((c) => c.status?.toLowerCase()) ?? [];
  if (!statuses.length) return transaction.businessStatus === "cancelled" ? "cancelled" : "pending";
  if (statuses.every((s) => s === "approved")) return "approved";
  if (statuses.every((s) => s === "rejected")) return "rejected";
  if (statuses.every((s) => s === "cancelled")) return "cancelled";
  if (statuses.some((s) => s === "under-review")) return "under_review";
  return "pending";
}
