"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { App } from "@capacitor/app";
import { isNativeApp } from "@/lib/native";

const APP_HOST = "app.poinderecharge.com";

/** App-only behaviour (Android/iOS): back button and links into the app. Renders nothing. */
export function NativeShell() {
  const router = useRouter();

  useEffect(() => {
    if (!isNativeApp()) return;

    // Android back button: go back inside the app, close it on the start page.
    const back = App.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack) window.history.back();
      else void App.exitApp();
    });

    // Links to app.poinderecharge.com open the matching page in the app.
    const open = App.addListener("appUrlOpen", ({ url }) => {
      const target = new URL(url);
      if (target.host === APP_HOST) router.push(`${target.pathname}${target.search}`);
    });

    return () => {
      void back.then((l) => l.remove());
      void open.then((l) => l.remove());
    };
  }, [router]);

  return null;
}
