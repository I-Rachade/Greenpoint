"use client";

import { useState, type FormEvent } from "react";
import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import { StationCashCard } from "@/components/owner/cash";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { COMMISSION_MODES, type CommissionMode, type StationCash, type SwapOwner } from "@/lib/station-cash";
import { field, Loading, Pill, StaleNotice } from "./shared";

/** The station type (who owns the swapping) and the host's commission, set by an admin only. */
function SettingsForm({ cash, onChanged }: { cash: StationCash; onChanged: () => void }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const c = t.stationCash;
  const [swapOwner, setSwapOwner] = useState<SwapOwner>(cash.type === "shop" ? "poinderecharge" : "operator");
  const [pct, setPct] = useState(String(cash.commissionPct));
  const [mode, setMode] = useState<CommissionMode>(cash.commissionMode);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setMessage(null);
    try {
      await backend.saveStationCashSettings(cash.stationId, { swapOwner, commissionPct: Number(pct), commissionMode: mode });
      setMessage({ text: c.settingsSaved, ok: true });
      onChanged();
    } catch (err) {
      setMessage({ text: errorMessage(err), ok: false });
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-2 rounded-xl bg-black/5 p-3 text-sm sm:grid-cols-2 dark:bg-white/5">
      <label className="space-y-1">
        <span>{c.type}</span>
        <select className={`${field} w-full`} value={swapOwner} onChange={(e) => setSwapOwner(e.target.value as SwapOwner)}>
          <option value="operator">{c.types.operator}</option>
          <option value="poinderecharge">{c.types.shop}</option>
        </select>
      </label>
      <label className="space-y-1">
        <span>{c.commissionPct}</span>
        <input className={`${field} w-full`} type="number" inputMode="numeric" min={0} max={100} step={1} required value={pct} onChange={(e) => setPct(e.target.value)} />
      </label>
      <label className="space-y-1 sm:col-span-2">
        <span>{c.commissionMode}</span>
        <select className={`${field} w-full`} value={mode} onChange={(e) => setMode(e.target.value as CommissionMode)}>
          {COMMISSION_MODES.map((m) => (
            <option key={m} value={m}>
              {c.commissionModes[m]}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <button type="submit" className="rounded-full bg-gp-green-dark px-4 py-1.5 text-sm text-white">
          {c.saveSettings}
        </button>
        {message && (
          <span role="status" className={message.ok ? "text-gp-green-dark dark:text-gp-green" : "text-red-600"}>
            {message.text}
          </span>
        )}
      </div>
    </form>
  );
}

/** Backoffice: the cash of every partner station, its settings and the handovers to confirm. */
export function StationCashManager() {
  const { t } = useI18n();
  const { backend } = useApp();
  const { data, error, reload } = useLiveQuery(() => backend.ownerCash(null));
  if (!data) return <Loading error={error} onRetry={reload} />;
  const c = t.stationCash;
  const toConfirm = data.reduce((a, s) => a + s.handovers.filter((h) => h.status === "pending").length, 0);
  const late = data.filter((s) => s.late).length;
  // Stations needing action first: handovers to confirm, then late ones.
  const sorted = [...data].sort((a, b) => {
    const rank = (s: StationCash) => (s.handovers.some((h) => h.status === "pending") ? 0 : s.late ? 1 : 2);
    return rank(a) - rank(b) || a.stationName.localeCompare(b.stationName);
  });

  return (
    <div className="space-y-6">
      <StaleNotice error={error} onRetry={reload} />
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{c.title}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{c.intro}</p>
      </div>
      {(toConfirm > 0 || late > 0) && (
        <div className="flex flex-wrap gap-2">
          {toConfirm > 0 && <Pill tone="amber">{format(c.toConfirm, { n: toConfirm })}</Pill>}
          {late > 0 && <Pill tone="red">{format(c.lateCount, { n: late })}</Pill>}
        </div>
      )}
      {data.length === 0 ? (
        <p className="text-sm text-zinc-500">{c.noStations}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {sorted.map((s) => (
            <StationCashCard key={s.stationId} cash={s} admin onChanged={reload} extra={<SettingsForm key={`${s.type}:${s.commissionPct}:${s.commissionMode}`} cash={s} onChanged={reload} />} />
          ))}
        </div>
      )}
    </div>
  );
}
