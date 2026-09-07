"use client";

import { useSyncExternalStore } from "react";

/*
 * Progressive web app plumbing: service worker registration, the deferred install prompt, and
 * helpers for turning web push on and off for this browser. Everything here is client-only.
 */

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferredPrompt: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export type PwaState = { canInstall: boolean; installed: boolean; standalone: boolean };
let snapshot: PwaState = { canInstall: false, installed: false, standalone: false };
const serverSnapshot: PwaState = snapshot;
const refresh = () => { snapshot = { canInstall: !!deferredPrompt, installed, standalone: typeof window !== "undefined" && (window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true) }; emit(); };

let wired = false;
function wire() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferredPrompt = e as InstallPromptEvent; refresh(); });
  window.addEventListener("appinstalled", () => { deferredPrompt = null; installed = true; refresh(); });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((e) => console.warn("service worker", e));
  refresh();
}

export function usePwa(): PwaState {
  return useSyncExternalStore((cb) => { listeners.add(cb); wire(); return () => listeners.delete(cb); }, () => snapshot, () => serverSnapshot);
}

export async function promptInstall(): Promise<"accepted" | "dismissed" | "unavailable"> {
  if (!deferredPrompt) return "unavailable";
  const p = deferredPrompt;
  await p.prompt();
  const { outcome } = await p.userChoice;
  if (outcome === "accepted") { deferredPrompt = null; installed = true; refresh(); }
  return outcome;
}

export const pushSupported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

function toKey(base64: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export type PushKeys = { endpoint: string; p256dh: string; auth: string };

const toKeys = (sub: PushSubscription): PushKeys => {
  const j = sub.toJSON();
  return { endpoint: sub.endpoint, p256dh: j.keys?.p256dh ?? "", auth: j.keys?.auth ?? "" };
};

export async function currentPush(): Promise<PushKeys | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub ? toKeys(sub) : null;
}

/** Ask permission and subscribe this browser. Throws with a plain message when the user says no. */
export async function enablePush(vapidPublicKey: string): Promise<PushKeys> {
  if (!pushSupported()) throw new Error("This browser can’t receive push notifications. On iPhone or iPad, add Happy Days to the Home Screen first.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error("Notifications are blocked for this site. Allow them in the browser’s site settings and try again.");
  const reg = await navigator.serviceWorker.ready;
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toKey(vapidPublicKey) }));
  return toKeys(sub);
}

export async function disablePush(): Promise<string | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return null;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  return endpoint;
}
