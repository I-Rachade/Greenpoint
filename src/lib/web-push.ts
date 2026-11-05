import type { Backend } from "./backend/backend";
import { isNativeApp } from "./native";
import { storedPushToken, storePushToken } from "./push";

// Push notices in the browser (web app): the browser subscribes with the app's key and the
// Worker reaches it through standard Web Push (worker/web-push.ts). The notice is shown by
// public/push-sw.js. Not in the native apps, which use Firebase (push-registrar.tsx).

const SW_PATH = "/push-sw.js";

/** "unsupported": no Web Push here (old browser, iPhone outside the home screen, the app, the demo). */
export type WebPushState = "unsupported" | "off" | "on" | "blocked";

export function webPushSupported(): boolean {
  if (typeof window === "undefined" || isNativeApp()) return false;
  if (process.env.NEXT_PUBLIC_BACKEND !== "cloudflare") return false;
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function webPushState(): Promise<WebPushState> {
  if (!webPushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  if (Notification.permission !== "granted") return "off";
  const registration = await navigator.serviceWorker.getRegistration(SW_PATH);
  const subscription = await registration?.pushManager.getSubscription();
  return subscription && storedPushToken() ? "on" : "off";
}

const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);

const keyBytes = (base64url: string) => {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)), (ch) => ch.charCodeAt(0));
};

/**
 * Subscribes this browser for the signed-in account. With ask, the browser asks for
 * permission (call it from a tap: Safari allows the question only then).
 */
export async function enableWebPush(backend: Backend, ask: boolean): Promise<WebPushState> {
  if (!webPushSupported()) return "unsupported";
  let permission = Notification.permission;
  if (permission === "default" && ask) permission = await Notification.requestPermission();
  if (permission === "denied") return "blocked";
  if (permission !== "granted") return "off";
  const registration = await navigator.serviceWorker.register(SW_PATH, { scope: "/" });
  await navigator.serviceWorker.ready;
  const { publicKey } = await backend.webPushKey();
  let subscription = await registration.pushManager.getSubscription();
  // A subscription made with another key (e.g. before a reset) cannot be reached any more.
  const current = subscription?.options.applicationServerKey;
  if (subscription && current && !sameBytes(new Uint8Array(current), keyBytes(publicKey))) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
  const token = JSON.stringify(subscription.toJSON());
  await backend.registerPushToken(token, "web");
  storePushToken(token);
  return "on";
}

/** No more notices in this browser. */
export async function disableWebPush(backend: Backend): Promise<WebPushState> {
  const token = storedPushToken();
  if (token) await backend.removePushToken(token).catch(() => undefined);
  storePushToken(null);
  const registration = await navigator.serviceWorker.getRegistration(SW_PATH);
  await (await registration?.pushManager.getSubscription())?.unsubscribe();
  return "off";
}
