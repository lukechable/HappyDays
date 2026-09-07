"use client";

import { type ReactNode } from "react";
import Link from "next/link";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ago } from "@/lib/format";
import { cn } from "@/lib/utils";

export function NotificationsPopover({ trigger, count }: { trigger: ReactNode; count: number }) {
  const rows = useQuery(api.notifications.list);
  const markRead = useMutation(api.notifications.markRead);
  return (
    <Popover>
      <PopoverTrigger render={<button type="button" />}>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          {count > 0 && <button type="button" onClick={() => void markRead({})} className="text-xs text-fg-tertiary hover:text-foreground">Mark all read</button>}
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          {rows === undefined ? <p className="px-3 py-6 text-center text-xs text-fg-tertiary">Loading…</p> : rows.length === 0 ? <p className="px-3 py-8 text-center text-sm text-fg-tertiary">Nothing yet. Assignments, downloads and signatures land here.</p> : rows.map((n) => (
            <Link key={n._id} href={n.href ?? "/"} onClick={() => void markRead({ id: n._id })} className={cn("block border-b border-border/60 px-3 py-2.5 last:border-0 hover:bg-muted", !n.readAt && "bg-blue-soft/40")}>
              <div className="flex items-start gap-2">
                {!n.readAt && <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-blue" />}
                <div className="min-w-0">
                  <p className="text-sm leading-snug">{n.title}</p>
                  {n.body && <p className="mt-0.5 truncate text-xs text-fg-tertiary">{n.body}</p>}
                  <p className="mt-0.5 text-[10.5px] text-fg-quaternary">{ago(n.createdAt)}</p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
