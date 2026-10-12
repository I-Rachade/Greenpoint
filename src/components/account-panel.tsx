"use client";

import { useState, type FormEvent } from "react";
import { CONTACT_EMAIL } from "@/lib/config";
import { useErrorMessage } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { PIN_LENGTH } from "@/lib/pin";
import { useApp } from "./app-provider";
import { useI18n } from "./i18n-provider";

/**
 * "My account" with self-service deletion. Also the public page Google Play links
 * to (app.poinderecharge.com/compte): logged-out visitors learn how to delete.
 */
export function AccountPanel() {
  const { t } = useI18n();
  const { backend, profile, ready } = useApp();
  const errorMessage = useErrorMessage();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

  function remove(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    backend
      .deleteAccount(pin)
      .then(() => setDeleted(true))
      .catch((err) => setError(errorMessage(err)))
      .finally(() => {
        setBusy(false);
        setPin("");
      });
  }

  if (!ready) return <p className="p-6 text-sm text-zinc-500">{t.loading}</p>;

  return (
    <div className="mx-auto w-full max-w-sm space-y-6 p-6">
      <h1 className="text-2xl font-semibold">{t.account.title}</h1>

      {deleted ? (
        <p className="rounded-lg bg-gp-green/10 p-3 text-sm">{t.account.deleted}</p>
      ) : !profile ? (
        <section className="space-y-2">
          <h2 className="font-semibold">{t.account.deleteTitle}</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {format(t.account.loggedOutText, { email: CONTACT_EMAIL })}
          </p>
        </section>
      ) : (
        <>
          <p className="text-sm">
            <span className="text-zinc-500">{t.account.phone} : </span>
            <span className="font-medium">{profile.phone}</span>
          </p>

          <form onSubmit={remove} className="space-y-3 rounded-lg border border-red-200 p-4 dark:border-red-900">
            <h2 className="font-semibold text-red-700 dark:text-red-400">{t.account.deleteTitle}</h2>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.account.deleteText}</p>
            <label className="block space-y-1">
              <span className="text-sm font-medium">{t.account.deletePin}</span>
              <input
                className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-base tracking-[0.4em] dark:border-white/20 dark:bg-zinc-900"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                maxLength={PIN_LENGTH}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, PIN_LENGTH))}
                required
              />
            </label>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <button
              type="submit"
              disabled={busy || pin.length < PIN_LENGTH}
              className="w-full rounded-full bg-red-600 px-4 py-2 font-medium text-white disabled:opacity-50"
            >
              {t.account.deleteButton}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
