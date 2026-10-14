"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  availableBatteries,
  availableSlots,
  isStale,
  offersCharging,
  offersSwap,
  stockBatteries,
  withinOpeningHours,
} from "@/lib/availability";
import { batteryTypeLabel } from "@/lib/battery-types";
import { directionsUrl, formatDistance } from "@/lib/geo";
import { displayStatus, type ChargingPointDisplay } from "@/lib/iot/charging-points";
import { useErrorMessage, useNow, useRelativeTime } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { AMENITIES, stationPhotos } from "@/lib/station-extras";
import { RESERVATION_MINUTES, type ReservationType, type StationView } from "@/lib/types";
import { usePosition } from "@/lib/use-position";
import { useApp } from "./app-provider";
import { BackIcon, BatteryIcon, BoltIcon, BoxIcon, CarIcon, ClockIcon, NavigateIcon, PhoneIcon, PinIcon, ShareIcon, StoreIcon, SunIcon } from "./icons";
import { useI18n } from "./i18n-provider";
import { EvBadge, FavoriteButton, RestBadge } from "./station-card";
import { AMENITY_ICONS, OpenBadge, RatingInline, useHoursLabel } from "./station-look";
import { SolarBadge } from "./solar-badge";
import { StationReviews } from "./station-reviews";

const StationMap = dynamic(() => import("./station-map").then((m) => m.StationMap), { ssr: false });

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
  onChanged: () => void;
}

function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h2 className="font-heading text-lg font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Round white button laid over the photo. */
const overlayButton =
  "flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-gp-forest shadow-md backdrop-blur hover:bg-white";

