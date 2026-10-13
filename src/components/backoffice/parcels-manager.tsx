"use client";

import { useState } from "react";
import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import { ParcelStatusPill } from "@/components/parcels/status";
import { useErrorMessage, useLiveQuery, useNow } from "@/lib/hooks";
import { OPEN_PARCEL_STATUSES, type ParcelDepot, type ParcelSizeTier, type ParcelStatus } from "@/lib/parcels";
import type { StationView } from "@/lib/types";
import { card, field, Loading, Pill, Table, td, th, useDateTime } from "./shared";

const STATUSES: ParcelStatus[] = ["deposited", "in_transit", "arrived", "picked_up", "stored", "released", "auctioned", "cancelled"];

function DepotRow({ station, depot, onSaved }: { station: StationView; depot: ParcelDepot | undefined; onSaved: (msg: string, ok: boolean) => void }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const [isActive, setActive] = useState(depot?.isActive ?? false);
  const [note, setNote] = useState(depot?.note ?? "");
  const [lockers, setLockers] = useState(String(depot?.lockers ?? 0));
  const dirty = isActive !== (depot?.isActive ?? false) || note !== (depot?.note ?? "") || Number(lockers) !== (depot?.lockers ?? 0);

  async function save() {
    try {
      await backend.saveParcelDepot(station.id, { isActive, note, lockers: Math.max(0, Math.floor(Number(lockers) || 0)) });
      onSaved(t.parcels.admin.saved, true);
    } catch (err) {
      onSaved(errorMessage(err), false);
    }
  }

  return (
    <tr>
      <td className={td}>{station.name}</td>
      <td className={td}>
        <input type="checkbox" aria-label={t.parcels.admin.depotActive} checked={isActive} onChange={(e) => setActive(e.target.checked)} />
      </td>
      <td className={td}>
        <input className={`${field} w-full`} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} aria-label={t.parcels.admin.depotNote} />
      </td>
      <td className={td}>
        <input className={`${field} w-20`} inputMode="numeric" value={lockers} onChange={(e) => setLockers(e.target.value.replace(/\D/g, ""))} aria-label={t.parcels.admin.depotLockers} />
      </td>
      <td className={td}>
        <button type="button" disabled={!dirty} onClick={save} className="rounded-full bg-gp-green-dark px-3 py-1 text-xs text-white disabled:opacity-30">
          {t.parcels.admin.save}
        </button>
      </td>
    </tr>
  );
}

function SizesEditor({ sizes, onSaved }: { sizes: ParcelSizeTier[]; onSaved: (msg: string, ok: boolean) => void }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const [rows, setRows] = useState(sizes.map((s) => ({ ...s })));
  const set = (i: number, key: keyof Omit<ParcelSizeTier, "size">, value: string) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, [key]: Number(value.replace(",", ".")) || 0 } : row)));

  async function save() {
    try {
      await backend.saveParcelSizes(rows.map((r) => ({ ...r, priceFcfa: Math.round(r.priceFcfa) })));
      onSaved(t.parcels.admin.saved, true);
    } catch (err) {
      onSaved(errorMessage(err), false);
    }
  }

  const num = `${field} w-16`;
  return (
    <div className="space-y-2">
      <Table
        head={
          <>
            <th className={th}>{t.parcels.size}</th>
            <th className={th}>{t.parcels.admin.maxDims}</th>
            <th className={th}>{t.parcels.admin.maxWeight}</th>
            <th className={th}>{t.parcels.admin.priceFcfa}</th>
          </>
        }
      >
        {rows.map((r, i) => (
          <tr key={r.size}>
            <td className={`${td} font-semibold`}>{r.size}</td>
            <td className={td}>
              <span className="flex items-center gap-1">
                <input className={num} inputMode="decimal" value={r.maxLengthCm} onChange={(e) => set(i, "maxLengthCm", e.target.value)} aria-label={`${r.size} L`} />×
                <input className={num} inputMode="decimal" value={r.maxWidthCm} onChange={(e) => set(i, "maxWidthCm", e.target.value)} aria-label={`${r.size} l`} />×
                <input className={num} inputMode="decimal" value={r.maxHeightCm} onChange={(e) => set(i, "maxHeightCm", e.target.value)} aria-label={`${r.size} h`} />
              </span>
            </td>
            <td className={td}>
              <input className={num} inputMode="decimal" value={r.maxWeightKg} onChange={(e) => set(i, "maxWeightKg", e.target.value)} aria-label={`${r.size} kg`} />
            </td>
            <td className={td}>
              <input className={`${field} w-24`} inputMode="numeric" value={r.priceFcfa} onChange={(e) => set(i, "priceFcfa", e.target.value)} aria-label={`${r.size} FCFA`} />
            </td>
          </tr>
        ))}
      </Table>
      <button type="button" onClick={save} className="rounded-full bg-gp-green-dark px-4 py-1.5 text-sm text-white">
        {t.parcels.admin.save}
      </button>
    </div>
  );
}

