"use client";

import { useEffect, useState } from "react";
import { isNativeApp } from "@/lib/native";
import { useApp } from "./app-provider";
import { useReducedMotion } from "./ui";

const SEEN_KEY = "poinderecharge-splash";
/** Shortest time on screen, so it does not just flicker on a fast connection. */
const MIN_MS = 700;
const FADE_MS = 300;

/**
 * Runs while the page is parsed, before the first paint: when the splash was already
 * shown in this browser session, or inside the Android/iOS app (which shows the same
 * picture natively), it is hidden at once so it never flashes.
 */
const BOOT_SCRIPT = `try{var c=window.Capacitor;if(sessionStorage.getItem("${SEEN_KEY}")==="1"||(c&&c.isNativePlatform&&c.isNativePlatform()))document.documentElement.dataset.splash="off"}catch(e){}`;

/**
 * Splash screen for the web app: logo on forest green from the very first paint (it is
 * part of the static HTML), once per browser session. It fades out as soon as the app
 * has checked the stored session; with reduced motion it simply disappears.
 */
export function Splash() {
  const { ready } = useApp();
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<"shown" | "leaving" | "gone">("shown");

  useEffect(() => {
    const skipped = document.documentElement.dataset.splash === "off" || isNativeApp();
    try {
      window.sessionStorage.setItem(SEEN_KEY, "1");
    } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (skipped) setPhase("gone");
  }, []);

  useEffect(() => {
    if (phase !== "shown" || !ready) return;
    const id = window.setTimeout(() => setPhase(reduced ? "gone" : "leaving"), Math.max(0, MIN_MS - performance.now()));
    return () => window.clearTimeout(id);
  }, [phase, ready, reduced]);

  useEffect(() => {
    if (phase !== "leaving") return;
    const id = window.setTimeout(() => setPhase("gone"), FADE_MS);
    return () => window.clearTimeout(id);
  }, [phase]);

  if (phase === "gone") return null;
  return (
    <div
      className={`fixed inset-0 z-[60] flex flex-col items-center justify-center gap-6 bg-gp-forest transition-opacity duration-300 ease-gp-out [html[data-splash=off]_&]:hidden ${
        phase === "leaving" ? "opacity-0" : ""
      }`}
      // Safety net should the app never start: the splash still goes away after a few seconds.
      style={{ animation: "gp-fade-out 0.3s ease-in 6s forwards" }}
      aria-hidden
    >
      <script dangerouslySetInnerHTML={{ __html: BOOT_SCRIPT }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="" width={112} height={112} className="animate-gp-pop h-28 w-28" />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/wordmark-dark.svg" alt="" width={220} height={45} className="animate-gp-slide-up h-auto w-56 [animation-delay:0.2s]" />
    </div>
  );
}
