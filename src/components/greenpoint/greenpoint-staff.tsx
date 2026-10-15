"use client";

import { useState, type FormEvent } from "react";
import { offersCharging, offersSwap } from "@/lib/availability";
import { formatKg } from "@/lib/greenpoint";
import { useErrorMessage } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { VEHICLE_TYPES, type StationView, type VehicleType } from "@/lib/types";
import { useApp } from "../app-provider";
import { useI18n } from "../i18n-provider";

const input = "w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-base dark:border-white/20 dark:bg-zinc-900";
const button = "rounded-full bg-gp-green-dark px-4 py-2 text-sm font-medium text-white disabled:opacity-50";

/**
 * Station staff: enter a visit without reservation, and confirm a reward code. `only` limits
 * the visits offered (the swap page records swaps itself, so it shows the reward code only).
 */
export function GreenpointStaff({ station, only }: { station: StationView; only?: ("swap" | "charge")[] }) {
  const { t, locale } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const s = t.greenpoint.staff;
  const services = [...(offersSwap(station.kind) ? (["swap"] as const) : []), ...(offersCharging(station.kind) ? (["charge"] as const) : [])].filter(
    (x) => !only || only.includes(x),
  );
  const [contact, setContact] = useState("");
  const [service, setService] = useState<"swap" | "charge">(services[0] ?? "swap");
  const [vehicle, setVehicle] = useState<VehicleType | "">("");
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

  function record(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const r = await backend.recordGreenpointVisit(station.id, { contact, service, vehicle: vehicle || undefined });
      setContact("");
      return format(s.recorded, { person: r.person, kg: formatKg(r.co2Grams, locale), points: r.points });
    });
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
      {services.length > 0 && (
        <form onSubmit={record} className="space-y-2">
          <div className="text-sm font-medium">{s.visit}</div>
          <p className="text-xs text-zinc-500">{s.visitHint}</p>
          <input
            required
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="+228 90 00 00 00"
            aria-label={s.contact}
            className={input}
          />
          <div className="flex flex-wrap gap-2">
            <select value={service} onChange={(e) => setService(e.target.value as "swap" | "charge")} aria-label={s.service} className={`${input} flex-1`}>
              {services.map((x) => (
                <option key={x} value={x}>
                  {s[x]}
                </option>
              ))}
            </select>
            <select value={vehicle} onChange={(e) => setVehicle(e.target.value as VehicleType | "")} aria-label={s.vehicle} className={`${input} flex-1`}>
              <option value="">{s.vehicleAsSaved}</option>
              {VEHICLE_TYPES.map((v) => (
                <option key={v} value={v}>
                  {t.vehicles[v]}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" disabled={busy} className={button}>
            {s.record}
          </button>
        </form>
      )}
      <form onSubmit={confirm} className="space-y-2 border-t border-black/10 pt-3 dark:border-white/10">
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
