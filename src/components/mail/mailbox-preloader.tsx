"use client";

import { useEffect } from "react";
import { useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useCacheScope, useLive } from "@/lib/hooks";
import { ensureMailbox, MAILBOX_VIEWS, restoreMailboxes } from "@/lib/mailbox-cache";

/** Runs throughout the signed-in app, so mail is ready before navigation. */
export function MailboxPreloader({ connected }: { connected: boolean }) {
  const scope = useCacheScope();
  const list = useAction(api.mail.listThreads);
  const labels = useLive(api.mail.labels, connected ? {} : "skip", { ttlMs: 300_000 });
  const labelIds = JSON.stringify(labels.data?.filter(l => l.type === "user" && !l.hidden).map(l => l.id) ?? []);
  useEffect(() => {
    if (!connected) return;
    const controller = new AbortController();
    const warm = async () => {
      await restoreMailboxes(scope, controller.signal);
      if (controller.signal.aborted || document.visibilityState === "hidden") return;
      const folders = [...MAILBOX_VIEWS.map(view => ({ view })), ...(JSON.parse(labelIds) as string[]).map(labelId => ({ view: "label", labelId }))];
      await Promise.all(folders.map(args => ensureMailbox(scope, args, list, { background: true })));
    };
    // Let the visible page request its data first. Background reads leave a slot for clicks.
    const start = setTimeout(() => { void warm(); }, 0);
    const interval = setInterval(() => { void warm(); }, 300_000);
    const onVisible = () => { if (document.visibilityState === "visible") void warm(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { controller.abort(); clearTimeout(start); clearInterval(interval); document.removeEventListener("visibilitychange", onVisible); };
  }, [connected, scope, list, labelIds]);
  return null;
}
