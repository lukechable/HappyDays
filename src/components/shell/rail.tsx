"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { ChevronDown, LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NAV, isActive, type NavGroup } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { Dot } from "@/components/primitives";
import { SignOutButton } from "@/components/auth/auth-mode";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { Me } from "@/components/shell/app-shell";

const CLOSED_KEY = "hd-rail-closed";
const COLLAPSED_KEY = "hd-rail-collapsed";
/* A tiny store over localStorage: parsed values are cached so snapshots are referentially stable, and writes notify subscribers. */
const cache = new Map<string, unknown>();
const EVENT = "hd-rail-store";
function readStored<T>(key: string, fallback: T): T {
  if (cache.has(key)) return cache.get(key) as T;
  let v: T = fallback;
  try { const raw = localStorage.getItem(key); if (raw) v = JSON.parse(raw) as T; } catch { /* private mode */ }
  cache.set(key, v);
  return v;
}
function writeStored(key: string, value: unknown) {
  cache.set(key, value);
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
  window.dispatchEvent(new Event(EVENT));
}
const subscribe = (cb: () => void) => { window.addEventListener(EVENT, cb); return () => window.removeEventListener(EVENT, cb); };
function useStored<T>(key: string, fallback: T): [T, (v: T) => void] {
  const value = useSyncExternalStore(subscribe, () => readStored(key, fallback), () => fallback);
  return [value, (v) => writeStored(key, v)];
}
const NONE: string[] = [];

/** Whether the desktop rail is shrunk to its icons. Remembered on this device. */
export function useRailCollapsed(): [boolean, (v: boolean) => void] {
  return useStored<boolean>(COLLAPSED_KEY, false);
}

/**
 * The left navigation: sections with an icon, a chevron to fold them, and their pages indented beneath. On desktop it
 * can shrink to a column of section icons; each icon then opens its pages in a popover so nothing is lost.
 */
