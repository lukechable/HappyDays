export type EftInvoice = { id: string; number: number; patientName: string; patientNames?: string[]; total: number; openAmount: number; appointmentAt: string | null };
export type EftTransaction = { id: string; description: string; amountCents: number; direction: "credit" | "debit"; postDate: string; transactionDate?: string; status: string; accountId: string; accountName?: string };
export type EftCandidate = { transaction: EftTransaction; daysFromAppointment: number; confidence: "strong" | "review"; reasons: string[]; otherInvoiceNumbers: number[] };
const words = (s: string): string[] => s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().match(/[a-z0-9]+/g) ?? [];
const dayFormat = new Intl.DateTimeFormat("en-AU", { timeZone: "Australia/Melbourne", year: "numeric", month: "2-digit", day: "2-digit" });
function localDay(s: string): number | null {
  const date = new Date(s);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = dayFormat.formatToParts(date);
  const part = (type: string) => Number(parts.find(p => p.type === type)?.value);
  return Date.UTC(part("year"), part("month") - 1, part("day")) / 86_400_000;
}
/** Suggestions only. A bank credit never changes an invoice's status or outstanding estimate. */
export function matchEft(invoices: EftInvoice[], transactions: EftTransaction[], windowDays = 7): Map<string, EftCandidate[]> {
  const result = new Map<string, EftCandidate[]>();
  const uses = new Map<string, Set<number>>();
  const credits = transactions.filter(t => t.direction === "credit" && t.status.toLowerCase() === "posted" && Number.isSafeInteger(t.amountCents) && t.amountCents > 0)
    .map(t => ({ transaction: t, day: localDay(t.transactionDate || t.postDate), reference: words(t.description) }));
  const invoiceNumbers = new Map(invoices.map(i => [i.id, i.number]));
  for (const i of invoices) {
    const appointmentDay = i.appointmentAt ? localDay(i.appointmentAt) : null;
    if (appointmentDay === null || i.total <= 0) continue;
    const names = [i.patientName, ...(i.patientNames ?? [])].map(n => words(n).filter(w => !["mr", "mrs", "ms", "miss", "dr"].includes(w)));
    const candidates: EftCandidate[] = [];
    for (const { transaction: t, day: bankDay, reference } of credits) {
      if (bankDay === null) continue;
      const days = bankDay - appointmentDay;
      if (Math.abs(days) > windowDays) continue;
      const invoiceNumber = reference.includes(String(i.number));
      const surnameMatches = names.filter(name => { const surname = name.at(-1); return !!surname && surname.length >= 3 && reference.includes(surname); });
      const surnameMatch = surnameMatches.length > 0;
      const fullName = surnameMatches.some(name => name.length > 1 && reference.includes(name[0]));
      const amount = t.amountCents === Math.round(i.total * 100);
      if (!invoiceNumber && !surnameMatch && !(amount && Math.abs(days) <= 1)) continue;
      const reasons = [invoiceNumber ? "Invoice number in reference" : fullName ? "Patient name in reference" : surnameMatch ? "Surname in reference" : "No patient reference", amount ? "Matches invoice total" : "Different amount — possible deposit or part payment"];
      candidates.push({ transaction: t, daysFromAppointment: days, confidence: amount && (invoiceNumber || fullName) ? "strong" : "review", reasons, otherInvoiceNumbers: [] });
      const set = uses.get(t.id) ?? new Set<number>(); set.add(i.number); uses.set(t.id, set);
    }
    if (i.openAmount > 0) result.set(i.id, candidates);
  }
  for (const [id, candidates] of result) {
    const number = invoiceNumbers.get(id)!;
    for (const c of candidates) {
      c.otherInvoiceNumbers = [...uses.get(c.transaction.id)!].filter(n => n !== number);
      if (c.otherInvoiceNumbers.length) c.confidence = "review";
    }
    candidates.sort((a, b) => Number(b.confidence === "strong") - Number(a.confidence === "strong") || Math.abs(a.daysFromAppointment) - Math.abs(b.daysFromAppointment));
  }
  return result;
}
