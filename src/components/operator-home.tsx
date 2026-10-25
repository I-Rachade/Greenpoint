"use client";

import Link from "next/link";
import { useState, type ComponentType } from "react";
import { useErrorMessage, useLiveQuery, useNow } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { stationTiles, type StationTile } from "@shared/station-work";
import type { StationView } from "@shared/types";
import { useApp } from "./app-provider";
import { ConfirmSheet } from "./confirm-sheet";
import { BatteryIcon, BoltIcon, BoxIcon, ClipboardIcon, ScooterIcon, WalletIcon } from "./icons";
import { useI18n } from "./i18n-provider";
import { effectiveStatus } from "./reservation-list";
import { WorkShell } from "./station-work/work-shell";
import { EmptyState, useToast } from "./ui";

const TILE_HREF: Record<StationTile, string> = {
  swap: "/operator/echange",
  counter: "/operator/compteur",
  charging: "/operator/recharge",
  parcels: "/operator/colis",
  reservations: "/operator/reservations",
  credit: "/operator/green-credit",
  share: "/operator/share",
};

const TILE_ICON: Record<StationTile, ComponentType<{ size?: number }>> = {
  swap: ScooterIcon,
  counter: BatteryIcon,
  charging: BoltIcon,
  parcels: BoxIcon,
  reservations: ClipboardIcon,
  credit: WalletIcon,
  share: ScooterIcon,
};

function Tile({ tile, hint, label }: { tile: StationTile; hint: string; label?: string }) {
  const { t } = useI18n();
  const Icon = TILE_ICON[tile];
  return (
    <Link
      href={TILE_HREF[tile]}
      className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-2xl bg-gp-forest p-3 text-center text-white shadow-sm active:scale-[0.99]"
    >
      <Icon size={36} />
      <span className="text-lg font-semibold leading-tight">{label ?? t.work.tiles[tile]}</span>
      <span className="text-sm leading-snug text-white/80">{hint}</span>
    </Link>
  );
}

/** Free charging places: connected outlets that are free, else the staff's count. */
function freePlaces(station: StationView): number {
  const points = (station.chargingPoints ?? []).filter((p) => p.deviceId);
  return points.length ? points.filter((p) => p.status === "free").length : station.status.freeSlots;
}

/** Open/close: closing cancels the active reservations on the server, so it is asked first. */
function OpenToggle({ station, activeReservations }: { station: StationView; activeReservations: number }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [confirmClose, setConfirmClose] = useState(false);
  const [busy, setBusy] = useState(false);
  const isOpen = station.status.isOpen;

  async function setOpen(open: boolean) {
    setBusy(true);
    try {
      const { cancelled } = await backend.updateStatus(station.id, { isOpen: open });
      // R17: what closing cancelled, so it can be checked against the warning.
      toast(cancelled > 0 ? format(t.operator.closedCancelled, { n: cancelled }) : t.work.saved, { tone: "success" });
    } catch (err) {
      toast(errorMessage(err), { tone: "error" });
    } finally {
      setBusy(false);
      setConfirmClose(false);
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => (isOpen ? setConfirmClose(true) : void setOpen(true))}
        className={`inline-flex min-h-12 min-w-28 shrink-0 items-center justify-center gap-2 rounded-full px-5 text-base font-semibold text-white disabled:opacity-50 ${
          isOpen ? "bg-gp-green-dark" : "bg-zinc-500"
        }`}
        aria-pressed={isOpen}
      >
        <span className={`h-2.5 w-2.5 rounded-full ${isOpen ? "bg-white" : "bg-white/50"}`} aria-hidden />
        {isOpen ? t.operator.open : t.operator.closed}
      </button>
      <ConfirmSheet
        open={confirmClose}
        title={format(t.operator.closeTitle, { station: station.name })}
        confirmLabel={t.operator.closeConfirm}
        danger
        busy={busy}
        onConfirm={() => void setOpen(false)}
        onCancel={() => setConfirmClose(false)}
      >
        <p>
          {activeReservations === 0
            ? t.operator.closeNone
            : activeReservations === 1
              ? t.operator.closeOne
              : format(t.operator.closeMany, { n: activeReservations })}
        </p>
      </ConfirmSheet>
    </>
  );
}

function StationHome({ station }: { station: StationView }) {
  const { t } = useI18n();
  const { backend, features } = useApp();
  const now = useNow(15_000);
  // Share (shared/share.ts): a tile at stations that take Share vehicles, while the module is on.
  const { data: share } = useLiveQuery(
    () => (features.share ? backend.stationShare(station.id).catch(() => null) : Promise.resolve(null)),
    `${station.id}:${features.share}`,
  );
  const { data: reservations } = useLiveQuery(() => backend.stationReservations(station.id), station.id);
  const active = (reservations ?? []).filter((r) => effectiveStatus(r, now) === "active").length;
  const tiles = stationTiles(
    station.activeServices ?? [],
    station.greenCredit,
    station.isOwn,
    !!share && (share.enabled || share.vehicles.length > 0 || share.unpaid.length > 0),
  );
  // An own station without Green Credit: the tile only opens the staff's cash closing.
  const cashOnly = !station.greenCredit;
  const hint: Record<StationTile, string> = {
    swap: t.work.tileHints.swap,
    counter: format(t.work.tileHints.counter, { n: station.status.fullBatteries }),
    charging: format(t.work.tileHints.charging, { n: freePlaces(station) }),
    parcels: t.work.tileHints.parcels,
    reservations: format(t.work.tileHints.reservations, { n: active }),
    credit: cashOnly ? t.stationCash.myCashHint : t.work.tileHints.credit,
    share: format(t.work.tileHints.share, { n: share?.vehicles.length ?? 0 }),
  };
  return (
    <>
      <div className="flex items-center justify-between gap-3">
        <h1 className="min-w-0 font-heading text-2xl font-semibold">{station.name}</h1>
        <OpenToggle station={station} activeReservations={active} />
      </div>
      {tiles.length === 0 ? (
        <EmptyState text={t.work.noTiles} />
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {tiles.map((tile) => (
            <Tile key={tile} tile={tile} hint={hint[tile]} label={tile === "credit" && cashOnly ? t.stationCash.myCash : undefined} />
          ))}
        </div>
      )}
    </>
  );
}

/** /operator: the station home, one tile per active service, each opening its own page (plan phase 3). */
export function OperatorHome() {
  return <WorkShell home>{({ station }) => <StationHome station={station} />}</WorkShell>;
}
