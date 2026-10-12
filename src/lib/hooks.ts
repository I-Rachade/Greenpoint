"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import { BackendError } from "@/lib/backend";
import { format } from "@/lib/i18n/format";

/**
 * Loads data from the backend and reloads it whenever the backend reports a change.
 * Pass a `key` (e.g. a station id) to reload when the thing being loaded changes.
 */
export function useLiveQuery<T>(load: () => Promise<T>, key = "") {
  const { backend } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const loadRef = useRef(load);

  useEffect(() => {
    loadRef.current = load;
  });

  const reload = useCallback(() => {
    loadRef.current().then(
      (value) => {
        setData(value);
        setError(null);
      },
      (err) => setError(err),
    );
  }, []);

  useEffect(() => {
    reload();
    return backend.subscribe(reload);
  }, [backend, reload, key]);

  return { data, error, reload };
}

/** Current time, refreshed every `intervalMs` (for countdowns and "updated 3 min ago"). */
export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function useErrorMessage() {
  const { t } = useI18n();
  return (err: unknown) => (err instanceof BackendError ? t.errors[err.code] : t.errors.unknown);
}

export function useRelativeTime() {
  const { t } = useI18n();
  return (iso: string, now: Date) => {
    const minutes = Math.floor((now.getTime() - new Date(iso).getTime()) / 60_000);
    if (minutes < 1) return t.time.justNow;
    if (minutes < 60) return format(t.time.minutesAgo, { n: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return format(t.time.hoursAgo, { n: hours });
    return format(t.time.daysAgo, { n: Math.floor(hours / 24) });
  };
}
