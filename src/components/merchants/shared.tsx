"use client";

import { useState, type ReactNode } from "react";
import type { JobStatus } from "@shared/drivers";
import { useErrorMessage } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { useI18n } from "../i18n-provider";
import { useToast } from "../ui";

/** Every trip status, in the order of a trip (filters of the bookings log). */
export const JOB_STATUSES: JobStatus[] = ["open", "assigned", "accepted", "picked_up", "at_door", "returning", "done", "failed", "cancelled"];

export const field = "min-h-11 w-full rounded-xl border border-gp-border bg-gp-surface px-3 py-2 text-base dark:border-white/15";

/** "16 octobre" in the viewer's language. */
export function useLongDate() {
  const { locale } = useI18n();
  const fmt = new Intl.DateTimeFormat(locale === "fr" ? "fr-TG" : "en-GB", { day: "numeric", month: "long" });
  return (iso: string) => fmt.format(new Date(iso));
}

/** "14:05" in the viewer's language. */
export function useClock() {
  const { locale } = useI18n();
  const fmt = new Intl.DateTimeFormat(locale === "fr" ? "fr-TG" : "en-GB", { hour: "2-digit", minute: "2-digit" });
  return (iso: string) => fmt.format(new Date(iso));
}

/** "2 h 15 min" between two moments. */
export function useDuration() {
  const { t } = useI18n();
  return (fromIso: string, toIso: string) => {
    const minutes = Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60_000));
    return format(t.merchant.drivers.hours, { h: Math.floor(minutes / 60), m: minutes % 60 });
  };
}

/**
 * Runs a backend action with a busy flag, a toast on success and the error message
 * (t.errors[code]) on failure. Returns true when it worked.
 */
export function useAction() {
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<unknown>, success?: string): Promise<boolean> {
    setBusy(true);
    try {
      await action();
      if (success) toast(success, { tone: "success" });
      return true;
    } catch (err) {
      toast(errorMessage(err), { tone: "error" });
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, run };
}

/** A titled block of the shop page. */
export function Block({ title, hint, action, children }: { title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-gp-border bg-gp-surface p-4 shadow-sm sm:p-5 dark:border-white/10">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex-1 font-heading text-base font-semibold">{title}</h2>
        {action}
      </div>
      {hint && <p className="text-xs text-gp-muted">{hint}</p>}
      {children}
    </section>
  );
}
