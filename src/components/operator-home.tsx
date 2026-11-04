"use client";

import Link from "next/link";
import { useState, type ComponentType } from "react";
import { useErrorMessage, useLiveQuery, useNow } from "@/lib/hooks";
import { format, formatXof } from "@/lib/i18n/format";
import { distanceMeters, scooterMinutes } from "@shared/geo";
import { stationTiles, type StationRole, type StationTile } from "@shared/station-work";
import type { StationView } from "@shared/types";
import { useApp } from "./app-provider";
import { ConfirmSheet } from "./confirm-sheet";
import { BatteryIcon, BoltIcon, BoxIcon, ChartIcon, ChevronIcon, ClipboardIcon, InfoIcon, NavigateIcon, PlugIcon, ScooterIcon, WalletIcon } from "./icons";
import { useI18n } from "./i18n-provider";
import { effectiveStatus } from "./reservation-list";
import { useStationDay } from "./station-work/use-station-day";
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
        className="inline-flex min-h-12 shrink-0 items-center gap-3 rounded-full bg-white/10 py-1.5 pl-4 pr-1.5 text-base font-semibold text-white disabled:opacity-50"
        aria-pressed={isOpen}
      >
        {isOpen ? t.operator.open : t.operator.closed}
        <span
          aria-hidden
          className={`flex h-8 w-14 items-center rounded-full p-1 transition-colors ${isOpen ? "justify-end bg-gp-green" : "justify-start bg-white/25"}`}
        >
          <span className="h-6 w-6 rounded-full bg-white shadow" />
        </span>
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

/** A figure of the day (mockup B1): icon, side note, big number and what it counts. */
function Stat({ icon: Icon, note, value, label }: { icon: ComponentType<{ size?: number }>; note?: string | null; value: string; label: string }) {
  return (
    <div className="rounded-[20px] border border-gp-border bg-gp-surface p-4 shadow-sm dark:border-white/10">
      <div className="flex items-start justify-between gap-2 text-gp-green-dark dark:text-gp-green">
        <Icon size={22} />
        {note && <span className="min-w-0 truncate text-right text-sm text-gp-muted dark:text-zinc-400">{note}</span>}
      </div>
      <div className="mt-2 font-heading text-3xl font-bold leading-tight tabular-nums">{value}</div>
      <div className="text-sm text-gp-muted dark:text-zinc-400">{label}</div>
    </div>
  );
}

/** One service button (mockup B1): a small card with its icon, and a count badge when something waits. */
function ServiceButton({ tile, label, badge }: { tile: StationTile; label: string; badge?: number }) {
  const Icon = TILE_ICON[tile];
  return (
    <Link
      href={TILE_HREF[tile]}
      className="relative flex min-h-24 flex-col items-center justify-center gap-2 rounded-[20px] border border-gp-border bg-gp-surface p-2 text-center active:scale-[0.99] dark:border-white/10"
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-[14px] bg-gp-green/15 text-gp-green-dark dark:text-gp-green">
        <Icon size={22} />
      </span>
      <span className="text-sm font-semibold leading-tight">{label}</span>
      {!!badge && (
        <span className="absolute right-2 top-2 min-w-5 rounded-full bg-gp-closed px-1.5 text-center text-xs font-bold leading-5 text-white">
          {badge > 9 ? "9+" : badge}
        </span>
      )}
    </Link>
  );
}

