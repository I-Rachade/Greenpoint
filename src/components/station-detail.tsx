"use client";

import Link from "next/link";
import { useState } from "react";
import {
  availableBatteries,
  availableSlots,
  isStale,
  offersCharging,
  offersSwap,
  stationAvailability,
  withinOpeningHours,
} from "@/lib/availability";
import { directionsUrl, formatDistance } from "@/lib/geo";
import { displayStatus, type ChargingPointDisplay } from "@/lib/iot/charging-points";
import { useErrorMessage, useNow, useRelativeTime } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { RESERVATION_MINUTES, type ReservationType, type StationView } from "@/lib/types";
import { useApp } from "./app-provider";
import { AvailabilityBadge } from "./availability-badge";
import { useI18n } from "./i18n-provider";

const OUTLET_COLORS: Record<ChargingPointDisplay, string> = {
  free: "bg-green-600",
  reserved: "bg-amber-500",
  charging: "bg-sky-600",
  done: "bg-sky-600",
  fault: "bg-red-600",
  offline: "bg-zinc-400",
};

interface Props {
  station: StationView;
  distance: number | null;
  onClose: () => void;
  onChanged: () => void;
}

export function StationDetail({ station, distance, onClose, onChanged }: Props) {
  const { t } = useI18n();
  const { backend, profile } = useApp();
  const now = useNow();
  const relativeTime = useRelativeTime();
  const errorMessage = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function reserve(type: ReservationType) {
    setBusy(true);
    setMessage(null);
    try {
      const reservation = await backend.reserve(station.id, type);
      setMessage({
        ok: true,
        text: format(t.station.reserved, { code: reservation.pickupCode ?? "–", minutes: RESERVATION_MINUTES }),
      });
      onChanged();
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  const slots = availableSlots(station, now);
  const points = station.chargingPoints ?? [];
  const connected = points.some((p) => p.deviceId !== null);
  const batteries = availableBatteries(station);

  return (
    <div className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{station.name}</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {station.address}
            {distance !== null && ` · ${formatDistance(distance)}`}
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-2xl leading-none text-zinc-500" aria-label={t.station.close}>
          ×
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <AvailabilityBadge value={stationAvailability(station)} />
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 dark:bg-zinc-800">{t.kinds[station.kind]}</span>
        {station.vehicleTypes.map((v) => (
          <span key={v} className="rounded-full bg-zinc-100 px-2 py-0.5 dark:bg-zinc-800">
            {t.vehicles[v]}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {offersCharging(station.kind) && (
          <div className="rounded-lg bg-gp-green/10 p-3 dark:bg-gp-green/15">
            <div className="text-2xl font-bold text-gp-green-dark dark:text-gp-green">
              {slots}
              <span className="text-sm font-normal text-zinc-500"> / {station.chargingSlots}</span>
            </div>
            <div className="text-xs text-zinc-600 dark:text-zinc-400">{t.station.freeSlots}</div>
          </div>
        )}
        {offersSwap(station.kind) && (
          <div className="rounded-lg bg-gp-green/10 p-3 dark:bg-gp-green/15">
            <div className="text-2xl font-bold text-gp-green-dark dark:text-gp-green">
              {batteries}
              <span className="text-sm font-normal text-zinc-500"> / {station.batteryCapacity}</span>
            </div>
            <div className="text-xs text-zinc-600 dark:text-zinc-400">{t.station.fullBatteries}</div>
          </div>
        )}
      </div>

      {points.length > 0 && (
        <div>
          <h3 className="text-sm font-medium">{connected ? t.station.liveOutlets : t.station.outlets}</h3>
          <ul className="mt-1 divide-y divide-zinc-100 text-sm dark:divide-zinc-800">
            {points.map((p) => {
              const shown = displayStatus(p, now);
              return (
                <li key={p.id} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${OUTLET_COLORS[shown]}`} aria-hidden />
                    {p.label}
                  </span>
                  <span className="text-zinc-600 dark:text-zinc-400">
                    {t.station.outletStatus[shown]}
                    {shown === "charging" && p.powerWatts ? ` · ${p.powerWatts} W` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-zinc-500">{t.station.openingHours}</dt>
        <dd>{station.openingHours || "–"}</dd>
        <dt className="text-zinc-500">{t.station.operator}</dt>
        <dd>{station.operatorName}</dd>
      </dl>
      <p className="text-xs text-zinc-500">
        {format(t.station.updated, { time: relativeTime(station.status.updatedAt, now) })}
      </p>
      {station.status.isOpen && !withinOpeningHours(station.openingHours, now) && (
        <p className="text-sm text-red-700 dark:text-red-400">{t.station.outsideHours}</p>
      )}
      {isStale(station, now) && <p className="text-sm text-amber-700 dark:text-amber-400">{t.station.stale}</p>}

      <div className="flex flex-wrap gap-2">
        <a
          href={directionsUrl(station)}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-full border border-gp-green-dark px-4 py-2 text-sm font-medium text-gp-green-dark dark:text-gp-green"
        >
          {t.station.directions}
        </a>
        {station.phone && (
          <a href={`tel:${station.phone}`} className="rounded-full border border-zinc-300 px-4 py-2 text-sm dark:border-zinc-700">
            {t.station.call}
          </a>
        )}
      </div>

      {profile ? (
        <div className="flex flex-wrap gap-2">
          {offersSwap(station.kind) && (
            <button
              type="button"
              disabled={busy || batteries === 0}
              onClick={() => reserve("battery")}
              className="rounded-full bg-gp-green-dark px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {t.station.reserveBattery}
            </button>
          )}
          {offersCharging(station.kind) && (
            <button
              type="button"
              disabled={busy || slots === 0}
              onClick={() => reserve("slot")}
              className="rounded-full bg-gp-green-dark px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            >
              {t.station.reserveSlot}
            </button>
          )}
        </div>
      ) : (
        <Link href="/login" className="inline-block rounded-full bg-gp-green-dark px-4 py-2 text-sm font-medium text-white">
          {t.station.loginToReserve}
        </Link>
      )}

      {message && (
        <p role="status" className={`text-sm ${message.ok ? "text-gp-green-dark dark:text-gp-green" : "text-red-600"}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
