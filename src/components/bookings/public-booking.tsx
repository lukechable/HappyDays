"use client";

import { useSearchParams } from "next/navigation";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { aud, time } from "@/lib/format";

/** After Stripe: shows the booking state live; the webhook flips it from paid to booked within seconds. */
export function BookingDone() {
  const params = useSearchParams();
  const id = params.get("session") as Id<"bookingSessions"> | null;
  const s = useQuery(api.bookings.publicSessionStatus, id ? { id } : "skip");
  const practice = useQuery(api.settings.publicPractice);
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col justify-center px-6 py-12 text-center">
      <p className="text-xs uppercase tracking-[0.14em] text-fg-tertiary">{practice?.name}</p>
      {!id || s === null ? <p className="mt-4 text-sm text-fg-secondary">We couldn’t find that booking.</p> : !s ? <p className="mt-4 text-sm text-fg-tertiary">Checking…</p> : (
        <>
          <h1 className="mt-2 font-display text-3xl">{s.status === "booked" ? "You’re booked." : s.status === "paid" ? "Payment received." : s.status === "failed" ? "Almost there." : s.status === "expired" ? "That session expired." : "Waiting for payment…"}</h1>
          <p className="mt-3 text-sm text-fg-secondary">{s.status === "booked" ? `${s.firstName}, your appointment on ${new Date(s.startsAt).toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })} at ${time(s.startsAt)} is confirmed. A confirmation is on its way to ${s.email}.` : s.status === "paid" ? "Confirming your appointment now. This takes a few seconds." : s.error ?? "If you didn’t complete payment, nothing has been booked."}</p>
          <p className="num mt-4 text-xs text-fg-tertiary">{aud(s.amountCents)} {s.mode === "deposit" ? "deposit" : "paid"}</p>
        </>
      )}
    </main>
  );
}
