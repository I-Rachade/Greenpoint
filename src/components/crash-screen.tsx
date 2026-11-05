"use client";

import { useEffect } from "react";

/**
 * What the app shows when a page crashes, in place of a blank white page (src/app/error.tsx and
 * src/app/global-error.tsx). Most crashes come back after the phone was locked or the app left
 * in the background: a new version went online meanwhile and the page asks for files that no
 * longer exist. Those reload on their own, once; anything else gets a button.
 * Plain inline styles and its own words: global-error renders without the app's CSS and providers.
 */

const RELOADED_KEY = "poinderecharge-crash-reload";
/** Two automatic reloads closer than this would be a loop: show the button instead. */
const RELOAD_WINDOW_MS = 30_000;

const TEXT = {
  fr: { title: "Un instant…", body: "L'application doit être rechargée.", button: "Recharger" },
  en: { title: "One moment…", body: "The app needs to reload.", button: "Reload" },
};

function locale(): keyof typeof TEXT {
  try {
    const saved = window.localStorage.getItem("poinderecharge-locale");
    if (saved === "en" || saved === "fr") return saved;
    return navigator.language.startsWith("en") ? "en" : "fr";
  } catch {
    return "fr";
  }
}

/** A file of the app that could not be loaded: a new version is online, a reload fetches it. */
export function isStaleBuildError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /ChunkLoadError|Loading (CSS )?chunk|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(text);
}

/** Reloads the page unless it already did so a moment ago; true when it reloads. */
export function reloadOnce(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(RELOADED_KEY)) || 0;
    if (Date.now() - last < RELOAD_WINDOW_MS) return false;
    window.sessionStorage.setItem(RELOADED_KEY, String(Date.now()));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

export function CrashScreen({ error, retry }: { error: unknown; retry?: () => void }) {
  useEffect(() => {
    console.error(error);
    if (isStaleBuildError(error)) reloadOnce();
  }, [error]);

  const t = TEXT[typeof window === "undefined" ? "fr" : locale()];
  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 80,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: 24,
        background: "#0B3B2E",
        color: "#fff",
        fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        textAlign: "center",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo.svg" alt="" width={80} height={80} />
      <p style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{t.title}</p>
      <p style={{ margin: 0, fontSize: 15, opacity: 0.85 }}>{t.body}</p>
      <button
        type="button"
        onClick={() => {
          // A retry is enough for a passing hiccup; a reload also brings the newest version.
          if (retry && !isStaleBuildError(error)) retry();
          else window.location.reload();
        }}
        style={{
          marginTop: 8,
          border: 0,
          borderRadius: 9999,
          padding: "12px 28px",
          background: "#1DB954",
          color: "#0B3B2E",
          fontSize: 16,
          fontWeight: 700,
          cursor: "pointer",
        }}
      >
        {t.button}
      </button>
    </div>
  );
}
