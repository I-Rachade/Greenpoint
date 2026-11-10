"use client";

import { useState } from "react";
import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import type { OfflineSwapReject } from "@shared/station-work";
import { card, Loading, StaleNotice, useDateTime } from "./shared";

/**
 * Swaps made without network that the server refused (0071): staff no longer at the station,
 * time older than 14 days, data it could not take. The swap happened: the admin corrects the
 * counter or enters it by hand, then marks it dealt with.
 */
export function OfflineRejects() {
  const { t } = useI18n();
  const o = t.offline;
  const { backend } = useApp();
  const formatDateTime = useDateTime();
  const errorMessage = useErrorMessage();
  const { data, error, reload } = useLiveQuery(() => backend.offlineSwapRejects());
  const [message, setMessage] = useState<string | null>(null);
  if (!data) return <Loading error={error} onRetry={reload} />;

  async function resolve(r: OfflineSwapReject) {
    try {
      await backend.resolveOfflineReject(r.id);
      setMessage(null);
      reload();
    } catch (err) {
      setMessage(errorMessage(err));
    }
  }

  const reason = (code: string) => (t.errors as Record<string, string>)[code] ?? code;
  const w = t.work.swap;

  return (
    <div className="space-y-4">
      <StaleNotice error={error} onRetry={reload} />
      <div>
        <h1 className="text-2xl font-semibold">{o.rejectsTitle}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{o.rejectsIntro}</p>
      </div>
      {message && (
        <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {message}
        </p>
      )}
      {data.length === 0 ? (
        <p className="text-sm text-zinc-500">{o.rejectsEmpty}</p>
      ) : (
        <ul className="space-y-3">
          {data.map((r) => (
            <li key={r.id} className={`${card} space-y-1 text-sm`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">{r.stationName ?? r.stationId}</span>
                <button type="button" onClick={() => void resolve(r)} className="rounded-full border border-black/15 px-3 py-1 text-sm dark:border-white/20">
                  {o.rejectResolve}
                </button>
              </div>
              <p className="text-zinc-600 dark:text-zinc-400">
                {o.rejectHappened} {formatDateTime(r.occurredAt)} {o.rejectBy} {r.person}
              </p>
              <p>
                {w.customerTypes[r.input.customerType] ?? r.input.customerType}
                {r.input.batteryOut ? ` · ↑ ${r.input.batteryOut}` : ""}
                {r.input.batteryIn ? ` · ↓ ${r.input.batteryIn}` : ""}
                {r.input.amountXof ? ` · ${r.input.amountXof} FCFA` : ""}
              </p>
              <p className="text-red-700 dark:text-red-300">{reason(r.error)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