/** Swipeable photos with dots; an illustration while the station has no photo. */
function PhotoGallery({ station, scrollerRef }: { station: StationView; scrollerRef: React.RefObject<HTMLDivElement | null> }) {
  const { t } = useI18n();
  const photos = stationPhotos(station);
  const illustration = !station.photos?.length;
  const [index, setIndex] = useState(0);
  return (
    <div className="relative h-64 overflow-hidden bg-gp-forest sm:h-80 md:rounded-b-3xl">
      <div
        ref={scrollerRef}
        className="flex h-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onScroll={(e) => {
          const el = e.currentTarget;
          setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
        }}
      >
        {photos.map((src, i) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={src + i}
            src={src}
            alt={illustration ? t.stationLook.illustration : format(t.stationLook.photo, { n: i + 1, total: photos.length })}
            className="h-full w-full shrink-0 snap-center object-cover"
            loading={i === 0 ? "eager" : "lazy"}
          />
        ))}
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/35 to-transparent" aria-hidden />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-black/40 to-transparent" aria-hidden />
      {photos.length > 1 && (
        <div className="absolute inset-x-0 bottom-8 flex justify-center gap-1.5" aria-hidden>
          {photos.map((_, i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all ${i === index ? "w-5 bg-white" : "w-1.5 bg-white/60"}`} />
          ))}
        </div>
      )}
      <OpenBadge station={station} className="absolute bottom-8 right-3 shadow" />
    </div>
  );
}

export function StationDetail({ station, distance, onChanged }: Props) {
  const { t } = useI18n();
  const L = t.stationLook;
  const { backend, profile } = useApp();
  const router = useRouter();
  const now = useNow();
  const relativeTime = useRelativeTime();
  const errorMessage = useErrorMessage();
  const hours = useHoursLabel();
  const { position } = usePosition();
  const gallery = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const single = useMemo(() => [station], [station]);

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

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: station.name, text: station.address, url });
      } else {
        await navigator.clipboard.writeText(url);
        setMessage({ ok: true, text: L.linkCopied });
      }
    } catch {
      // Sharing cancelled.
    }
  }

  function showPhoto(i: number) {
    const el = gallery.current;
    if (!el) return;
    el.scrollTo({ left: i * el.clientWidth, behavior: "smooth" });
    el.parentElement?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const battery = station.kind !== "parcel";
  const swap = offersSwap(station.kind);
  const charging = offersCharging(station.kind);
  const slots = availableSlots(station, now);
  const batteries = stockBatteries(station);
  const points = station.chargingPoints ?? [];
  const connected = points.some((p) => p.deviceId !== null);
  const amenities = AMENITIES.filter((a) => station.amenities?.includes(a));
  const photos = station.photos ?? [];
  const evChargers = station.evChargers ?? [];
  // Both reserve buttons leave room for the route as an icon only.
  const twoReserve = battery && !!profile && swap && charging;

  const primary =
    "flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gp-green-dark px-4 py-3.5 text-sm font-semibold text-white shadow-md hover:bg-gp-forest disabled:opacity-40";
  const secondary =
    "flex flex-1 items-center justify-center gap-2 rounded-2xl border-2 border-gp-green-dark bg-gp-surface px-4 py-3 text-sm font-semibold text-gp-green-dark dark:border-gp-green dark:text-gp-green";

  const iconSecondary =
    "flex w-14 shrink-0 items-center justify-center rounded-2xl border-2 border-gp-green-dark bg-gp-surface text-gp-green-dark dark:border-gp-green dark:text-gp-green";

  const stockCard = (Icon: typeof BoltIcon, label: string, value: string, ok: boolean) => (
    <div className="flex flex-col items-center gap-1 rounded-2xl border border-gp-border bg-gp-surface p-3 text-center shadow-sm dark:border-white/10">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gp-green/15 text-gp-green-dark dark:text-gp-green">
        <Icon size={22} />
      </span>
      <span className="text-sm font-semibold">{label}</span>
      <span className={`text-sm font-semibold ${ok ? "text-gp-green-dark dark:text-gp-green" : "text-gp-closed"}`}>{value}</span>
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

  return (
    <div>
      <div className="relative">
        <PhotoGallery station={station} scrollerRef={gallery} />
        <div className="absolute inset-x-3 top-3 flex items-center gap-2">
          <button type="button" onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))} className={overlayButton} aria-label={t.ui.back}>
            <BackIcon size={22} />
          </button>
          <span className="flex-1" />
          <FavoriteButton stationId={station.id} className="bg-white/90 shadow-md backdrop-blur hover:bg-white" />
          <button type="button" onClick={share} className={overlayButton} aria-label={L.share}>
            <ShareIcon size={20} />
          </button>
        </div>
      </div>

      <div className="relative -mt-5 space-y-6 rounded-t-3xl bg-background px-4 pb-6 pt-5 md:mt-0 md:rounded-none">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="font-heading text-2xl font-semibold leading-tight">{station.name}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gp-forest dark:text-zinc-200">
              <span className="flex items-center gap-1">
                <ClockIcon size={15} className="text-gp-muted" />
                {hours(station.openingHours)}
              </span>
              {distance !== null && (
                <span className="flex items-center gap-1 border-l border-gp-border pl-3 dark:border-white/15">
                  <PinIcon size={15} className="text-gp-muted" />
                  {formatDistance(distance)}
                </span>
              )}
              {(station.rating?.count ?? 0) > 0 && (
                <span className="border-l border-gp-border pl-3 dark:border-white/15">
                  <RatingInline station={station} />
                </span>
              )}
            </div>
            <p className="mt-1 text-sm text-gp-muted dark:text-zinc-400">{station.address}</p>
          </div>
          {station.phone ? (
            <a
              href={`tel:${station.phone}`}
              aria-label={t.station.call}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-gp-green-dark text-gp-green-dark dark:border-gp-green dark:text-gp-green"
            >
              <PhoneIcon size={20} />
            </a>
          ) : (
            <a
              href={directionsUrl(station)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t.station.directions}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-gp-green-dark text-gp-green-dark dark:border-gp-green dark:text-gp-green"
            >
              <NavigateIcon size={20} />
            </a>
          )}
        </div>

        <div className="-mt-3 flex flex-wrap items-center gap-1.5 text-xs">
          <RestBadge station={station} />
          <EvBadge station={station} />
          {station.isSolar && <SolarBadge />}
          <span className="rounded-full bg-gp-green/10 px-2.5 py-0.5 font-medium text-gp-green-dark dark:text-gp-green">{t.kinds[station.kind]}</span>
          {station.vehicleTypes.map((v) => (
            <span key={v} className="rounded-full bg-gp-border/60 px-2.5 py-0.5 dark:bg-white/10">
              {t.vehicles[v]}
            </span>
          ))}
        </div>

        {station.isSolar && station.kind !== "parcel" && (
          <p className="-mt-3 flex items-start gap-2 rounded-2xl bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
            <SunIcon size={16} className="mt-0.5 shrink-0" />
            {t.station.solarHint}
          </p>
        )}

        <Section title={L.amenities.title}>
          {amenities.length === 0 ? (
            <p className="text-sm text-gp-muted dark:text-zinc-400">{L.amenities.none}</p>
          ) : (
            <ul className="grid grid-cols-4 gap-y-3 rounded-2xl border border-gp-border bg-gp-surface px-1 py-3 shadow-sm sm:grid-cols-5 dark:border-white/10">
              {amenities.map((a) => {
                const Icon = AMENITY_ICONS[a];
                return (
                  <li key={a} className="flex flex-col items-center gap-1 px-1 text-center">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gp-green/10 text-gp-green-dark dark:text-gp-green">
                      <Icon size={22} />
                    </span>
                    <span className="text-[11px] font-medium leading-tight text-gp-green-dark dark:text-gp-green">{L.amenities[a]}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        {(battery || station.parcelPoint) && (
          <Section title={L.available}>
            <div className="grid grid-cols-2 gap-3">
              {charging && stockCard(BoltIcon, L.charging, format(L.freeOf, { n: slots, total: station.chargingSlots }), slots > 0)}
              {swap && stockCard(BatteryIcon, L.swap, format(L.fullOf, { n: batteries, total: station.batteryCapacity }), availableBatteries(station) > 0)}
              {station.parcelPoint?.counter && stockCard(BoxIcon, t.station.parcelCounter, "✓", true)}
              {(station.parcelPoint?.lockers ?? 0) > 0 &&
                stockCard(BoxIcon, t.station.parcelLockers, format(t.station.lockers, { n: station.parcelPoint!.lockers }), true)}
            </div>

            {swap && (station.batteryTypes ?? []).length > 0 && (
              <div className="rounded-2xl border border-gp-border bg-gp-surface p-3 shadow-sm dark:border-white/10">
                <h3 className="flex items-center gap-2 text-sm font-semibold">
                  <BatteryIcon size={16} /> {t.station.batteryTypes}
                </h3>
                <ul className="mt-1 divide-y divide-gp-border text-sm dark:divide-white/10">
                  {(station.batteryTypes ?? []).map((bt) => (
                    <li key={bt.id} className="flex items-center justify-between gap-3 py-1.5">
                      <span>{batteryTypeLabel(bt)}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          bt.fullBatteries > 0 ? "bg-gp-green/10 text-gp-green-dark" : "bg-zinc-500/10 text-gp-muted"
                        }`}
                      >
                        {format(t.station.typeFull, { n: bt.fullBatteries })}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {points.length > 0 && (
              <div className="rounded-2xl border border-gp-border bg-gp-surface p-3 shadow-sm dark:border-white/10">
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

            {battery && (
              <p className="text-xs text-gp-muted">{format(t.station.updated, { time: relativeTime(station.status.updatedAt, now) })}</p>
            )}
            {station.status.isOpen && !withinOpeningHours(station.openingHours, now) && (
              <p className="text-sm text-red-700 dark:text-red-400">{t.station.outsideHours}</p>
            )}
            {battery && isStale(station, now) && <p className="text-sm text-amber-700 dark:text-amber-400">{t.station.stale}</p>}
          </Section>
        )}

        <Section title={t.station.ev.title}>
          <div className="rounded-2xl border border-gp-border bg-gp-surface p-3 shadow-sm dark:border-white/10">
            <p className="flex items-center gap-2 text-sm">
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                  evChargers.length > 0 ? "bg-gp-info/15 text-gp-info" : "bg-zinc-500/10 text-gp-muted"
                }`}
              >
                <CarIcon size={17} />
              </span>
              {evChargers.length > 0 ? t.station.ev.yes : t.station.ev.no}
            </p>
            {evChargers.length > 0 && (
              <ul className="mt-2 divide-y divide-gp-border text-sm dark:divide-white/10">
                {evChargers.map((c) => (
                  <li key={c.id} className="py-1.5">
                    {format(t.station.ev.charger, {
                      name: c.name,
                      connector: t.backoffice.evChargers.connectors[c.connector],
                      power: c.powerKw,
                    })}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>

        {photos.length > 1 && (
          <Section title={L.morePhotos}>
            <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
              {photos.map((src, i) => (
                <button
                  key={src + i}
                  type="button"
                  onClick={() => showPhoto(i)}
                  aria-label={format(L.photo, { n: i + 1, total: photos.length })}
                  className="h-28 w-44 shrink-0 snap-start overflow-hidden rounded-2xl shadow-sm"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          </Section>
        )}

        <Section title={t.ui.detail.about}>
          <div className="overflow-hidden rounded-2xl border border-gp-border bg-gp-surface shadow-sm dark:border-white/10">
            <div className="h-40">
              <StationMap stations={single} position={position} selectedId={station.id} onSelect={() => {}} />
            </div>
            <ul className="divide-y divide-gp-border px-3 dark:divide-white/10">
              {infoRow(ClockIcon, t.station.openingHours, hours(station.openingHours))}
              {infoRow(PinIcon, t.ui.detail.address, station.address)}
              {infoRow(StoreIcon, t.station.operator, station.operatorName)}
            </ul>
          </div>
        </Section>

        <StationReviews station={station} onChanged={onChanged} />
      </div>

      <div className="sticky bottom-0 z-10 border-t border-gp-border bg-gp-surface/95 px-4 pb-3 pt-3 backdrop-blur dark:border-white/10">
        {message && (
          <p
            role="status"
            className={`mb-2 rounded-xl px-3 py-2 text-sm ${
              message.ok ? "bg-gp-green/15 text-gp-forest dark:text-gp-green" : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
            }`}
          >
            {message.text}
          </p>
        )}
        <div className="flex gap-2">
          {battery && profile && swap && (
            <button type="button" disabled={busy || availableBatteries(station) === 0} onClick={() => reserve("battery")} className={primary}>
              <BatteryIcon size={18} />
              {t.station.reserveBattery}
            </button>
          )}
          {battery && profile && charging && (
            <button type="button" disabled={busy || slots === 0} onClick={() => reserve("slot")} className={primary}>
              <BoltIcon size={18} />
              {t.station.reserveSlot}
            </button>
          )}
          {battery && !profile && (
            <Link href="/login" className={primary}>
              {t.station.loginToReserve}
            </Link>
          )}
          <a
            href={directionsUrl(station)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t.station.directions}
            className={twoReserve ? iconSecondary : secondary}
          >
            <NavigateIcon size={18} />
            {!twoReserve && t.station.directions}
          </a>
        </div>
      </div>
    </div>
  );
}
