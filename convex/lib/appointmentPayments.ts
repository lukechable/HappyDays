import type { AppointmentType, BillableItem, Product, AppointmentCharge, Tax } from "./cliniko";

export const cents = (value: string | number | null | undefined): number | null => {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
};

/** Cliniko's linked items already carry their configured prices; never infer a fee from the type name. */
export function appointmentPayment(t: AppointmentType, charges: AppointmentCharge[], items: BillableItem[], products: Product[], taxes: Tax[] = [], calculationMethod: number | null = null) {
  const linked = charges.filter(c => c.appointmentTypeId === t.id);
  // Legacy types can still expose the singular relation.
  if (!linked.length) {
    const id = (r?: { links: { self: string } }) => r?.links.self.split("/").pop();
    if (t.billable_item) linked.push({ appointmentTypeId: t.id, itemId: id(t.billable_item)!, kind: "service", quantity: "1" });
    if (t.product) linked.push({ appointmentTypeId: t.id, itemId: id(t.product)!, kind: "product", quantity: "1" });
  }
  let feeCents: number | null = linked.length ? 0 : null;
  for (const c of linked) {
    const item = c.kind === "service" ? items.find(i => i.id === c.itemId) : products.find(i => i.id === c.itemId);
    const taxId = item?.tax?.links.self.split("/").pop();
    const tax = taxId ? taxes.find(t => t.id === taxId) : undefined;
    const rate = taxId ? Number(tax?.rate) : 0;
    const isInclusive = calculationMethod === 3;
    const rawPrice = c.kind === "service" ? (item as BillableItem | undefined)?.price : isInclusive ? (item as Product | undefined)?.price_including_tax : (item as Product | undefined)?.price_ex_tax;
    const price = rawPrice == null || rawPrice === "" ? NaN : Number(rawPrice);
    const quantity = Number(c.quantity);
    const percent = Number(c.discountPercentage ?? 0);
    const discount = Number(c.discountedAmount ?? 0);
    if (!Number.isFinite(price) || price < 0 || !Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(percent) || percent < 0 || percent > 100 || !Number.isFinite(discount) || discount < 0 || !Number.isFinite(rate) || (taxId && ![1, 2, 3].includes(calculationMethod ?? 0))) { feeCents = null; break; }
    const gross = price * quantity;
    const net = Math.max(0, c.monetaryDiscount ? gross - discount : gross * (1 - percent / 100));
    // Preserve Cliniko's decimal precision until tax and quantity are applied.
    feeCents! += Math.round(net * (isInclusive ? 1 : 1 + rate / 100) * 100);

  }
  const mode = t.online_payments_enabled === false ? "disabled" : t.online_payments_mode ?? "unknown";
  return { mode, feeCents, depositCents: mode === "deposit_required" ? cents(t.deposit_price) : null };
}
