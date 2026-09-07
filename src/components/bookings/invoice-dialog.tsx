"use client";

import { useMemo, useState } from "react";
import { useAction } from "convex/react";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Loading, ErrorBox } from "@/components/primitives";
import { useLive } from "@/lib/hooks";
import { errorMessage } from "@/lib/utils";

type Line = { key: string; billableItemId?: string; productId?: string; name: string; quantity: number; unitPrice: number; taxId?: string; concessionTypeId?: string; discountPercentage?: number };

/**
 * Raise a Cliniko invoice for an appointment from Happy Days: billable items and products from Cliniko's own
 * catalogue, concession pricing where one exists, taxes as configured there. The invoice is created in Cliniko
 * and opened there for payment.
 */
export function InvoiceDialog({ patientId, patientName, businessId, practitionerId, appointmentId, typeName, onClose, onCreated }: { patientId: string; patientName: string; businessId: string; practitionerId: string; appointmentId?: string; typeName?: string; onClose: () => void; onCreated?: (r: { number: number; clinikoUrl: string }) => void }) {
  const cat = useLive(api.bookings.billingCatalogue, {});
  const create = useAction(api.bookings.createClinikoInvoice);
  const [lines, setLines] = useState<Line[]>([]);
  const [concession, setConcession] = useState("");
  const [notes, setNotes] = useState("");
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const priceFor = (itemId: string, base: number) => { const cp = cat.data?.concessionPrices.find((c) => c.itemId === itemId && c.concessionTypeId === concession); return cp ? cp.price : base; };
  const taxRate = (taxId?: string) => cat.data?.taxes.find((t) => t.id === taxId)?.rate ?? 0;
  const total = useMemo(() => lines.reduce((s, l) => s + l.quantity * l.unitPrice * (1 - (l.discountPercentage ?? 0) / 100), 0), [lines]);
  const add = (value: string) => {
    if (!cat.data || !value) return;
    const [kind, id] = value.split(":");
    const src = kind === "item" ? cat.data.items.find((i) => i.id === id) : cat.data.products.find((p) => p.id === id);
    if (!src) return;
    setLines((l) => [...l, { key: crypto.randomUUID(), billableItemId: kind === "item" ? id : undefined, productId: kind === "product" ? id : undefined, name: src.name, quantity: 1, unitPrice: kind === "item" ? priceFor(id, src.price) : src.price, taxId: src.taxId, concessionTypeId: kind === "item" && concession ? concession : undefined }]);
    setPick("");
  };
  const submit = async () => {
    setBusy(true);
    try {
      const r = await create({ patientId, businessId, practitionerId, appointmentId, notes: notes || undefined, items: lines.map(({ billableItemId, productId, quantity, unitPrice, taxId, concessionTypeId, discountPercentage }) => ({ billableItemId, productId, quantity, unitPrice, taxId, concessionTypeId, discountPercentage })) });
      toast.success(`Invoice #${r.number} created in Cliniko`, { action: { label: "Open", onClick: () => window.open(r.clinikoUrl, "_blank") } });
      onCreated?.(r); onClose();
    } catch (e) { toast.error(errorMessage(e)); }
    finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl bg-card p-5 shadow-float" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="New Cliniko invoice">
        <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><h2 className="font-display text-xl">Invoice in Cliniko</h2><p className="text-sm text-fg-secondary">{patientName}{typeName ? ` · ${typeName}` : ""}</p></div><button type="button" onClick={onClose} className="rounded p-1 hover:bg-muted" aria-label="Close"><X className="size-4" /></button></div>
        {cat.error ? <ErrorBox title="Couldn’t load the Cliniko catalogue" message={cat.error} retry={cat.reload} /> : !cat.data ? <Loading rows={3} className="mt-4" /> : (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <select value={pick} onChange={(e) => add(e.target.value)} className="h-9 min-w-[260px] flex-1 rounded-lg border border-input bg-card px-2">
                <option value="">Add an item…</option>
                <optgroup label="Billable items">{cat.data.items.map((i) => <option key={i.id} value={`item:${i.id}`}>{i.code ? `${i.code} · ` : ""}{i.name} — ${priceFor(i.id, i.price).toFixed(2)}</option>)}</optgroup>
                {cat.data.products.length > 0 && <optgroup label="Products">{cat.data.products.map((p) => <option key={p.id} value={`product:${p.id}`}>{p.name} — ${p.price.toFixed(2)}{p.stock !== undefined ? ` (${p.stock} in stock)` : ""}</option>)}</optgroup>}
              </select>
              {cat.data.concessionTypes.length > 0 && <select value={concession} onChange={(e) => setConcession(e.target.value)} className="h-9 rounded-lg border border-input bg-card px-2"><option value="">No concession</option>{cat.data.concessionTypes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
            </div>
            {lines.length === 0 ? <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-fg-tertiary">Pick items from Cliniko’s catalogue. Concession prices apply automatically where Cliniko has one.</p> : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wider text-fg-tertiary"><th className="pb-1">Item</th><th className="pb-1">Qty</th><th className="pb-1">Unit</th><th className="pb-1">Disc %</th><th className="pb-1">Tax</th><th className="pb-1 text-right">Line</th><th></th></tr></thead>
                <tbody>
                  {lines.map((l) => <tr key={l.key} className="border-t border-border/70">
                    <td className="py-1.5 pr-2">{l.name}</td>
                    <td><input type="number" min={1} className="num h-8 w-16 rounded-md border border-input bg-card px-2" value={l.quantity} onChange={(e) => setLines((x) => x.map((y) => (y.key === l.key ? { ...y, quantity: Math.max(1, Number(e.target.value) || 1) } : y)))} /></td>
                    <td><input type="number" step="0.01" className="num h-8 w-24 rounded-md border border-input bg-card px-2" value={l.unitPrice} onChange={(e) => setLines((x) => x.map((y) => (y.key === l.key ? { ...y, unitPrice: Number(e.target.value) || 0 } : y)))} /></td>
                    <td><input type="number" min={0} max={100} className="num h-8 w-16 rounded-md border border-input bg-card px-2" value={l.discountPercentage ?? 0} onChange={(e) => setLines((x) => x.map((y) => (y.key === l.key ? { ...y, discountPercentage: Math.min(100, Math.max(0, Number(e.target.value) || 0)) } : y)))} /></td>
                    <td><select value={l.taxId ?? ""} onChange={(e) => setLines((x) => x.map((y) => (y.key === l.key ? { ...y, taxId: e.target.value || undefined } : y)))} className="h-8 rounded-md border border-input bg-card px-1 text-xs"><option value="">None</option>{cat.data!.taxes.map((t) => <option key={t.id} value={t.id}>{t.name} {t.rate}%</option>)}</select></td>
                    <td className="num text-right">${(l.quantity * l.unitPrice * (1 - (l.discountPercentage ?? 0) / 100)).toFixed(2)}{taxRate(l.taxId) ? <span className="block text-[10px] text-fg-quaternary">incl. {taxRate(l.taxId)}% tax</span> : null}</td>
                    <td><button type="button" onClick={() => setLines((x) => x.filter((y) => y.key !== l.key))} className="rounded p-1 text-fg-quaternary hover:text-error" aria-label="Remove"><X className="size-3.5" /></button></td>
                  </tr>)}
                </tbody>
              </table>
            )}
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Invoice notes (optional)" className="h-9 w-full rounded-lg border border-input bg-card px-2 text-sm" />
            <div className="flex items-center gap-3"><span className="num text-lg font-semibold">${total.toFixed(2)}</span><span className="text-xs text-fg-tertiary">Cliniko applies tax and rounding on its side.</span><span className="ml-auto" /><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!lines.length || busy} onClick={submit}><Plus className="size-3.5" />{busy ? "Creating…" : "Create in Cliniko"}</Button></div>
          </div>
        )}
      </div>
    </div>
  );
}
