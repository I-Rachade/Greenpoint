"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useI18n } from "./i18n-provider";

/**
 * Asks before a step that cannot be undone (closing a station, stopping a charge,
 * booking cash, cancelling a reservation, sending money). A native <dialog>, so
 * Escape, focus and the back gesture work; it slides up from the bottom on phones.
 */
export function ConfirmSheet({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel,
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel: string;
  /** Defaults to "Cancel"; give e.g. "Keep" when the action itself is a cancellation. */
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onCancel();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
      aria-labelledby="confirm-sheet-title"
      className="gp-sheet m-0 mt-auto w-full max-w-none rounded-t-3xl bg-white p-0 text-gp-forest shadow-xl sm:m-auto sm:max-w-md sm:rounded-3xl dark:bg-gp-surface dark:text-zinc-100"
    >
      {open && (
        <div className="space-y-4 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto h-1 w-10 rounded-full bg-zinc-300 sm:hidden dark:bg-white/20" aria-hidden />
          <h2 id="confirm-sheet-title" className="font-heading text-lg font-semibold leading-snug">
            {title}
          </h2>
          {children && <div className="space-y-2 text-base text-zinc-700 dark:text-zinc-300">{children}</div>}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={busy}
              className="min-h-12 rounded-full border border-black/10 px-4 font-semibold disabled:opacity-40 dark:border-white/15"
            >
              {cancelLabel ?? t.ui.cancel}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={busy}
              autoFocus
              className={`min-h-12 rounded-full px-4 font-semibold text-white disabled:opacity-40 ${
                danger ? "bg-gp-closed hover:bg-red-700" : "bg-gp-green-dark hover:bg-gp-forest"
              }`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
