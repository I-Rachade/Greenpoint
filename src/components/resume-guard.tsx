"use client";

import { useEffect } from "react";
import { isNativeApp } from "@/lib/native";

/** Back after at least this long in the background: check whether a new version went online. */
const AWAY_MS = 60_000;

/**
 * Web app only: a page left open in the background (phone locked, other app) keeps the files of
 * the version it started with. When a newer version went online meanwhile, those files are gone
 * and the next screen that needs one stays blank. On coming back, this asks the server which
 * version is online (/version.txt, written by next.config.ts) and reloads at once when it differs,
 * before the user has started typing. The Android/iOS apps carry their own files and skip this.
 */
export function ResumeGuard() {
  useEffect(() => {
    const build = process.env.NEXT_PUBLIC_BUILD_ID;
    if (!build || isNativeApp()) return;
    let hiddenAt = 0;
    let checking = false;

    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const res = await fetch("/version.txt", { cache: "no-store" });
        const online = res.ok ? (await res.text()).trim() : "";
        // Only a short id counts: a 404 page or a captive portal must not trigger a reload.
        if (online && online.length < 64 && !online.includes("<") && online !== build) window.location.reload();
      } catch {
        // Offline: keep the page as it is.
      } finally {
        checking = false;
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt >= AWAY_MS) void check();
    };
    // Back from the browser's page cache (back button, some phones on resume).
    const onPageShow = (event: PageTransitionEvent) => event.persisted && void check();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);
  return null;
}
