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
import { BatteryIcon, BoltIcon, BoxIcon, ClockIcon, NavigateIcon, PhoneIcon, PinIcon, StoreIcon } from "./icons";
import { useI18n } from "./i18n-provider";
import { FavoriteButton } from "./station-card";

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
  /** Shows a close button (map side panel); the full station screen has a back arrow instead. */
  onClose?: () => void;
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

  const battery = station.kind !== "parcel";
  const slots = availableSlots(station, now);
  const points = station.chargingPoints ?? [];
  const connected = points.some((p) => p.deviceId !== null);
  const batteries = availableBatteries(station);

  const tile = (value: number, total: number, label: string, Icon: typeof BoltIcon) => (
    <div className="rounded-2xl bg-gp-green/10 p-3 dark:bg-gp-green/15">
      <div className="flex items-center gap-2 text-gp-green-dark dark:text-gp-green">
        <Icon size={20} />
        <span className="text-2xl font-bold">
          {value}
          <span className="text-sm font-normal text-gp-muted"> / {total}</span>
        </span>
      </div>
      <div className="mt-0.5 text-xs text-gp-muted dark:text-zinc-400">{label}</div>
    </div>
  );
  const infoRow = (Icon: typeof BoltIcon, label: string, value: string) => (
    <li className="flex items-start gap-3 py-2.5">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gp-green/10 text-gp-green-dark dark:text-gp-green">
        <Icon size={17} />
      </span>
      <span className="min-w-0">
        <span className="block text-xs text-gp-muted dark:text-zinc-400">{label}</span>
        <span className="block text-sm">{value}</span>
      </span>
    </li>
  );
  const primary =
    "flex flex-1 items-center justify-center gap-2 rounded-full bg-gp-green-dark px-4 py-3 text-sm font-semibold text-white shadow-sm disabled:opacity-40";
  const secondary =
    "flex flex-1 items-center justify-center gap-2 rounded-full border-2 border-gp-green-dark px-4 py-2.5 text-sm font-semibold text-gp-green-dark dark:border-gp-green dark:text-gp-green";

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-xl font-semibold">{station.name}</h2>
          <p className="text-sm text-gp-muted dark:text-zinc-400">
            {station.address}
            {distance !== null && ` · ${formatDistance(distance)}`}
          </p>
        </div>
        <FavoriteButton stationId={station.id} />
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex h-10 w-10 items-center justify-center rounded-full text-2xl leading-none text-gp-muted hover:bg-black/5 dark:hover:bg-white/10"
            aria-label={t.station.close}
          >
            ×
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <AvailabilityBadge value={stationAvailability(station)} />
        <span className="rounded-full bg-gp-border/60 px-2 py-0.5 dark:bg-white/10">{t.kinds[station.kind]}</span>
        {station.vehicleTypes.map((v) => (
          <span key={v} className="rounded-full bg-gp-border/60 px-2 py-0.5 dark:bg-white/10">
            {t.vehicles[v]}
          </span>
        ))}
      </div>

      {battery && (
        <div className="grid grid-cols-2 gap-3">
          {offersCharging(station.kind) && tile(slots, station.chargingSlots, t.station.freeSlots, BoltIcon)}
          {offersSwap(station.kind) && tile(batteries, station.batteryCapacity, t.station.fullBatteries, BatteryIcon)}
        </div>
      )}

      {station.parcelPoint && (station.parcelPoint.counter || station.parcelPoint.lockers > 0) && (
        <div className="rounded-2xl border border-gp-border bg-gp-surface px-3 dark:border-white/10">
          <h3 className="pt-3 text-sm font-semibold">{t.station.services}</h3>
          <ul className="divide-y divide-gp-border dark:divide-white/10">
            {station.parcelPoint.counter && infoRow(BoxIcon, t.station.parcelCounter, "✓")}
            {station.parcelPoint.lockers > 0 &&
              infoRow(BoxIcon, t.station.parcelLockers, format(t.station.lockers, { n: station.parcelPoint.lockers }))}
          </ul>
        </div>
      )}

      {points.length > 0 && (
        <div className="rounded-2xl border border-gp-border bg-gp-surface p-3 dark:border-white/10">
          <h3 className="text-sm font-semibold">{connected ? t.station.liveOutlets : t.station.outlets}</h3>
          <ul className="mt-1 divide-y divide-gp-border text-sm dark:divide-white/10">
            {points.map((p) => {
              const shown = displayStatus(p, now);
              return (
                <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                  <span className="flex items-center gap-2">
                    <span className={`h-2.5 w-2.5 rounded-full ${OUTLET_COLORS[shown]}`} aria-hidden />
                    {p.label}
                  </span>
                  <span className="text-gp-muted dark:text-zinc-400">
                    {t.station.outletStatus[shown]}
                    {shown === "charging" && p.powerWatts ? ` · ${p.powerWatts} W` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="rounded-2xl border border-gp-border bg-gp-surface px-3 dark:border-white/10">
        <h3 className="pt-3 text-sm font-semibold">{t.ui.detail.about}</h3>
        <ul className="divide-y divide-gp-border dark:divide-white/10">
          {infoRow(ClockIcon, t.station.openingHours, station.openingHours || "–")}
          {infoRow(PinIcon, t.ui.detail.address, station.address)}
          {infoRow(StoreIcon, t.station.operator, station.operatorName)}
        </ul>
      </div>

      {battery && (
        <p className="text-xs text-gp-muted">
          {format(t.station.updated, { time: relativeTime(station.status.updatedAt, now) })}
        </p>
      )}
      {station.status.isOpen && !withinOpeningHours(station.openingHours, now) && (
        <p className="text-sm text-red-700 dark:text-red-400">{t.station.outsideHours}</p>
      )}
      {battery && isStale(station, now) && <p className="text-sm text-amber-700 dark:text-amber-400">{t.station.stale}</p>}

      <div className="flex gap-2">
        <a href={directionsUrl(station)} target="_blank" rel="noopener noreferrer" className={secondary}>
          <NavigateIcon size={18} />
          {t.station.directions}
        </a>
        {station.phone && (
          <a href={`tel:${station.phone}`} className={secondary}>
            <PhoneIcon size={18} />
            {t.station.call}
          </a>
        )}
      </div>

      {!battery ? null : profile ? (
        <div className="flex flex-wrap gap-2">
          {offersSwap(station.kind) && (
            <button type="button" disabled={busy || batteries === 0} onClick={() => reserve("battery")} className={primary}>
              <BatteryIcon size={18} />
              {t.station.reserveBattery}
            </button>
          )}
          {offersCharging(station.kind) && (
            <button type="button" disabled={busy || slots === 0} onClick={() => reserve("slot")} className={primary}>
              <BoltIcon size={18} />
              {t.station.reserveSlot}
            </button>
          )}
        </div>
      ) : (
        <Link href="/login" className={primary}>
          {t.station.loginToReserve}
        </Link>
      )}

      {message && (
        <p
          role="status"
          className={`rounded-xl px-3 py-2 text-sm ${
            message.ok ? "bg-gp-green/15 text-gp-forest dark:text-gp-green" : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}
