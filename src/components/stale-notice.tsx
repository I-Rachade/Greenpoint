"use client";

import { BackendError } from "@/lib/backend";
import { useErrorMessage } from "@/lib/hooks";
import { useI18n } from "./i18n-provider";

/**
 * Above a working screen whose latest refresh failed: the last data stays on screen,
 * this says why it may be old and offers "Retry". A network failure reads as offline;
 * a refusal from the server says what it was.
 */
export function StaleNotice({ error, onRetry, className = "" }: { error: unknown; onRetry: () => void; className?: string }) {
  const { t } = useI18n();
  const errorMessage = useErrorMessage();
  if (!error) return null;
  const text = error instanceof BackendError && error.code !== "unknown" ? errorMessage(error) : t.ui.offline;
  return (
    <div
      role="status"
      className={`flex flex-wrap items-center gap-2 rounded-xl bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/40 dark:text-amber-100 ${className}`}
    >
      <span className="min-w-0 flex-1">{text}</span>
      <button
        type="button"
        onClick={onRetry}
        className="min-h-11 rounded-full border border-amber-900/30 px-4 font-semibold dark:border-amber-100/30"
      >
        {t.ui.retry}
      </button>
    </div>
  );
}
