"use client";

import { BackendError } from "@/lib/backend";
import { useErrorMessage } from "@/lib/hooks";
import { useI18n } from "./i18n-provider";

/** Shown instead of "Loading…" when nothing could be loaded: what went wrong and a "Retry" button. */
export function LoadFailed({ error, onRetry, className = "" }: { error: unknown; onRetry: () => void; className?: string }) {
  const { t } = useI18n();
  const errorMessage = useErrorMessage();
  // A network failure says "check your connection"; a refusal from the server says why.
  const text = error instanceof BackendError && error.code !== "unknown" ? errorMessage(error) : t.ui.loadFailed;
  return (
    <div role="alert" className={`flex flex-col items-center gap-3 p-6 text-center ${className}`}>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{text}</p>
      <button type="button" onClick={onRetry} className="min-h-11 rounded-full bg-gp-green-dark px-5 text-sm font-semibold text-white hover:bg-gp-forest">
        {t.ui.retry}
      </button>
    </div>
  );
}

/** Small notice above data that is still shown although the latest refresh failed. */
export function OfflineNotice({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  return (
    <p role="status" className={`rounded-xl bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/40 dark:text-amber-100 ${className}`}>
      {t.ui.offline}
    </p>
  );
}
