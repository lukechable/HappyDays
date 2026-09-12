import { expect, test } from "vitest";
import { matchEft, type EftInvoice, type EftTransaction } from "../src/lib/eft-matching";
import { appointmentPayment } from "../convex/lib/appointmentPayments";
import type { AppointmentType, AppointmentCharge } from "../convex/lib/cliniko";
const invoice: EftInvoice = { id: "i1", number: 1234, patientName: "Alice Smith", total: 250, openAmount: 250, appointmentAt: "2026-09-12T23:30:00Z" };
const tx: EftTransaction = { id: "t1", description: "ALICE SMITH 1234", amountCents: 25000, direction: "credit", status: "posted", postDate: "2026-09-13T12:00:00Z", accountId: "a1" };
const match = (i = invoice, t = tx, days = 7) => matchEft([i], [t], days).get(i.id) ?? [];
test("amount, reference and Melbourne appointment date form a strong candidate, never alter amount owing", () => {
  expect(match()[0]).toMatchObject({ confidence: "strong", daysFromAppointment: 0 });
  expect(invoice.openAmount).toBe(250);
});
test("old payments, pending entries, debits and malformed amounts cannot match", () => {
  for (const patch of [{ postDate: "2026-08-01" }, { status: "pending" }, { status: "unknown" }, { direction: "debit" as const }, { amountCents: NaN }, { amountCents: 0 }]) expect(match(invoice, { ...tx, ...patch })).toEqual([]);
});
test("invoice issue date is never substituted for a missing appointment date", () => expect(match({ ...invoice, appointmentAt: null })).toEqual([]));
test("reference tokens cannot match another invoice number or a surname substring", () => expect(match(invoice, { ...tx, description: "912345 SMITHSON", amountCents: 40000 })).toEqual([]));
test("part payments and amount-only coincidences require investigation", () => {
  expect(match(invoice, { ...tx, amountCents: 15000 })[0].confidence).toBe("review");
  expect(match(invoice, { ...tx, description: "TRANSFER" })[0].confidence).toBe("review");
  expect(match(invoice, { ...tx, description: "TRANSFER", postDate: "2026-09-16" })).toEqual([]);
});
test("one transaction possibly covering several invoices is marked ambiguous, including paid invoices", () => {
  const second = { ...invoice, id: "i2", number: 5678, openAmount: 0 };
  const c = matchEft([invoice, second], [tx]).get("i1")![0];
  expect(c.confidence).toBe("review"); expect(c.otherInvoiceNumbers).toEqual([5678]);
});
test("transaction date controls matching across bank posting delays and window boundaries", () => {
  expect(match(invoice, { ...tx, transactionDate: "2026-09-13T01:00:00Z", postDate: "2026-09-20" }, 1)).toHaveLength(1);
  expect(match(invoice, { ...tx, postDate: "2026-09-20T01:00:00Z" }, 7)).toHaveLength(1);
  expect(match(invoice, { ...tx, postDate: "2026-09-21T01:00:00Z" }, 7)).toHaveLength(0);
});
const type: AppointmentType = { id: "a", name: "Report", duration_in_minutes: 240, show_in_online_bookings: true, online_payments_enabled: true, online_payments_mode: "deposit_required", deposit_price: "1500.0" };
const charge: AppointmentCharge = { appointmentTypeId: "a", itemId: "service", kind: "service", quantity: "1" };
test("real Cliniko deposit and linked fee replace zero defaults", () => expect(appointmentPayment(type, [charge], [{ id: "service", name: "Report fee", price: "9000.0" }], [])).toEqual({ mode: "deposit_required", feeCents: 900000, depositCents: 150000 }));
test("optional, required and disabled booking payment modes remain distinct", () => {
  expect(appointmentPayment({ ...type, online_payments_mode: "optional" }, [], [], []).mode).toBe("optional");
  expect(appointmentPayment({ ...type, online_payments_mode: "required" }, [], [], []).mode).toBe("required");
  expect(appointmentPayment({ ...type, online_payments_enabled: false }, [], [], []).mode).toBe("disabled");
});
test("missing fee or deposit stays unknown instead of appearing free", () => {
  expect(appointmentPayment({ ...type, deposit_price: null }, [], [], [])).toMatchObject({ feeCents: null, depositCents: null });
  expect(appointmentPayment(type, [charge], [], []).feeCents).toBeNull();
});
test("multiple linked items, quantities, discounts and products contribute to the fee", () => {
  const c = [ { ...charge, quantity: "2", discountPercentage: "10" }, { ...charge, itemId: "p", kind: "product" as const, monetaryDiscount: true, discountedAmount: "5" } ];
  expect(appointmentPayment(type, c, [{ id: "service", name: "Fee", price: "100" }], [{ id: "p", name: "Product", price: 0, price_including_tax: "25", price_ex_tax: "25" }]).feeCents).toBe(20000);
});

test("tax-exclusive decimal prices include GST without premature cent rounding", () => {
  const item = { id: "service", name: "Update report", price: "7272.727", tax: { links: { self: "https://api.au1.cliniko.com/v1/taxes/gst" } } };
  expect(appointmentPayment(type, [charge], [item], [], [{ id: "gst", name: "GST", rate: "10.0" }], 1).feeCents).toBe(800000);
  expect(appointmentPayment(type, [charge], [{ ...item, price: "8000" }], [], [{ id: "gst", name: "GST", rate: "10.0" }], 3).feeCents).toBe(800000);
  expect(appointmentPayment(type, [charge], [item], [], []).feeCents).toBeNull();
});
