"use client";

import { useEffect, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { useQuery } from "convex-helpers/react/cache/hooks";
import { toast } from "sonner";
import { BellRing, BellOff, Download, Smartphone, Laptop } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { Panel, Pill, Facts } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ago } from "@/lib/format";
import { errorMessage } from "@/lib/utils";
import { currentPush, disablePush, enablePush, promptInstall, pushSupported, usePwa } from "@/lib/pwa";

function deviceName(ua?: string) {
  if (!ua) return "Unknown device";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Macintosh/.test(ua)) return /Safari/.test(ua) && !/Chrome/.test(ua) ? "Mac · Safari" : /Edg/.test(ua) ? "Mac · Edge" : "Mac · Chrome";
  if (/Windows/.test(ua)) return /Edg/.test(ua) ? "Windows · Edge" : "Windows · Chrome";
  return "Browser";
}

/** Settings → Notifications: install the app, turn push on for this device, choose what gets pushed, test it. */
export function NotificationsTab() {
  const me = useQuery(api.users.me);
  const devices = useQuery(api.pushData.mine);
  const vapid = useQuery(api.pushData.vapidPublicKey);
  const subscribe = useMutation(api.pushData.subscribe);
  const unsubscribe = useMutation(api.pushData.unsubscribe);
  const updatePrefs = useMutation(api.users.updatePrefs);
  const sendTest = useAction(api.push.sendTest);
  const pwa = usePwa();
  const [thisEndpoint, setThisEndpoint] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => { let on = true; currentPush().then((k) => { if (on) setThisEndpoint(k?.endpoint ?? null); }).catch(() => { if (on) setThisEndpoint(null); }); return () => { on = false; }; }, []);
  const supported = pushSupported();
  const permission = typeof Notification !== "undefined" ? Notification.permission : "default";
  const thisDeviceOn = !!thisEndpoint && (devices?.some((d) => d.endpoint === thisEndpoint) ?? false);
  const prefs = me?.prefs ?? {};

  const turnOn = async () => {
    if (!vapid) { toast.error("Push isn’t configured on the server yet."); return; }
    setBusy(true);
    try { const k = await enablePush(vapid); await subscribe({ ...k, userAgent: navigator.userAgent }); setThisEndpoint(k.endpoint); toast.success("Notifications on for this device"); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };
  const turnOff = async () => {
    setBusy(true);
    try { const endpoint = await disablePush(); if (endpoint) await unsubscribe({ endpoint }); setThisEndpoint(null); toast.success("Notifications off for this device"); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-4">
        <Panel title="This device" blurb="Push notifications arrive even when Happy Days is closed. Each browser or phone is turned on separately.">
          {!supported ? (
            <p className="text-sm text-fg-secondary">This browser can’t receive push notifications. On iPhone or iPad, open Happy Days in Safari, tap Share, then <strong>Add to Home Screen</strong>, and turn notifications on from the installed app.</p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              {thisDeviceOn ? <Pill tone="good"><BellRing className="size-3" />On</Pill> : permission === "denied" ? <Pill tone="bad"><BellOff className="size-3" />Blocked in browser</Pill> : <Pill tone="neutral"><BellOff className="size-3" />Off</Pill>}
              {thisDeviceOn ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void turnOff()}>Turn off</Button> : <Button size="sm" disabled={busy || permission === "denied" || vapid === undefined} onClick={() => void turnOn()}>{busy ? "Working…" : "Turn on notifications"}</Button>}
              {thisDeviceOn && <Button size="sm" variant="ghost" disabled={busy} onClick={() => sendTest().then((n) => toast.success(n ? "Test sent" : "No device received it")).catch((e: unknown) => toast.error(errorMessage(e)))}>Send a test</Button>}
              {vapid === null && <span className="text-xs text-fg-tertiary">Server keys not set yet.</span>}
            </div>
          )}
        </Panel>
        <Panel title="What gets pushed">
          <div className="divide-y divide-border/60">
            <label className="flex items-center justify-between gap-4 py-2.5">
              <span><span className="block text-sm">New email</span><span className="block text-xs text-fg-tertiary">Sender and subject for each inbound message to your mailbox. Newsletters and automated mail stay quiet.</span></span>
              <Switch checked={prefs.pushMail !== false} onCheckedChange={(on) => updatePrefs({ prefs: { pushMail: on } }).catch((e: unknown) => toast.error(errorMessage(e)))} aria-label="Push new email" />
            </label>
            <label className="flex items-center justify-between gap-4 py-2.5">
              <span><span className="block text-sm">Activity</span><span className="block text-xs text-fg-tertiary">Assignments, task comments, downloads, signatures and bookings.</span></span>
              <Switch checked={prefs.pushActivity !== false} onCheckedChange={(on) => updatePrefs({ prefs: { pushActivity: on } }).catch((e: unknown) => toast.error(errorMessage(e)))} aria-label="Push activity" />
            </label>
          </div>
          <p className="mt-2 text-[11px] text-fg-tertiary">While the app is open, activity shows as a toast in the corner instead.</p>
        </Panel>
        <Panel title="Devices with notifications on">
          {devices === undefined ? <p className="text-sm text-fg-tertiary">Loading…</p> : devices.length === 0 ? <p className="text-sm text-fg-tertiary">None yet.</p> : (
            <ul className="divide-y divide-border/60">
              {devices.map((d) => (
                <li key={d._id} className="flex items-center gap-3 py-2 text-sm">
                  {/iPhone|iPad|Android/.test(d.userAgent ?? "") ? <Smartphone className="size-4 text-fg-tertiary" /> : <Laptop className="size-4 text-fg-tertiary" />}
                  <span className="min-w-0 flex-1 truncate">{deviceName(d.userAgent)}{d.endpoint === thisEndpoint && <span className="ml-1.5 text-xs text-fg-tertiary">(this device)</span>}</span>
                  <span className="num text-xs text-fg-tertiary">{d.lastOkAt ? `Delivered ${ago(d.lastOkAt)}` : `Added ${ago(d.createdAt)}`}</span>
                  {d.failures > 0 && <Pill tone="warn">{`${d.failures} failed`}</Pill>}
                  <button type="button" onClick={() => unsubscribe({ endpoint: d.endpoint }).then(() => toast.success("Removed")).catch((e: unknown) => toast.error(errorMessage(e)))} className="text-xs text-fg-tertiary hover:text-error">Remove</button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <Panel title="Install the app" blurb="Happy Days runs as its own window with a dock icon, and opens faster.">
        {pwa.standalone ? <Facts items={[["Status", "Installed and running as an app"]]} /> : pwa.canInstall ? (
          <Button size="sm" onClick={() => promptInstall().then((r) => { if (r === "accepted") toast.success("Installed"); })}><Download className="size-3.5" />Install Happy Days</Button>
        ) : (
          <div className="space-y-2 text-sm text-fg-secondary">
            <p><strong className="text-foreground">Mac or Windows (Chrome, Edge):</strong> click the install icon at the right end of the address bar, or use the browser menu → Install Happy Days.</p>
            <p><strong className="text-foreground">Safari on Mac:</strong> File → Add to Dock.</p>
            <p><strong className="text-foreground">iPhone or iPad:</strong> Share → Add to Home Screen.</p>
          </div>
        )}
      </Panel>
    </div>
  );
}
