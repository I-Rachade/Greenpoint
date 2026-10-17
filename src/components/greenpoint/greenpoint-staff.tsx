"use client";

import { useState, type FormEvent } from "react";
import { useErrorMessage } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import type { StationView } from "@/lib/types";
import { useApp } from "../app-provider";
import { useI18n } from "../i18n-provider";

const input = "w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-base dark:border-white/20 dark:bg-zinc-900";
const button = "rounded-full bg-gp-green-dark px-4 py-2 text-sm font-medium text-white disabled:opacity-50";

/**
 * Station staff: confirm a reward code. Staff cannot add greenpoints: they come by themselves
 * with a swap or charge of an app customer at a solar station (worker/greenpoint.ts).
 */
export function GreenpointStaff({ station }: { station: StationView }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const s = t.greenpoint.staff;
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(action: () => Promise<string>) {
    setBusy(true);
    setResult(null);
    try {
      setResult({ ok: true, text: await action() });
    } catch (err) {
      setResult({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  function confirm(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const r = await backend.confirmRedemption(station.id, code);
      setCode("");
      return format(s.confirmed, { person: r.person, reward: r.rewardTitle ?? "", points: r.points });
    });
  }

  return (
    <section className="space-y-3 rounded-xl border border-black/10 p-4 dark:border-white/10">
      <h3 className="text-sm font-semibold">🌱 {s.title}</h3>
      {result && (
        <p role={result.ok ? "status" : "alert"} className={`text-sm ${result.ok ? "text-gp-green-dark dark:text-gp-green" : "text-red-600"}`}>
          {result.text}
        </p>
      )}
      <form onSubmit={confirm} className="space-y-2">
        <div className="text-sm font-medium">{s.redeem}</div>
        <p className="text-xs text-zinc-500">{s.redeemHint}</p>
        <div className="flex gap-2">
          <input
            required
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            placeholder="000000"
            aria-label={s.redeem}
            className={`${input} w-36 text-center font-mono tracking-widest`}
          />
          <button type="submit" disabled={busy} className={button}>
            {s.confirm}
          </button>
        </div>
      </form>
    </section>
  );
}