/** Switches the whole parcel module (depot, partner API, driver pickups) on or off for everyone. */
export function ParcelsModuleSwitch() {
  const { t } = useI18n();
  const { backend, features, featuresReady } = useApp();
  const errorMessage = useErrorMessage();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const a = t.parcels.admin;
  if (!featuresReady) return null;
  const on = features.parcels;

  async function toggle() {
    if (on && !window.confirm(a.confirmOff)) return;
    setBusy(true);
    setError("");
    try {
      await backend.setParcelsEnabled(!on);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`${card} space-y-2`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs uppercase tracking-wide text-zinc-500">{a.module}</span>
        <Pill tone={on ? "green" : "amber"}>{on ? a.moduleOn : a.moduleOff}</Pill>
        <button type="button" disabled={busy} onClick={toggle} className="text-sm text-gp-green-dark underline disabled:opacity-40 dark:text-gp-green">
          {on ? a.turnOff : a.turnOn}
        </button>
      </div>
      {!on && <p className="text-sm text-amber-700 dark:text-amber-300">{a.offHint}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}

export function ParcelsManager() {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const when = useDateTime();
  const now = useNow(60_000);
  const { data, error, reload } = useLiveQuery(() => Promise.all([backend.adminParcels(), backend.adminSnapshot()]));
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [status, setStatus] = useState<ParcelStatus | "">("");

  if (!data) return <Loading error={error} />;
  const [{ parcels, depots, sizes }, snap] = data;
  const name = (id: string) => snap.stations.find((s) => s.id === id)?.name ?? id;
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000).toISOString();
  const kpis = [
    { label: t.parcels.admin.kpiOpen, value: parcels.filter((p) => OPEN_PARCEL_STATUSES.includes(p.status)).length },
    { label: t.parcels.admin.kpiWaiting, value: parcels.filter((p) => p.status === "arrived").length },
    { label: t.parcels.admin.kpiStored, value: parcels.filter((p) => p.status === "stored").length },
    {
      label: t.parcels.admin.kpiRevenue,
      value: `${parcels.filter((p) => p.status !== "cancelled" && p.createdAt >= monthAgo).reduce((sum, p) => sum + p.priceFcfa, 0)} FCFA`,
    },
  ];
  const shown = status ? parcels.filter((p) => p.status === status) : parcels;
  const onSaved = (text: string, ok: boolean) => {
    setMessage({ text, ok });
    if (ok) reload();
  };

  async function close(id: string, outcome: "released" | "auctioned") {
    if (outcome === "auctioned" && !window.confirm(t.parcels.admin.confirmAuction)) return;
    try {
      await backend.closeStoredParcel(id, outcome);
      reload();
    } catch (err) {
      setMessage({ text: errorMessage(err), ok: false });
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t.parcels.admin.title}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.parcels.admin.intro}</p>
      </div>
      <ParcelsModuleSwitch />
      {message && (
        <p role="status" className={`text-sm ${message.ok ? "text-gp-green-dark dark:text-gp-green" : "text-red-600"}`}>
          {message.text}
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className={card}>
            <div className="text-xs text-zinc-500">{k.label}</div>
            <div className="text-2xl font-semibold tabular-nums">{k.value}</div>
          </div>
        ))}
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{t.parcels.admin.depotsTitle}</h2>
        <Table
          head={
            <>
              <th className={th}>{t.backoffice.nav.stations}</th>
              <th className={th}>{t.parcels.admin.depotActive}</th>
              <th className={th}>{t.parcels.admin.depotNote}</th>
              <th className={th}>{t.parcels.admin.depotLockers}</th>
              <th className={th} />
            </>
          }
        >
          {snap.stations
            .filter((s) => s.isActive)
            .map((s) => {
              const depot = depots.find((d) => d.stationId === s.id);
              // Remount after a save so the row starts from the stored values.
              return <DepotRow key={`${s.id}:${depot?.isActive}:${depot?.note}:${depot?.lockers}`} station={s} depot={depot} onSaved={onSaved} />;
            })}
        </Table>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{t.parcels.admin.sizesTitle}</h2>
        <SizesEditor key={JSON.stringify(sizes)} sizes={sizes} onSaved={onSaved} />
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">{t.parcels.admin.listTitle}</h2>
          <select className={field} value={status} onChange={(e) => setStatus(e.target.value as ParcelStatus | "")}>
            <option value="">{t.parcels.admin.allStatuses}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t.parcels.status[s]}
              </option>
            ))}
          </select>
        </div>
        <Table
          head={
            <>
              <th className={th}>N°</th>
              <th className={th}>{t.parcels.admin.created}</th>
              <th className={th}>
                {t.parcels.from} → {t.parcels.to}
              </th>
              <th className={th}>
                {t.parcels.sender} / {t.parcels.recipient}
              </th>
              <th className={th}>{t.parcels.content}</th>
              <th className={th}>{t.parcels.price}</th>
              <th className={th} />
            </>
          }
        >
          {shown.map((p) => (
            <tr key={p.id}>
              <td className={`${td} font-mono`}>{p.trackingNo}</td>
              <td className={td}>{when(p.createdAt)}</td>
              <td className={td}>
                {name(p.fromStationId)} → {name(p.toStationId)}
              </td>
              <td className={td}>
                {p.sender.phone}
                <br />
                {p.recipient.phone}
              </td>
              <td className={td}>
                {p.content} ({p.size}, {p.measures.weightKg} kg)
              </td>
              <td className={td}>{p.priceFcfa}</td>
              <td className={td}>
                <div className="flex flex-col items-start gap-1">
                  <ParcelStatusPill status={p.status} />
                  {p.status === "stored" && (
                    <span className="flex gap-1">
                      <button type="button" className="rounded-full border border-black/15 px-2 py-0.5 text-xs dark:border-white/20" onClick={() => close(p.id, "released")}>
                        {t.parcels.admin.released}
                      </button>
                      <button type="button" className="rounded-full border border-black/15 px-2 py-0.5 text-xs dark:border-white/20" onClick={() => close(p.id, "auctioned")}>
                        {t.parcels.admin.auctioned}
                      </button>
                    </span>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </Table>
      </section>
    </div>
  );
}
