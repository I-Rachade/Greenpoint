"use client";

import { useEffect, useRef } from "react";

// Cloudflare Turnstile, the robot check before a login code is sent (worker/ip-limits.ts).
// Shown only when the Worker has a site key; the token it gives is good for one request.

interface TurnstileApi {
  render(el: HTMLElement, options: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void; "error-callback": () => void; language?: string }): string;
  reset(id: string): void;
  remove(id: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("turnstile")));
    script.onerror = () => {
      loading = null;
      reject(new Error("turnstile"));
    };
    document.head.appendChild(script);
  });
  return loading;
}

/**
 * The widget; `onToken` gets each new token, and null when it expires or fails. A change of
 * `resetKey` asks for a fresh check, after a token was used.
 */
export function Turnstile({ siteKey, lang, resetKey, onToken }: { siteKey: string; lang: string; resetKey: number; onToken: (token: string | null) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const report = useRef(onToken);
  useEffect(() => {
    report.current = onToken;
  }, [onToken]);

  useEffect(() => {
    let gone = false;
    loadTurnstile().then(
      (api) => {
        if (gone || !box.current) return;
        widget.current = api.render(box.current, {
          sitekey: siteKey,
          language: lang,
          callback: (token) => report.current(token),
          "expired-callback": () => report.current(null),
          "error-callback": () => report.current(null),
        });
      },
      () => report.current(null),
    );
    return () => {
      gone = true;
      if (widget.current) window.turnstile?.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey, lang]);

  useEffect(() => {
    if (resetKey && widget.current) {
      report.current(null);
      window.turnstile?.reset(widget.current);
    }
  }, [resetKey]);

  return <div ref={box} className="min-h-[65px]" />;
}