function StationHome({ station, role }: { station: StationView; role: StationRole }) {
  const { t, locale } = useI18n();
  const D = t.work.day;
  const { backend, features, profile } = useApp();
  const now = useNow(15_000);
  // Share (shared/share.ts): a tile at stations that take Share vehicles, while the module is on.
  const { data: share } = useLiveQuery(
    () => (features.share ? backend.stationShare(station.id).catch(() => null) : Promise.resolve(null)),
    `${station.id}:${features.share}`,
  );
  const swap = (station.activeServices ?? []).includes("swap");
  const { data: reservations } = useLiveQuery(() => backend.stationReservations(station.id), station.id);
  const { data: counter } = useLiveQuery(() => (swap ? backend.stationCounter(station.id).catch(() => null) : Promise.resolve(null)), `${station.id}:${swap}`);
  const { data: day } = useStationDay(station);
  const holding = (reservations ?? []).filter((r) => effectiveStatus(r, now) === "active");
  const active = holding.length;
  const tiles = stationTiles(
    station.activeServices ?? [],
    station.greenCredit,
    station.isOwn,
    !!share && (share.enabled || share.vehicles.length > 0 || share.unpaid.length > 0),
  );
  // An own station without Green Credit: the tile only opens the staff's cash closing.
  const cashOnly = !station.greenCredit;
  const charging = (station.activeServices ?? []).some((s) => s === "charging" || s === "ev");
  const outlets = (station.chargingPoints ?? []).filter((p) => p.deviceId).length || station.chargingSlots;
  const inCharge = counter?.rows.reduce((n, r) => n + r.empty, 0) ?? null;
  const xof = (n: number) => formatXof(n, locale);

  // Types out of stock, with the customers on their way who reserved one (mockup B1 alert).
  const outTypes = (station.batteryTypes ?? []).filter((bt) => bt.fullBatteries <= 0);
  const waitingFor = (id: string) => holding.filter((r) => r.kind === "swap" && r.target === id).length;
  const alert = outTypes.sort((a, b) => waitingFor(b.id) - waitingFor(a.id))[0] ?? null;

  // The next customer: the nearest who shares their position, else the one whose hold ends first.
  const trips = holding.map((r) => ({ r, m: r.customerPosition ? distanceMeters(r.customerPosition, station) : null }));
  const next = [...trips].sort((a, b) => (a.m ?? Infinity) - (b.m ?? Infinity) || a.r.expiresAt.localeCompare(b.r.expiresAt))[0] ?? null;

  return (
    <>
      <section className="rounded-[20px] bg-gp-forest p-4 text-white">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1 basis-56">
            <p className="truncate text-sm text-white/70">
              {profile?.fullName ? `${format(D.hello, { name: profile.fullName.split(" ")[0] })} · ` : ""}
              {t.work.roles[role]}
            </p>
            <h1 className="line-clamp-2 font-heading text-xl font-bold leading-tight">{station.name}</h1>
          </div>
          <OpenToggle station={station} activeReservations={active} />
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3">
        {swap && (
          <Stat
            icon={BatteryIcon}
            note={inCharge ? format(D.charging, { n: inCharge }) : null}
            value={station.batteryCapacity > 0 ? `${station.status.fullBatteries} / ${station.batteryCapacity}` : String(station.status.fullBatteries)}
            label={D.fullBatteries}
          />
        )}
        {charging && <Stat icon={PlugIcon} value={`${freePlaces(station)} / ${outlets}`} label={D.freeOutlets} />}
        {swap && <Stat icon={ScooterIcon} value={day ? String(day.swaps) : "–"} label={D.swapsToday} />}
        <Stat
          icon={WalletIcon}
          note={day && day.creditXof > 0 ? format(D.ofCredit, { amount: formatXof(day.creditXof, locale).replace(/\s?FCFA$/, "") }) : null}
          value={day ? xof(day.takenXof).replace(/\s?FCFA$/, "") : "–"}
          label={D.taken}
        />
      </div>

      {alert && (
        <Link href="/operator/compteur" className="flex items-center gap-3 rounded-[20px] border border-gp-closed/30 bg-gp-closed/10 p-4">
          <InfoIcon size={24} className="shrink-0 text-gp-closed" />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{format(D.outTitle, { type: `${alert.brand} ${alert.name}` })}</span>
            <span className="block text-sm">
              {waitingFor(alert.id) === 0 ? D.outNone : waitingFor(alert.id) === 1 ? D.outOne : format(D.outMany, { n: waitingFor(alert.id) })}
            </span>
          </span>
          <span className="shrink-0 font-semibold text-gp-closed">{D.see}</span>
        </Link>
      )}

      {next && (
        <Link href="/operator/reservations" className="flex items-center gap-3 rounded-[20px] border border-gp-green/30 bg-gp-green/10 p-4">
          <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-gp-green text-gp-forest">
            <NavigateIcon size={22} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{active === 1 ? D.enRouteOne : format(D.enRouteMany, { n: active })}</span>
            <span className="block truncate text-sm text-gp-green-dark dark:text-gp-green">
              {next.m !== null
                ? format(D.next, { name: next.r.customer ?? t.work.reservations.customer, minutes: scooterMinutes(next.m), what: next.r.targetLabel ?? "" })
                : format(D.nextNoPosition, { name: next.r.customer ?? t.work.reservations.customer, what: next.r.targetLabel ?? "" })}
            </span>
          </span>
          <ChevronIcon size={20} className="shrink-0" />
        </Link>
      )}

      {tiles.length === 0 ? (
        <EmptyState text={t.work.noTiles} />
      ) : (
        <section className="space-y-3">
          <h2 className="font-heading text-lg font-semibold">{D.services}</h2>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {tiles.map((tile) => (
              <ServiceButton
                key={tile}
                tile={tile}
                label={tile === "credit" && cashOnly ? t.stationCash.myCash : t.work.tiles[tile]}
                badge={tile === "parcels" ? day?.parcelsWaiting : tile === "reservations" ? active : undefined}
              />
            ))}
          </div>
        </section>
      )}
      <Link
        href="/operator/activite"
        className="flex min-h-12 items-center justify-between rounded-[20px] border border-gp-border bg-gp-surface px-4 font-semibold dark:border-white/10"
      >
        <span className="flex items-center gap-2">
          <ChartIcon size={20} className="text-gp-green-dark dark:text-gp-green" />
          {D.activityTitle}
        </span>
        <ChevronIcon size={20} />
      </Link>
      <Link
        href="/operator/probleme"
        className="flex min-h-12 items-center justify-center rounded-2xl border border-gp-border bg-gp-surface px-4 text-base font-semibold text-amber-800 active:scale-[0.99] dark:text-amber-300"
      >
        {t.work.incident.link}
      </Link>
    </>
  );
}

/** /operator: the station home, one tile per active service, each opening its own page (plan phase 3). */
export function OperatorHome() {
  return <WorkShell home>{({ station, role }) => <StationHome station={station} role={role} />}</WorkShell>;
}
