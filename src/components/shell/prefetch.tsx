"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { PrefetchKind } from "next/dist/client/components/router-reducer/router-reducer-types";
import { api } from "../../../convex/_generated/api";
import type { ListItem } from "../../../convex/mail";
import { useLive } from "@/lib/hooks";
import { EMPTY_SLOT, fetchLive, readLive, subscribeLive, writeLive, type Slot } from "@/lib/live-cache";
import { mailStore, threadText } from "@/lib/mail-store";
import type { Me } from "@/components/shell/app-shell";
import { NAV_ITEMS } from "@/lib/nav";

type InboxList = { items: ListItem[]; nextToken?: string; missing: number };
/** The key MailPage derives for the plain inbox (JSON.stringify drops the undefined labelId and q). */
const INBOX_KEY = `mail:list:${JSON.stringify({ view: "inbox", labelId: undefined, q: undefined, connected: true })}`;
/**
 * Every rail destination, including the mail views. The rail's own links prefetch these when they are on screen, but
 * below the desktop breakpoint the rail lives in a sheet and never enters the viewport, so the shell asks for them here.
 */
const WARM_ROUTES = NAV_ITEMS.map((i) => i.href);

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
  // Each page's opening queries, subscribed here with the same arguments the page uses, so its first visit renders
  // from the client cache. Convex pushes changes, so nothing goes stale.
  useQuery(api.tasks.lists); useQuery(api.tasks.list, { view: "all", listId: undefined, includeDone: false }); useQuery(api.tags.list); useQuery(api.users.all);
  useQuery(api.matters.list, { includeClosed: false }); useQuery(api.matters.list, {}); useQuery(api.money.table);
  useQuery(api.files.list, {}); useQuery(api.files.codes); useQuery(api.settings.all); useQuery(api.bookings.pricing); useQuery(api.signatures.list);
  // Cliniko reads for Patients and Payments; the slow invoice pull waits until the rest has settled.
  const [later, setLater] = useState(false);
  useEffect(() => { const t = setTimeout(() => setLater(true), 4000); return () => clearTimeout(t); }, []);
  useLive(api.bookings.recentPatients, setup?.cliniko ? {} : "skip");
  useLive(api.bookings.clinikoInvoices, setup?.cliniko && later ? { days: 90 } : "skip", { ttlMs: 120_000 });
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
