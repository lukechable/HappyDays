/** Report alerts require an open, linked matter; void/draft invoices are never debts to chase. */
export function invoiceFlag(status: string, matter?: { status: string; reportDeliveredAt?: number }) {
  const due = status === "open" || status === "uncollectible";
  if (matter && matter.status !== "closed") {
    if (status === "paid" && !matter.reportDeliveredAt) return "paid_not_delivered";
    if (due && matter.reportDeliveredAt) return "delivered_unpaid";
  }
  return status === "paid" ? "complete" : due ? "open" : "other";
}