export function Rail({ me, pathname, search, className, collapsed = false, onToggleCollapsed }: { me: Me; pathname: string; search: string; className?: string; collapsed?: boolean; onToggleCollapsed?: () => void }) {
  const badges = me.badges as Record<string, number>;
  const [stored, setClosed] = useStored<string[]>(CLOSED_KEY, NONE);
  // The section holding the current page is always shown open, so a ⌘K jump or a link never lands in a folded section.
  const activeGroup = NAV.find((x) => x.items.some((i) => isActive(i, pathname, search)))?.label;
  const closed = stored.filter((l) => l !== activeGroup);
  const toggle = (label: string) => setClosed(stored.includes(label) ? stored.filter((l) => l !== label) : [...stored, label]);
  const countFor = (g: NavGroup) => g.items.reduce((s, i) => s + (i.badge ? badges[i.badge] ?? 0 : 0), 0);
  const alertIn = (g: NavGroup) => g.items.some((i) => (i.badge === "overdue" || i.badge === "paidNotDelivered") && (badges[i.badge] ?? 0) > 0);

  const itemLink = (i: NavGroup["items"][number], indent: boolean) => {
    const active = isActive(i, pathname, search);
    const n = i.badge ? badges[i.badge] ?? 0 : 0;
    const alert = i.badge === "overdue" || i.badge === "paidNotDelivered";
    return (
      <Link key={i.href} href={i.href} prefetch aria-current={active ? "page" : undefined} className={cn("hd-press flex items-center justify-between gap-2 rounded-lg py-[6px] pr-2 text-[13px] leading-tight outline-none focus-visible:ring-2 focus-visible:ring-white/60", indent ? "pl-8" : "pl-2", active ? "bg-white/[0.1] text-white" : "text-white/70 hover:bg-white/[0.06] hover:text-white")}>
        <span className="truncate">{i.label}</span>
        {n > 0 && <span className={cn("hd-pop num rounded-full px-1.5 text-[10.5px] font-semibold leading-4", alert ? "bg-error/90 text-white" : "bg-gold text-[#1a1a19]")}>{n > 99 ? "99+" : n}</span>}
      </Link>
    );
  };

  return (
    <aside className={cn("sticky top-0 h-svh flex-col bg-[#1a1a19] text-white", className)} aria-label="Navigation">
      <div className={cn("pb-3 pt-4", collapsed ? "px-2 text-center" : "px-5")}>
        <Link href="/" className="inline-flex items-baseline gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-white/60" title="Happy Days">
          <span className="font-display text-[19px] leading-none tracking-[-0.01em]">{collapsed ? "HD" : "Happy Days"}</span>
        </Link>
        {!collapsed && <p className="mt-2 text-[11px] uppercase tracking-[0.14em] text-white/40">Barbara Fraser &amp; Associates</p>}
      </div>

      <nav className={cn("min-h-0 flex-1 overflow-y-auto pb-4 [scrollbar-width:thin]", collapsed ? "space-y-1 px-2" : "space-y-5 px-3")}>
        {NAV.map((g) => {
          const Icon = g.icon;
          const open = !closed.includes(g.label);
          const n = countFor(g);
          if (collapsed) {
            const activeGroup = g.items.some((i) => isActive(i, pathname, search));
            return (
              <Popover key={g.label}>
                <PopoverTrigger render={<button type="button" aria-label={g.label} title={g.label} className={cn("hd-press relative mx-auto flex size-10 items-center justify-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-white/60", activeGroup ? "bg-white/[0.12] text-white" : "text-white/70 hover:bg-white/[0.06] hover:text-white")} />}>
                  <Icon className="size-[18px]" />
                  {n > 0 && <span className={cn("num absolute -right-0.5 -top-0.5 rounded-full px-1 text-[9px] font-semibold leading-[14px]", alertIn(g) ? "bg-error/90 text-white" : "bg-gold text-[#1a1a19]")}>{n > 99 ? "99+" : n}</span>}
                </PopoverTrigger>
                <PopoverContent side="right" align="start" className="w-52 border-0 bg-[#1a1a19] p-2 text-white shadow-float">
                  <div className="flex items-center gap-2 px-2 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/50"><Icon className="size-3.5" />{g.label}</div>
                  <div className="space-y-px">{g.items.map((i) => itemLink(i, false))}</div>
                </PopoverContent>
              </Popover>
            );
          }
          return (
            <div key={g.label}>
              <button type="button" onClick={() => toggle(g.label)} aria-expanded={open} className="hd-press flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/55 outline-none hover:bg-white/[0.05] hover:text-white/85 focus-visible:ring-2 focus-visible:ring-white/60">
                <Icon className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{g.label}</span>
                {!open && n > 0 && <span className={cn("num rounded-full px-1.5 text-[10px] font-semibold normal-case leading-4 tracking-normal", alertIn(g) ? "bg-error/90 text-white" : "bg-gold text-[#1a1a19]")}>{n > 99 ? "99+" : n}</span>}
                <ChevronDown className={cn("size-3.5 shrink-0 transition-transform duration-200", !open && "-rotate-90")} />
              </button>
              <div className={cn("grid transition-[grid-template-rows,opacity] duration-200", open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                <div className="min-h-0 overflow-hidden"><div className="mt-1 space-y-px">{g.items.map((i) => itemLink(i, true))}</div></div>
              </div>
            </div>
          );
        })}
      </nav>

      <div className={cn("border-t border-white/10 py-3", collapsed ? "px-2" : "px-4")}>
        <div className={cn("flex items-center gap-2", collapsed && "flex-col")}>
          <Dot tone={me.google?.status === "connected" ? "good" : me.google ? "warn" : "neutral"} />
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs text-white/85">{me.email}</div>
              <div className="truncate text-[10.5px] uppercase tracking-wider text-white/40">{me.google?.status === "connected" ? "Gmail connected" : me.google ? "Gmail needs attention" : "Gmail not connected"}</div>
            </div>
          )}
          <SignOutButton className="inline-flex size-7 items-center justify-center rounded-md text-white/50 hover:bg-white/10 hover:text-white"><LogOut className="size-3.5" /></SignOutButton>
          {onToggleCollapsed && <button type="button" onClick={onToggleCollapsed} className="hd-press inline-flex size-7 items-center justify-center rounded-md text-white/50 hover:bg-white/10 hover:text-white" aria-label={collapsed ? "Expand the menu" : "Shrink the menu"} title={collapsed ? "Expand the menu" : "Shrink the menu"}>{collapsed ? <PanelLeftOpen className="size-3.5" /> : <PanelLeftClose className="size-3.5" />}</button>}
        </div>
      </div>
    </aside>
  );
}
