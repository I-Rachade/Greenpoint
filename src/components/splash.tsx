"use client";

import { useEffect, useState } from "react";
import { isNativeApp } from "@/lib/native";

const SEEN_KEY = "poinderecharge-splash";

/**
 * Splash screen for the web app: logo on forest green for a moment when the app is
 * opened, once per browser session. The Android/iOS apps show the same picture
 * natively (Capacitor SplashScreen), so it is skipped there.
 */
export function Splash() {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let seen = true;
    try {
      seen = window.sessionStorage.getItem(SEEN_KEY) === "1";
      window.sessionStorage.setItem(SEEN_KEY, "1");
    } catch {}
    if (seen || isNativeApp()) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShown(true);
    const id = window.setTimeout(() => setShown(false), 1600);
    return () => window.clearTimeout(id);
  }, []);

  if (!shown) return null;
  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-6 bg-gp-forest"
      style={{ animation: "gp-fade-out 0.35s ease-in 1.25s forwards" }}
      aria-hidden
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="" width={112} height={112} className="animate-gp-pop h-28 w-28" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/wordmark-dark.svg" alt="" width={220} height={45} className="animate-gp-slide-up h-auto w-56 [animation-delay:0.2s]" />
    </div>
  );
}
