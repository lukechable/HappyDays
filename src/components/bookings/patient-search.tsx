"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { useLive } from "@/lib/hooks";
import { cn } from "@/lib/utils";

type P = { id: string; name: string; email?: string; phone?: string; dob?: string };

/** Cliniko patient search by name, email or phone. Results are never cached. */
export function PatientSearch({ onPick, inline }: { onPick: (p: P) => void; inline?: boolean }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 250); return () => clearTimeout(t); }, [q]);
  const live = useLive(api.bookings.searchPatients, debounced.length >= 2 ? { q: debounced } : "skip");
  const results: P[] = live.data ?? [];
  return (
    <div className={cn("relative", inline ? "w-full" : "w-64")}>
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-quaternary" />
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a patient (name, email, phone)" className={cn("w-full rounded-full border border-border bg-card pl-8 pr-3 text-sm outline-none focus:border-input", inline ? "h-9" : "h-8")} />
      {debounced.length >= 2 && (
        <ul className="absolute left-0 top-full z-30 mt-1 w-full min-w-[280px] rounded-xl bg-popover p-1 shadow-md ring-1 ring-border">
          {live.loading && <li className="px-2 py-1.5 text-xs text-fg-tertiary">Searching Cliniko…</li>}
          {live.error && <li className="px-2 py-1.5 text-xs text-error">{live.error}</li>}
          {!live.loading && !live.error && results.length === 0 && <li className="px-2 py-1.5 text-xs text-fg-tertiary">No patients found.</li>}
          {results.map((p) => <li key={p.id}><button type="button" onMouseDown={(e) => { e.preventDefault(); onPick(p); setQ(""); setDebounced(""); }} className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"><div className="font-medium">{p.name}</div><div className="truncate text-xs text-fg-tertiary">{[p.email, p.phone, p.dob ? `DOB ${p.dob}` : ""].filter(Boolean).join(" · ")}</div></button></li>)}
        </ul>
      )}
    </div>
  );
}
