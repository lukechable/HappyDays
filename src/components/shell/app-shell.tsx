"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Authenticated, AuthLoading, Unauthenticated, useConvexAuth, useMutation, useQuery } from "convex/react";
import { Bell, LogOut, Menu, Search } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { NAV, isActive, navItemFor } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { CommandPalette } from "@/components/shell/command-palette";
import { NotificationsPopover } from "@/components/shell/notifications";
import { Dot } from "@/components/primitives";
import { SignOutButton } from "@/components/auth/auth-mode";

export type Me = NonNullable<ReturnType<typeof useQuery<typeof api.users.me>>>;

/**
 * The Happy Days chrome, lifted from the EventBase admin panel: a black rail on the left with grouped navigation and
 * live count badges, a slim top bar with ⌘K and notifications, and the page. Every staff route renders inside it.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <AuthLoading><Holding>Checking who you are…</Holding></AuthLoading>
      <Unauthenticated><Holding><p>Sign in with your barbarafraser.net account.</p><Button className="mt-4" render={<Link href="/signin" />}>Sign in</Button></Holding></Unauthenticated>
      <Authenticated><Inner>{children}</Inner></Authenticated>
    </div>
  );
}

function Holding({ children }: { children: ReactNode }) {
  return <div className="mx-auto flex min-h-svh max-w-sm flex-col items-center justify-center px-6 text-center text-sm text-fg-secondary">{children}</div>;
}

function Inner({ children }: { children: ReactNode }) {
  const me = useQuery(api.users.me);
  const ensure = useMutation(api.users.ensure);
  const { isAuthenticated } = useConvexAuth();
  const synced = useRef(false);
  useEffect(() => {
    if (!isAuthenticated || synced.current) return;
    synced.current = true;
    ensure({}).catch(() => { synced.current = false; });
  }, [isAuthenticated, ensure]);
  if (me === undefined) return <Holding>Opening Happy Days…</Holding>;
  if (me === null) return <NotOnList />;
  return <Frame me={me}>{children}</Frame>;
}

function NotOnList() {
  return (
    <Holding>
      <p className="font-display text-2xl text-foreground">This account isn’t on the list.</p>
      <p className="mt-2">Happy Days is for Barbara and Luke. Sign in with your barbarafraser.net Google account.</p>
      <div className="mt-5 flex gap-2"><SignOutButton className="inline-flex h-8 items-center rounded-lg border border-border px-3 text-sm hover:bg-muted">Switch account</SignOutButton></div>
    </Holding>
  );
}

function Frame({ me, children }: { me: Me; children: ReactNode }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const searchStr = search.size ? `?${search.toString()}` : "";
  const item = navItemFor(pathname, searchStr);
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((o) => !o); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const wide = pathname.startsWith("/mail") || pathname.startsWith("/bookings") || pathname.startsWith("/pdf");
  return (
    <div className="lg:grid lg:min-h-svh lg:grid-cols-[236px_minmax(0,1fr)]">
      <Rail me={me} pathname={pathname} search={searchStr} className="hidden lg:flex" />
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur sm:px-6">
          <Sheet>
            <SheetTrigger className="inline-flex size-9 items-center justify-center rounded-lg hover:bg-muted lg:hidden" aria-label="Menu"><Menu className="size-5" /></SheetTrigger>
            <SheetContent side="left" className="w-[260px] border-0 bg-[#1a1a19] p-0 text-white"><SheetTitle className="sr-only">Menu</SheetTitle><Rail me={me} pathname={pathname} search={searchStr} className="flex" /></SheetContent>
          </Sheet>
          <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium">{item.label}</div></div>
          <button type="button" onClick={() => setPaletteOpen(true)} className="inline-flex h-8 items-center gap-2 rounded-full border border-border bg-card px-3 text-xs text-fg-tertiary hover:border-input hover:text-foreground" aria-label="Search everything">
            <Search className="size-3.5" /><span className="hidden sm:inline">Search mail, tasks, patients, matters</span><kbd className="hidden rounded border border-border px-1 font-mono text-[10px] sm:inline">⌘K</kbd>
          </button>
          <NotificationsPopover count={me.badges.notifications} trigger={<span className="relative inline-flex size-8 items-center justify-center rounded-lg text-fg-tertiary hover:bg-muted hover:text-foreground" aria-label="Notifications"><Bell className="size-4" />{me.badges.notifications > 0 && <span className="num absolute -right-0.5 -top-0.5 rounded-full bg-error px-1 text-[9px] font-semibold leading-[14px] text-white">{me.badges.notifications}</span>}</span>} />
        </header>
        <main className={cn("min-w-0 flex-1", wide ? "flex flex-col" : "px-4 py-6 sm:px-6 lg:px-8 lg:py-8")}>
          {wide ? children : <div className="mx-auto w-full max-w-[1320px]">{children}</div>}
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
    </div>
  );
}

function Rail({ me, pathname, search, className }: { me: Me; pathname: string; search: string; className?: string }) {
  const badges = me.badges as Record<string, number>;
  return (
    <aside className={cn("sticky top-0 h-svh flex-col bg-[#1a1a19] text-white", className)} aria-label="Navigation">
      <div className="px-5 pb-4 pt-5">
        <Link href="/" className="inline-flex items-baseline gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-white/60">
          <span className="font-display text-[19px] leading-none tracking-[-0.01em]">Happy Days</span>
        </Link>
        <p className="mt-2 text-[11px] uppercase tracking-[0.14em] text-white/40">Barbara Fraser &amp; Associates</p>
      </div>
      <nav className="min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-4 [scrollbar-width:thin]">
        {NAV.map((g) => (
          <div key={g.label}>
            <div className="px-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/40">{g.label}</div>
            <div className="mt-1 space-y-px">
              {g.items.map((i) => {
                const active = isActive(i, pathname, search);
                const n = i.badge ? badges[i.badge] ?? 0 : 0;
                const alert = i.badge === "overdue" || i.badge === "paidNotDelivered";
                return (
                  <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined} className={cn("flex items-center justify-between gap-2 rounded-lg px-2 py-[7px] text-[13.5px] leading-tight outline-none transition-colors focus-visible:ring-2 focus-visible:ring-white/60", active ? "bg-white/[0.1] text-white" : "text-white/70 hover:bg-white/[0.06] hover:text-white")}>
                    <span className="truncate">{i.label}</span>
                    {n > 0 && <span className={cn("num rounded-full px-1.5 text-[10.5px] font-semibold leading-4", alert ? "bg-error/90 text-white" : "bg-gold text-[#1a1a19]")}>{n > 99 ? "99+" : n}</span>}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/10 px-4 py-3">
        <div className="flex items-center gap-2">
          <Dot tone={me.google?.status === "connected" ? "good" : me.google ? "warn" : "neutral"} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs text-white/85">{me.email}</div>
            <div className="truncate text-[10.5px] uppercase tracking-wider text-white/40">{me.google?.status === "connected" ? "Gmail connected" : me.google ? "Gmail needs attention" : "Gmail not connected"}</div>
          </div>
          <SignOutButton className="inline-flex size-7 items-center justify-center rounded-md text-white/50 hover:bg-white/10 hover:text-white"><LogOut className="size-3.5" /></SignOutButton>
        </div>
      </div>
    </aside>
  );
}
