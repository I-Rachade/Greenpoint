"use client";

import { useState } from "react";
import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import { useErrorMessage } from "@/lib/hooks";
import { Pill } from "./shared";

/** The Lite preset: one switch that hides parcels, courses, Cashplus and car chargers in the app. */
export function LiteSwitch() {
  const { t } = useI18n();
  const { backend, features, featuresReady } = useApp();
  const errorMessage = useErrorMessage();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const l = t.backoffice.lite;
  if (!featuresReady) return null;
  const on = features.lite;

  async function toggle() {
    if (!window.confirm(on ? l.confirmOff : l.confirmOn)) return;
    setBusy(true);
    setError("");
    try {
      await backend.setLiteEnabled(!on);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-gp border border-gp-border bg-white px-4 py-3 dark:border-white/10 dark:bg-zinc-900">
      <span className="text-xs font-medium uppercase tracking-wide text-gp-muted">{l.title}</span>
      <Pill tone={on ? "amber" : "green"}>{on ? l.lite : l.full}</Pill>
      <p className="min-w-0 flex-1 basis-64 text-sm text-gp-muted">{on ? l.liteText : l.fullText}</p>
      <button
        type="button"
        disabled={busy}
        onClick={toggle}
        className="min-h-9 rounded-full border border-gp-border px-4 text-sm font-semibold text-gp-green-dark hover:bg-gp-green/10 disabled:opacity-40 dark:border-white/15 dark:text-gp-green"
      >
        {on ? l.turnOff : l.turnOn}
      </button>
      {error && <p className="basis-full text-sm text-red-600">{error}</p>}
    </section>
  );
}
