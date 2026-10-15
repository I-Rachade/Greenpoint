"use client";

import { BackendError } from "@/lib/backend";
import { useErrorMessage } from "@/lib/hooks";
import { useI18n } from "./i18n-provider";
import { Button } from "./ui";

/** Network failures read as "check your connection"; a refusal from the server says why. */
function useFailureText(fallback: "loadFailed" | "offline") {
  const { t } = useI18n();
  const errorMessage = useErrorMessage();
  return (error: unknown) => (error instanceof BackendError && error.code !== "unknown" ? errorMessage(error) : t.ui[fallback]);
}

/** Shown instead of "Loading…" when nothing could be loaded: what went wrong and a "Retry" button. */
export function LoadFailed({ error, onRetry, className = "" }: { error: unknown; onRetry: () => void; className?: string }) {
  const { t } = useI18n();
  const text = useFailureText("loadFailed")(error);
  return (
    <div role="alert" className={`flex flex-col items-center gap-3 p-6 text-center ${className}`}>
      <p className="text-sm text-gp-muted">{text}</p>
      <Button onClick={onRetry}>{t.ui.retry}</Button>
    </div>
  );
}

const NOTICE = "rounded-xl bg-amber-100 px-3 py-2 text-sm text-amber-900 dark:bg-amber-900/40 dark:text-amber-100";

/** Small notice above data that is still shown although the latest refresh failed. */
export function OfflineNotice({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  return (
    <p role="status" className={`${NOTICE} ${className}`}>
      {t.ui.offline}
    </p>
  );
}

/**
 * Above a working screen whose latest refresh failed: the last data stays on screen,
 * this says why it may be old and offers "Retry". Renders nothing without an error.
 */
export function StaleNotice({ error, onRetry, className = "" }: { error: unknown; onRetry: () => void; className?: string }) {
  const { t } = useI18n();
  const failureText = useFailureText("offline");
  if (!error) return null;
  return (
    <div role="status" className={`flex flex-wrap items-center gap-2 ${NOTICE} ${className}`}>
      <span className="min-w-0 flex-1">{failureText(error)}</span>
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
