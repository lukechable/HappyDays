"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

/* ------------------------------- layout ------------------------------- */

export function PageHeader({ title, blurb, actions, meta }: { title: string; blurb?: string; actions?: ReactNode; meta?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <h1 className="font-display text-[26px] leading-tight tracking-[-0.01em] sm:text-[30px]">{title}</h1>
        {blurb && <p className="mt-1.5 max-w-2xl text-sm text-fg-secondary">{blurb}</p>}
        {meta && <div className="mt-2 text-xs text-fg-tertiary">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, blurb, actions, children, className, dense }: { title?: ReactNode; blurb?: string; actions?: ReactNode; children: ReactNode; className?: string; dense?: boolean }) {
  return (
    <section className={cn("min-w-0 rounded-2xl bg-card ring-1 ring-black/[0.06] dark:ring-white/10", dense ? "p-4" : "p-5", className)}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold leading-snug">{title}</h2>}
            {blurb && <p className="mt-0.5 text-xs text-fg-tertiary">{blurb}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg-tertiary", className)}>{children}</div>;
}

/* ------------------------------- stat tile ------------------------------- */

export function Kpi({ label, value, sub, tone, href, className }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "warn" | "bad"; href?: string; className?: string }) {
  const body = (
    <div className={cn("min-w-0 rounded-2xl bg-card p-4 ring-1 ring-black/[0.06] dark:ring-white/10", href && "transition-shadow hover:shadow-sm", className)}>
      <div className="truncate text-xs text-fg-tertiary">{label}</div>
      <div className={cn("num mt-1.5 truncate text-[26px] font-semibold leading-none tracking-tight", tone === "good" && "text-success", tone === "warn" && "text-warning", tone === "bad" && "text-error")}>{value}</div>
      {sub && <div className="mt-2 min-h-4 text-xs text-fg-tertiary">{sub}</div>}
    </div>
  );
  return href ? <Link href={href} className="block min-w-0 rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-ring">{body}</Link> : body;
}

/* --------------------------------- status --------------------------------- */

export type Tone = "neutral" | "good" | "warn" | "bad" | "info";
const DOT: Record<Tone, string> = { good: "bg-success", warn: "bg-warning", bad: "bg-error", neutral: "bg-fg-quaternary", info: "bg-blue" };
export function Dot({ tone, pulse, className }: { tone: Tone; pulse?: boolean; className?: string }) {
  return (
    <span className={cn("relative inline-flex size-2 shrink-0 rounded-full", DOT[tone], className)} aria-hidden>
      {pulse && <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:hidden", DOT[tone])} />}
    </span>
  );
}

const PILL: Record<Tone, string> = { neutral: "bg-muted text-fg-secondary", good: "bg-success-soft text-success", warn: "bg-warning-soft text-warning", bad: "bg-error-soft text-error", info: "bg-blue-soft text-blue" };
export function Pill({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return <span title={title} className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium leading-4", PILL[tone], className)}>{children}</span>;
}

/** Map every product status string to a tone in one place so every page agrees. */
export function statusTone(status: string | undefined): Tone {
  switch (status) {
    case "paid": case "booked": case "signed": case "connected": case "delivered": case "done": case "complete": case "downloaded": case "sent": return "good";
    case "open": case "pending": case "viewed": case "waiting": case "report_due": case "doing": case "needs_reauth": case "draft": case "uncollectible": return "warn";
    case "failed": case "expired": case "revoked": case "void": case "declined": case "cancelled": case "disconnected": case "paid_not_delivered": case "delivered_unpaid": case "limit": return "bad";
    case "used": case "closed": return "neutral";
    default: return "neutral";
  }
}
export const statusLabel = (s: string | undefined) => (s ?? "").replace(/_/g, " ");

/* --------------------------------- tables --------------------------------- */

export function DataTable({ head, children, empty, emptyText, className, minWidth = 640 }: { head: ReactNode; children: ReactNode; empty?: boolean; emptyText?: string; className?: string; minWidth?: number }) {
  return (
    <div className={cn("-mx-1 overflow-x-auto", className)}>
      <table className="w-full border-separate border-spacing-0 text-sm" style={{ minWidth }}>
        <thead><tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-fg-tertiary [&>th]:border-b [&>th]:border-border [&>th]:px-2 [&>th]:pb-2">{head}</tr></thead>
        <tbody className="[&>tr>td]:border-b [&>tr>td]:border-border/70 [&>tr>td]:px-2 [&>tr>td]:py-2 [&>tr>td]:align-top [&>tr:last-child>td]:border-0">{children}</tbody>
      </table>
      {empty && <div className="px-2 py-8 text-center text-sm text-fg-tertiary">{emptyText ?? "Nothing here."}</div>}
    </div>
  );
}

export function Empty({ title, body, action, className }: { title: string; body?: string; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("rounded-2xl border border-dashed border-border px-6 py-10 text-center", className)}>
      <p className="text-sm font-medium">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-md text-sm text-fg-tertiary">{body}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function Loading({ rows = 3, className }: { rows?: number; className?: string }) {
  return <div className={cn("space-y-2", className)} aria-busy>{Array.from({ length: rows }, (_, i) => <div key={i} className="h-10 animate-pulse rounded-lg bg-muted" style={{ width: `${100 - (i % 3) * 12}%` }} />)}</div>;
}

/** Key/value pairs in two columns, for detail panels. */
export function Facts({ items, className }: { items: Array<[string, ReactNode]>; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm", className)}>
      {items.map(([k, val]) => (<div key={k} className="contents"><dt className="text-fg-tertiary">{k}</dt><dd className="min-w-0 break-words">{val ?? "—"}</dd></div>))}
    </dl>
  );
}

/** A friendly error box for failed live reads (Gmail, Cliniko, Stripe). */
export function ErrorBox({ title, message, retry }: { title: string; message: string; retry?: () => void }) {
  return (
    <div className="rounded-2xl bg-error-soft px-4 py-3 text-sm">
      <p className="font-medium text-error">{title}</p>
      <p className="mt-0.5 text-fg-secondary">{message}</p>
      {retry && <button type="button" onClick={retry} className="mt-2 text-xs font-medium underline underline-offset-2">Try again</button>}
    </div>
  );
}
