"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * A right-click menu anchored at the pointer. Position is clamped when it opens so it never leaves the
 * viewport; it closes on Escape, outside click, scroll or resize. Contents are supplied by the caller.
 */
export function ContextMenu({ x, y, onClose, children, width = 240 }: { x: number; y: number; onClose: () => void; children: React.ReactNode; width?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", onClose);
    document.addEventListener("scroll", onClose, true);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); window.removeEventListener("resize", onClose); document.removeEventListener("scroll", onClose, true); };
  }, [onClose]);
  const vw = typeof window === "undefined" ? 1200 : window.innerWidth;
  const vh = typeof window === "undefined" ? 800 : window.innerHeight;
  const left = Math.max(8, Math.min(x, vw - width - 8));
  const top = Math.max(8, Math.min(y, vh - 380));
  return (
    <div ref={ref} role="menu" style={{ left, top, width }} className="hd-pop fixed z-50 max-h-[calc(100vh_-_16px)] overflow-hidden rounded-xl bg-card p-1 text-sm shadow-float ring-1 ring-black/10 dark:ring-white/10" onContextMenu={(e) => e.preventDefault()}>
      {children}
    </div>
  );
}

export function MenuItem({ icon: Icon, children, onSelect, danger, shortcut }: { icon?: React.ComponentType<{ className?: string }>; children: React.ReactNode; onSelect: () => void; danger?: boolean; shortcut?: string }) {
  return (
    <button type="button" role="menuitem" onClick={onSelect} className={cn("hd-press flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-muted", danger ? "text-error hover:bg-error-soft" : "text-foreground")}>
      {Icon && <Icon className="size-3.5 shrink-0 opacity-70" />}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {shortcut && <kbd className="text-[10.5px] text-fg-quaternary">{shortcut}</kbd>}
    </button>
  );
}

export const MenuSeparator = () => <div className="my-1 h-px bg-border" role="separator" />;
export const MenuHeading = ({ children }: { children: React.ReactNode }) => <div className="px-2 pb-1 pt-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-fg-tertiary">{children}</div>;
