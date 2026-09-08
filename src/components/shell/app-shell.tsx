"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Authenticated, AuthLoading, Unauthenticated, useConvexAuth, useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { Bell, Menu, Search } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { navItemFor } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { CommandPalette } from "@/components/shell/command-palette";
import { NotificationsPopover } from "@/components/shell/notifications";
import { SignOutButton } from "@/components/auth/auth-mode";
import { Rail, useRailCollapsed } from "@/components/shell/rail";
import { AuthDiagnostics } from "@/components/auth/auth-diagnostics";
import { Prefetch } from "@/components/shell/prefetch";
import { PageEnter } from "@/components/shell/page-enter";
import { PwaProvider } from "@/components/shell/pwa";

export type Me = NonNullable<ReturnType<typeof useQuery<typeof api.users.me>>>;

/**
 * The Happy Days chrome, lifted from the EventBase admin panel: a black rail on the left with grouped navigation and
 * live count badges, a slim top bar with ⌘K and notifications, and the page. Every staff route renders inside it.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <AuthLoading><Holding>Checking who you are…</Holding></AuthLoading>
      <Unauthenticated><Holding><p>Sign in with your barbarafraser.net account.</p><AuthDiagnostics /></Holding></Unauthenticated>
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
  const [collapsed, setCollapsed] = useRailCollapsed();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((o) => !o); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // Edge-to-edge screens (their own panes and scroll areas); everything else gets the page gutters.
  const wide = pathname === "/mail" || pathname === "/bookings" || pathname === "/pdf";
  return (
    <div className={cn("lg:grid lg:min-h-svh lg:transition-[grid-template-columns] lg:duration-200", collapsed ? "lg:grid-cols-[64px_minmax(0,1fr)]" : "lg:grid-cols-[236px_minmax(0,1fr)]")}>
      <Rail me={me} pathname={pathname} search={searchStr} className="hidden lg:flex" collapsed={collapsed} onToggleCollapsed={() => setCollapsed(!collapsed)} />
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-12 items-center gap-3 border-b border-border bg-background/85 px-4 backdrop-blur sm:px-5">
          <Sheet>
            <SheetTrigger className="inline-flex size-9 items-center justify-center rounded-lg hover:bg-muted lg:hidden" aria-label="Menu"><Menu className="size-5" /></SheetTrigger>
            <SheetContent side="left" className="w-[260px] border-0 bg-[#1a1a19] p-0 text-white"><SheetTitle className="sr-only">Menu</SheetTitle><Rail me={me} pathname={pathname} search={searchStr} className="flex" /></SheetContent>
          </Sheet>
          <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-medium">{item.label}</div></div>
          <button type="button" onClick={() => setPaletteOpen(true)} className="hd-press inline-flex h-8 items-center gap-2 rounded-full border border-border bg-card px-3 text-xs text-fg-tertiary shadow-xs hover:border-input hover:text-foreground" aria-label="Search everything">
            <Search className="size-3.5" /><span className="hidden sm:inline">Search mail, tasks, patients, matters</span><kbd className="hidden rounded border border-border px-1 font-mono text-[10px] sm:inline">⌘K</kbd>
          </button>
          <NotificationsPopover count={me.badges.notifications} trigger={<span className="relative inline-flex size-8 items-center justify-center rounded-lg text-fg-tertiary hover:bg-muted hover:text-foreground" aria-label="Notifications"><Bell className="size-4" />{me.badges.notifications > 0 && <span className="num absolute -right-0.5 -top-0.5 rounded-full bg-error px-1 text-[9px] font-semibold leading-[14px] text-white">{me.badges.notifications}</span>}</span>} />
        </header>
        <main className={cn("min-w-0 flex-1", wide ? "flex flex-col" : "px-4 py-4 sm:px-5 lg:px-6 lg:py-5")}>
          {wide ? children : <div className="mx-auto w-full max-w-[1320px]"><PageEnter>{children}</PageEnter></div>}
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <Prefetch me={me} />
      <PwaProvider />
    </div>
  );
}
