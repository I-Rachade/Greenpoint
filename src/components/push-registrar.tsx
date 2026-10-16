"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { pushEnabled, storePushToken } from "@/lib/push";
import { useApp } from "./app-provider";

/**
 * Signs this phone up for push notices of the signed-in account (new offers for drivers,
 * trip updates for customers) and opens the right screen when a notice is tapped.
 * Only in the app, and only when the build turned push on.
 */
export function PushRegistrar() {
  const { backend, profile } = useApp();
  const router = useRouter();
  const userId = profile?.id ?? null;

  useEffect(() => {
    if (!userId || !pushEnabled()) return;
    let active = true;
    const handles: { remove(): Promise<void> }[] = [];
    void (async () => {
      const { PushNotifications } = await import("@capacitor/push-notifications");
      const platform = (await import("@capacitor/core")).Capacitor.getPlatform() === "ios" ? "ios" : "android";
      let { receive } = await PushNotifications.checkPermissions();
      if (receive === "prompt" || receive === "prompt-with-rationale") receive = (await PushNotifications.requestPermissions()).receive;
      if (!active || receive !== "granted") return;
      if (platform === "android") {
        await PushNotifications.createChannel({ id: "offers", name: "Courses", importance: 5, sound: "default", vibration: true }).catch(() => undefined);
      }
      handles.push(
        await PushNotifications.addListener("registration", ({ value }) => {
          storePushToken(value);
          void backend.registerPushToken(value, platform).catch(() => undefined);
        }),
        await PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
          const path = (notification.data as { path?: unknown } | undefined)?.path;
          if (typeof path === "string" && path.startsWith("/")) router.push(path);
        }),
      );
      await PushNotifications.register();
    })().catch(() => undefined);
    return () => {
      active = false;
      handles.forEach((h) => void h.remove());
    };
  }, [backend, router, userId]);

  return null;
}
