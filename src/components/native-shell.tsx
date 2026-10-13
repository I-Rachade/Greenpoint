"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { App } from "@capacitor/app";
import { isNativeApp } from "@/lib/native";
import { useI18n } from "./i18n-provider";

/** Second back press within this time closes the app. */
const EXIT_WINDOW_MS = 2000;

const APP_HOST = "app.poinderecharge.com";

/**
 * App-only behaviour (Android/iOS): back button and links into the app.
 * On the start page the first back press shows a hint and only the second closes the app.
 */
export function NativeShell() {
  const { t } = useI18n();
  const router = useRouter();
  const [hint, setHint] = useState(false);
  const lastBack = useRef(0);

  useEffect(() => {
    if (!isNativeApp()) return;

    // Android back button: go back inside the app; on the start page press twice to close it.
    let hideHint: number | undefined;
    const back = App.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back();
        return;
      }
      const now = Date.now();
      if (now - lastBack.current < EXIT_WINDOW_MS) {
        void App.exitApp();
        return;
      }
      lastBack.current = now;
      setHint(true);
      window.clearTimeout(hideHint);
      hideHint = window.setTimeout(() => setHint(false), EXIT_WINDOW_MS);
    });

    // Links to app.poinderecharge.com open the matching page in the app.
    const open = App.addListener("appUrlOpen", ({ url }) => {
      const target = new URL(url);
      if (target.host === APP_HOST) router.push(`${target.pathname}${target.search}`);
    });

    return () => {
      window.clearTimeout(hideHint);
      void back.then((l) => l.remove());
      void open.then((l) => l.remove());
    };
  }, [router]);

  if (!hint) return null;
  return (
    <div
      role="status"
      className="animate-gp-slide-up fixed inset-x-0 z-[70] flex justify-center px-4"
      style={{ bottom: "calc(80px + env(safe-area-inset-bottom))" }}
    >
      <span className="rounded-full bg-gp-forest px-4 py-2 text-sm text-white shadow-lg">{t.ui.exitHint}</span>
    </div>
  );
}
