"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import { BackendError } from "@/lib/backend";
import { format } from "@/lib/i18n/format";

/**
 * Loads data from the backend and reloads it whenever the backend reports a change.
 * Pass a `key` (e.g. a station id) to reload when the thing being loaded changes.
 * When a reload fails, `data` keeps the last good value and `error` is set until
 * the next success; `reload` is also the "Retry" action.
 */
export function useLiveQuery<T>(load: () => Promise<T>, key = "") {
  const { backend } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const loadRef = useRef(load);
  // Only the latest request may update the state: a slow older answer must not overwrite a newer one.
  const latest = useRef(0);

  useEffect(() => {
    loadRef.current = load;
  });

  const reload = useCallback(() => {
    const request = ++latest.current;
    loadRef.current().then(
      (value) => {
        if (request !== latest.current) return;
        setData(value);
        setError(null);
      },
      (err) => {
        if (request === latest.current) setError(err);
      },
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
  return (err: unknown) => {
    if (!(err instanceof BackendError)) return t.errors.unknown;
    // A lock or a request limit that says how long it lasts: say so instead of a fixed time.
    if (err.retryAfter && (err.code === "pin_locked" || err.code === "code_locked" || err.code === "rate_limited")) {
      const n = Math.max(1, Math.ceil(err.retryAfter / 60));
      return format(err.code === "pin_locked" ? t.retry.pinMinutes : t.retry.minutes, { n });
    }
    return t.errors[err.code];
  };
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
