"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useAction, useQuery } from "convex/react";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { api } from "../../../convex/_generated/api";
import type { ListItem } from "../../../convex/mail";
import { useLive } from "@/lib/hooks";
import { EMPTY_SLOT, fetchLive, readLive, subscribeLive, writeLive, type Slot } from "@/lib/live-cache";
import { mailStore, threadText } from "@/lib/mail-store";
import type { Me } from "@/components/shell/app-shell";

type InboxList = { items: ListItem[]; nextToken?: string; missing: number };
/** The key MailPage derives for the plain inbox (JSON.stringify drops the undefined labelId and q). */
const INBOX_KEY = `mail:list:${JSON.stringify({ view: "inbox", labelId: undefined, q: undefined, connected: true })}`;
/** Screens people go to next. The rail's links prefetch these too, but not on phones, where the rail lives in a sheet. */
const WARM_ROUTES = ["/mail", "/tasks", "/bookings"];

/**
 * Warms what the next click needs, right after sign-in, so Mail and Bookings open at once. Renders nothing.
 *  - Route code and payload for the common destinations.
 *  - The inbox list: the device copy (IndexedDB) straight away, then fresh from Gmail, then the first few
 *    conversations so opening them is instant.
 *  - The Convex subscriptions Mail mounts (thread metadata, signatures), held open here so Mail reads them from the
 *    client cache instead of waiting on a round trip.
 */
export function Prefetch({ me }: { me: Me }) {
  const router = useRouter();
  const setup = useQuery(api.settings.setupStatus);
  const connected = me.google?.status === "connected";
  useLive(api.mail.labels, connected ? {} : "skip", { ttlMs: 300_000 });
  useLive(api.bookings.practice, setup?.cliniko ? {} : "skip", { ttlMs: 600_000 });
  useQuery(api.signaturesEmail.mine);
  const inbox = useSyncExternalStore(subscribeLive, () => readLive<InboxList>(INBOX_KEY), () => EMPTY_SLOT as Slot<InboxList>);
  const ids = inbox.data?.items.map((i) => i.gmailThreadId) ?? [];
  useQuery(api.mail.meta, connected && ids.length ? { gmailThreadIds: ids } : "skip");
  const listThreads = useAction(api.mail.listThreads);
  const getThread = useAction(api.mail.getThread);

  useEffect(() => { for (const href of WARM_ROUTES) router.prefetch(href, { kind: PrefetchKind.FULL }); }, [router]);

  useEffect(() => {
    if (!connected) return;
    let live = true;
    if (!readLive(INBOX_KEY).data) void mailStore.getList<ListItem>(INBOX_KEY).then((r) => { if (live && r && !readLive(INBOX_KEY).data) writeLive<InboxList>(INBOX_KEY, { data: { items: r.items, nextToken: r.nextToken, missing: r.missing }, fetchedAt: 0 }); });
    const t = setTimeout(() => {
      if (readLive(INBOX_KEY).fetchedAt) return;
      void fetchLive<InboxList>(INBOX_KEY, async () => {
        const r = await listThreads({ view: "inbox" });
        const data = { items: r.items, nextToken: r.nextPageToken, missing: r.missing ?? 0 };
        void mailStore.putList(INBOX_KEY, { ...data, fetchedAt: Date.now() });
        return data;
      }).then(async () => {
        for (const it of readLive<InboxList>(INBOX_KEY).data?.items.slice(0, 4) ?? []) {
          if (!live) return;
          if (await mailStore.hasThread(it.gmailThreadId)) continue;
          try { const th = await getThread({ gmailThreadId: it.gmailThreadId }); writeLive(`mail:thread:${it.gmailThreadId}`, { data: th, fetchedAt: Date.now() }); await mailStore.putThread(it.gmailThreadId, th, threadText(th)); } catch { /* skip */ }
          await new Promise((res) => setTimeout(res, 400));
        }
      });
    }, 300);
    return () => { live = false; clearTimeout(t); };
  }, [connected, listThreads, getThread]);
  return null;
}
