"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { useLive } from "@/lib/hooks";
import { api } from "../../../convex/_generated/api";
import { NAV_ITEMS } from "@/lib/nav";
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Pill, statusTone } from "@/components/primitives";
import { mailDate } from "@/lib/format";

type Patient = { id: string; name: string; email?: string; phone?: string };

/** ⌘K: jump to a page, or find a conversation, task, matter or Cliniko patient. */
export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(q.trim()), 180); return () => clearTimeout(t); }, [q]);
  const ready = debounced.length >= 2;
  const tasks = useQuery(api.tasks.list, ready ? { view: "all", q: debounced } : "skip");
  const matters = useQuery(api.matters.search, ready ? { q: debounced } : "skip");
  const patientsLive = useLive(api.bookings.searchPatients, ready && open ? { q: debounced } : "skip");
  const patients: Patient[] = patientsLive.data?.slice(0, 5) ?? [];
  const go = (href: string) => { onOpenChange(false); setQ(""); router.push(href); };
  const pages = NAV_ITEMS.filter((i) => !q || i.label.toLowerCase().includes(q.toLowerCase()) || i.blurb.toLowerCase().includes(q.toLowerCase())).slice(0, q ? 4 : 8);
  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} title="Search" description="Pages, mail, tasks, matters and patients">
      <Command shouldFilter={false}>
        <CommandInput placeholder="Search mail, tasks, matters, patients, or a page…" value={q} onValueChange={setQ} />
        <CommandList>
          <CommandEmpty>{!ready ? "Type at least two characters." : "No matches."}</CommandEmpty>
          {pages.length > 0 && (
            <CommandGroup heading="Pages">
              {pages.map((p) => <CommandItem key={p.href} value={`page:${p.href}`} onSelect={() => go(p.href)}><span>{p.label}</span><span className="ml-2 truncate text-xs text-fg-tertiary">{p.blurb}</span></CommandItem>)}
            </CommandGroup>
          )}
          {ready && (
            <CommandGroup heading="Mail">
              <CommandItem value={`mail:${debounced}`} onSelect={() => go(`/mail?view=search&q=${encodeURIComponent(debounced)}`)}><span>Search Gmail for “{debounced}”</span></CommandItem>
            </CommandGroup>
          )}
          {tasks?.length ? (
            <CommandGroup heading="Tasks">
              {tasks.slice(0, 5).map((t) => <CommandItem key={t._id} value={`task:${t._id}`} onSelect={() => go(`/tasks?task=${t._id}`)}><span className="truncate">{t.title}</span>{t.assignee && <span className="ml-2 text-xs text-fg-tertiary">{t.assignee}</span>}<Pill tone={statusTone(t.status)} className="ml-auto">{t.status}</Pill></CommandItem>)}
            </CommandGroup>
          ) : null}
          {matters?.length ? (
            <CommandGroup heading="Matters">
              {matters.map((m) => <CommandItem key={m._id} value={`matter:${m._id}`} onSelect={() => go(`/matters/${m._id}`)}><span>{m.name}</span>{m.courtFileNo && <span className="ml-2 text-xs text-fg-tertiary">{m.courtFileNo}</span>}<Pill tone={statusTone(m.status)} className="ml-auto">{m.status.replace("_", " ")}</Pill><span className="ml-2 text-[10px] text-fg-quaternary">{mailDate(m.updatedAt)}</span></CommandItem>)}
            </CommandGroup>
          ) : null}
          {patients.length ? (
            <CommandGroup heading="Patients (Cliniko)">
              {patients.map((p) => <CommandItem key={p.id} value={`patient:${p.id}`} onSelect={() => go(`/bookings/patients/${p.id}`)}><span>{p.name}</span><span className="ml-2 truncate text-xs text-fg-tertiary">{p.email ?? p.phone ?? ""}</span></CommandItem>)}
            </CommandGroup>
          ) : null}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
