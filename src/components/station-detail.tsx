"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  availableBatteries,
  availableSlots,
  isHolding,
  isOpenNow,
  isStale,
  offersCharging,
  offersSwap,
  stockBatteries,
  withinOpeningHours,
} from "@shared/availability";
import { batteryTypeLabel } from "@shared/battery-types";
import { directionsUrl, formatDistance, scooterMinutes } from "@shared/geo";
import { displayStatus, type ChargingPointDisplay } from "@shared/iot/charging-points";
import { useErrorMessage, useNow, useRelativeTime } from "@/lib/hooks";
import { format, formatXof } from "@/lib/i18n/format";
import { loginHref } from "@/lib/next-path";
import { AMENITIES, isUnattended, stationPhotos } from "@shared/station-extras";
import { useBrandPref } from "@/lib/prefs";
import { freeOfType, reservableEvChargers, reservableOutlets, reservableTypes, type ReservationKind } from "@shared/reservations";
import { RESERVATION_MINUTES, type Reservation, type StationView } from "@shared/types";
import { usePosition } from "@/lib/use-position";
import { useApp } from "./app-provider";
import { ConfirmSheet } from "./confirm-sheet";
import { BackIcon, BatteryIcon, BoltIcon, BoxIcon, CarIcon, ClockIcon, NavigateIcon, PhoneIcon, PinIcon, PlugIcon, ScooterIcon, ShareIcon, StarIcon, StoreIcon, SunIcon } from "./icons";
import { useI18n } from "./i18n-provider";
import { EvBadge, FavoriteButton, RestBadge, stationHref } from "./station-card";
import { AMENITY_ICONS, OpenBadge, useHoursLabel, useTodayHoursLabel } from "./station-look";
import { SolarBadge } from "./solar-badge";
import { StationReviews } from "./station-reviews";
import { Countdown, SuccessCheck } from "./ui";
import { enRouteHref } from "./en-route-link";
import { useActiveReservation } from "./use-alerts";

const StationMap = dynamic(() => import("./station-map").then((m) => m.StationMap), { ssr: false });

const OUTLET_COLORS: Record<ChargingPointDisplay, string> = {
  free: "bg-green-600",
  reserved: "bg-amber-500",
  charging: "bg-sky-600",
  done: "bg-sky-600",
  fault: "bg-red-600",
  offline: "bg-zinc-400",
};

/** Stock of one battery type as the customer reads it: none left, a few (as stationAvailability), or enough. */
type TypeLevel = "out" | "low" | "ok";
function typeLevel(full: number): TypeLevel {
  return full <= 0 ? "out" : full <= 2 ? "low" : "ok";
}
const TYPE_CHIP: Record<TypeLevel, string> = {
  ok: "bg-gp-green/15 text-gp-green-dark dark:text-gp-green",
  low: "bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300",
  out: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
};
const TYPE_BAR: Record<TypeLevel, string> = { ok: "bg-gp-green", low: "bg-gp-low", out: "bg-gp-closed" };

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
        <div className="absolute inset-x-0 bottom-24 flex justify-center gap-1.5" aria-hidden>
          {photos.map((_, i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all ${i === index ? "w-5 bg-white" : "w-1.5 bg-white/60"}`} />
          ))}
        </div>
      )}
    </div>
  );
}

export function StationDetail({ station, distance, onChanged }: Props) {
  const { t, locale } = useI18n();
  const L = t.stationLook;
  const S = L.summary;
  const { backend, profile, features } = useApp();
  const router = useRouter();
  const now = useNow();
  const relativeTime = useRelativeTime();
  const errorMessage = useErrorMessage();
  const hours = useHoursLabel();
  const todayLabel = useTodayHoursLabel();
  const { position } = usePosition();
  const gallery = useRef<HTMLDivElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);
  /** The dark summary has scrolled away: a slim bar with the name stays at the top. */
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = summaryRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setCompact(!entry.isIntersecting), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  /** The reservation just made here; its code is shown in a sheet until closed. */
  const [reserved, setReserved] = useState<Reservation | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const single = useMemo(() => [station], [station]);
  // Once something is reserved here, the bar shows it instead of the reserve buttons,
  // so a second tap cannot replace the code with an error.
  const shared = useActiveReservation(station.id)?.reservation ?? null;
  const activeHere = reserved && isHolding(reserved, now) ? reserved : shared;

  /** The type or outlet picker (shared/reservations.ts): only what is free now is offered. */
  const [picker, setPicker] = useState<"swap" | "outlet" | null>(null);
  const [choice, setChoice] = useState<string | null>(null);
  const [allTypes, setAllTypes] = useState(false);
  const [brand] = useBrandPref();

  async function reserve(kind: ReservationKind, target: string | null) {
    if (busy || activeHere) return;
    setBusy(true);
    setMessage(null);
    try {
      const reservation = await backend.reserve(station.id, kind, target);
      setReserved(reservation);
      setPicker(null);
      setSheetOpen(true);
      onChanged();
    } catch (err) {
      setPicker(null);
      setMessage({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  /** Battery: pick the type where the station swaps several (or one, so the customer sees what is held). */
  function reserveBattery() {
    if (!(station.batteryTypes ?? []).length) return void reserve("swap", null);
    setAllTypes(false);
    setChoice(reservableTypes(station, brand)[0]?.id ?? null);
    setPicker("swap");
  }

  function reserveOutlet() {
    setChoice(reservableOutlets(station, now)[0]?.id ?? null);
    setPicker("outlet");
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

  // No phone and no staff: nobody would hold the reservation, so none is offered (worker refuses too).
  const unattended = isUnattended(station);
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
  const typeChoices = reservableTypes(station, allTypes ? null : brand);
  const brandNarrowed = !allTypes && typeChoices.length < reservableTypes(station).length;
  const outletChoices = reservableOutlets(station, now);
  const noFreeType = (station.batteryTypes ?? []).length > 0 && reservableTypes(station).length === 0;
  const evFree = reservableEvChargers(station).length > 0;
  // Both reserve buttons leave room for the route as an icon only.
  const twoReserve = battery && !unattended && !!profile && swap && charging && !connected;

  const primary =
    "flex flex-1 items-center justify-center gap-2 rounded-2xl bg-gp-green-dark px-4 py-3.5 text-sm font-semibold text-white shadow-md hover:bg-gp-forest disabled:opacity-40";
  const secondary =
    "flex flex-1 items-center justify-center gap-2 rounded-2xl border-2 border-gp-green-dark bg-gp-surface px-4 py-3 text-sm font-semibold text-gp-green-dark dark:border-gp-green dark:text-gp-green";

  const types = swap ? (station.batteryTypes ?? []) : [];
  // The station's one swap price; a type priced by the energy added has none, so no price is shown then.
  const swapPrice = swap && station.swapPriceXof && !types.some((bt) => bt.pricing === "energy") ? station.swapPriceXof : null;
  // With the price on the left, the route is an icon and the reserve button says just "Reserve".
  // Not with two reserve buttons: "Reserve" alone would not say which.
  const compactBar = swapPrice !== null && !activeHere && !twoReserve;

  const iconSecondary =
    "flex h-12 w-14 shrink-0 items-center justify-center rounded-2xl border-2 border-gp-green-dark bg-gp-surface text-gp-green-dark dark:border-gp-green dark:text-gp-green";

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

  const open = isOpenNow(station, now);

  /** One tile of "At a glance": icon, big figure, label. */
  type Tile = { key: string; Icon: typeof BoltIcon; value: string; label: string; warn?: boolean };
  const tiles: Tile[] = [];
  if (swap)
    tiles.push({
      key: "swap",
      Icon: BatteryIcon,
      value: station.batteryCapacity > 0 ? `${batteries}/${station.batteryCapacity}` : String(batteries),
      label: S.fullBatteries,
      warn: availableBatteries(station) === 0,
    });
  if (charging) {
    const total = connected ? points.filter((p) => p.deviceId !== null).length : station.chargingSlots;
    tiles.push({ key: "charging", Icon: PlugIcon, value: total > 0 ? `${slots}/${total}` : String(slots), label: S.freeOutlets, warn: slots === 0 });
  }
  tiles.push({ key: "hours", Icon: ClockIcon, value: todayLabel(station.openingHours, now), label: open ? S.openNow : S.closedNow, warn: !open });
  if (station.parcelPoint?.counter) tiles.push({ key: "counter", Icon: BoxIcon, value: "✓", label: t.station.parcelCounter });
  if ((station.parcelPoint?.lockers ?? 0) > 0)
    tiles.push({ key: "lockers", Icon: BoxIcon, value: String(station.parcelPoint!.lockers), label: t.station.parcelLockers });

  return (
    <div>
      {/* Slim bar once the summary is scrolled away (mockup A4). */}
      <div className="sticky top-0 z-20 h-0">
        <div
          aria-hidden={!compact}
          className={`flex items-center gap-3 border-b border-gp-border bg-gp-surface/95 px-3 py-2 backdrop-blur transition-opacity duration-200 dark:border-white/10 ${
            compact ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <button
            type="button"
            tabIndex={compact ? 0 : -1}
            onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-gp-border dark:border-white/15"
            aria-label={t.ui.back}
          >
            <BackIcon size={20} />
          </button>
          <span className="min-w-0 flex-1 truncate font-heading text-base font-semibold">{station.name}</span>
          <OpenBadge station={station} className="shrink-0" />
        </div>
      </div>

      <div className="relative">
        <PhotoGallery station={station} scrollerRef={gallery} />
        <div className="absolute inset-x-3 top-3 flex items-center gap-2">
          <button type="button" onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))} className={overlayButton} aria-label={t.ui.back}>
            <BackIcon size={22} />
          </button>
          <span className="flex-1" />
          {station.phone && (
            <a href={`tel:${station.phone}`} aria-label={t.station.call} className={overlayButton}>
              <PhoneIcon size={19} />
            </a>
          )}
          <FavoriteButton stationId={station.id} className="bg-white/90 shadow-md backdrop-blur hover:bg-white" />
          <button type="button" onClick={share} className={overlayButton} aria-label={L.share}>
            <ShareIcon size={20} />
          </button>
        </div>
      </div>

      {/* Dark summary laid over the bottom of the photo: name, open, distance, time by scooter, rating. */}
      <div ref={summaryRef} className="relative z-[1] mx-4 -mt-20 rounded-[20px] bg-gp-forest p-4 text-white shadow-xl shadow-gp-forest/30 dark:ring-1 dark:ring-white/10">
        <div className="flex items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gp-green text-gp-forest" aria-hidden>
            {station.kind === "parcel" ? <BoxIcon size={20} /> : <BoltIcon size={20} />}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="font-heading text-lg font-semibold leading-snug">{station.name}</h1>
            <p className="mt-0.5 text-sm text-white/75">{station.address}</p>
          </div>
          <OpenBadge station={station} className="mt-1 shrink-0" />
        </div>
        <dl className="mt-4 flex flex-wrap gap-x-7 gap-y-2">
          {distance !== null && (
            <>
              <div>
                <dd className="font-heading text-2xl font-bold leading-tight">{formatDistance(distance)}</dd>
                <dt className="text-xs text-white/70">{S.distance}</dt>
              </div>
              <div>
                <dd className="font-heading text-2xl font-bold leading-tight">{format(S.minutes, { n: scooterMinutes(distance) })}</dd>
                <dt className="text-xs text-white/70">{S.byScooter}</dt>
              </div>
            </>
          )}
          <div>
            {(station.rating?.count ?? 0) > 0 ? (
              <>
                <dd className="flex items-center gap-1 font-heading text-2xl font-bold leading-tight text-gp-yellow">
                  {station.rating!.average.toFixed(1)}
                  <StarIcon size={20} filled />
                </dd>
                <dt className="text-xs text-white/70">{format(L.reviews.count, { n: station.rating!.count })}</dt>
              </>
            ) : (
              <>
                <dd className="flex h-8 items-center text-gp-yellow">
                  <StarIcon size={20} />
                </dd>
                <dt className="text-xs text-white/70">{S.noReview}</dt>
              </>
            )}
          </div>
        </dl>
      </div>

      <div className="space-y-6 px-4 pb-6 pt-4">
        <Section title={S.glance}>
          <ul className="grid gap-2" style={{ gridTemplateColumns: `repeat(${tiles.length === 4 ? 2 : Math.min(tiles.length, 3)}, minmax(0, 1fr))` }}>
            {tiles.map(({ key, Icon, value, label, warn }) => (
              <li key={key} className="rounded-[14px] bg-gp-border/40 p-3 dark:bg-white/5">
                <Icon size={18} className="text-gp-green-dark dark:text-gp-green" />
                <div className={`mt-1.5 truncate font-heading text-lg font-bold leading-tight ${warn ? "text-gp-closed" : ""}`}>{value}</div>
                <div className="text-xs text-gp-muted dark:text-zinc-400">{label}</div>
              </li>
            ))}
          </ul>
          {battery && types.length === 0 && (
            <p className="text-xs text-gp-muted">{format(t.station.updated, { time: relativeTime(station.status.updatedAt, now) })}</p>
          )}
          {station.status.isOpen && !withinOpeningHours(station.openingHours, now) && (
            <p className="text-sm text-red-700 dark:text-red-400">{t.station.outsideHours}</p>
          )}
          {battery && isStale(station, now) && <p className="text-sm text-amber-700 dark:text-amber-400">{t.station.stale}</p>}
        </Section>

        {types.length > 0 && (
          <Section
            title={S.byType}
            action={<span className="text-xs text-gp-muted dark:text-zinc-400">{format(t.station.updated, { time: relativeTime(station.status.updatedAt, now) })}</span>}
          >
            <ul className="divide-y divide-gp-border dark:divide-white/10">
              {types.map((bt) => {
                const n = freeOfType(bt);
                const level = typeLevel(n);
                const total = bt.capacity ?? 0;
                return (
                  <li key={bt.id} className="flex items-center gap-3 py-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gp-border/40 dark:bg-white/5" aria-hidden>
                      <BatteryIcon size={20} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <b className="truncate text-sm font-semibold">{batteryTypeLabel(bt)}</b>
                        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${TYPE_CHIP[level]}`}>
                          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />
                          {level === "out" ? S.typeOut : level === "low" ? S.typeLow : S.typeAvailable}
                        </span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        {total > 0 && (
                          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-gp-border dark:bg-white/10" aria-hidden>
                            <span className={`block h-full rounded-full ${TYPE_BAR[level]}`} style={{ width: `${Math.min(100, (n / total) * 100)}%` }} />
                          </span>
                        )}
                        <span className={`text-xs font-semibold ${total > 0 ? "" : "flex-1 text-right"}`}>
                          {total > 0 ? format(L.fullOf, { n, total }) : format(t.station.typeFull, { n })}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Section>
        )}

        <div className="flex flex-wrap items-center gap-1.5 text-xs">
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

        <div className="space-y-2 empty:hidden">
          {connected && (
            <div className="flex items-center gap-3 rounded-2xl border border-gp-border bg-gp-surface p-3 shadow-sm dark:border-white/10">
              <span className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gp-green/15 text-gp-green-dark dark:text-gp-green">
                <ScooterIcon size={26} />
                <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-gp-green-dark text-white">
                  <BoltIcon size={12} />
                </span>
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold">{t.station.moto.title}</h3>
                <p className={`text-sm font-semibold ${slots > 0 ? "text-gp-green-dark dark:text-gp-green" : "text-gp-closed"}`}>
                  {slots === 0 ? t.station.moto.none : format(slots === 1 ? t.station.moto.one : t.station.moto.many, { n: slots })}
                  <span className="font-normal text-gp-muted dark:text-zinc-400"> {format(t.station.moto.of, { total: points.length })}</span>
                </p>
              </div>
              {unattended ? null : profile ? (
                <button
                  type="button"
                  disabled={busy || slots === 0 || outletChoices.length === 0 || !!activeHere}
                  onClick={reserveOutlet}
                  className="shrink-0 rounded-xl bg-gp-green-dark px-3 py-2 text-xs font-semibold text-white hover:bg-gp-forest disabled:opacity-40"
                >
                  {t.station.moto.reserve}
                </button>
              ) : (
                <Link href={loginHref(stationHref(station.id))} className="shrink-0 rounded-xl border-2 border-gp-green-dark px-3 py-1.5 text-xs font-semibold text-gp-green-dark dark:border-gp-green dark:text-gp-green">
                  {t.station.moto.reserve}
                </Link>
              )}
            </div>
          )}

          {points.some((p) => p.qrStart) && (
            <Link href="/recharge" className={`${secondary} flex-none`}>
              <BoltIcon size={16} />
              {t.charging.qr.scan}
            </Link>
          )}

          {points.length > 0 && !connected && (
            <div className="rounded-2xl border border-gp-border bg-gp-surface p-3 shadow-sm dark:border-white/10">
              <h3 className="text-sm font-semibold">{t.station.outlets}</h3>
              <ul className="mt-1 divide-y divide-gp-border text-sm dark:divide-white/10">
                {points.map((p) => {
                  const shown = displayStatus(p, now);
                  return (
                    <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                      <span className="flex items-center gap-2">
                        <span className={`h-2.5 w-2.5 rounded-full ${OUTLET_COLORS[shown]}`} aria-hidden />
                        {p.label}
                      </span>
                      <span className="text-gp-muted dark:text-zinc-400">{t.station.outletStatus[shown]}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>

        {features.evChargers && (
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
                  {evChargers.map((c) => {
                    // A charger linked to a connected outlet (0048): its live state, and it is paid in the app.
                    const shown = c.point ? displayStatus({ ...c.point, stationId: station.id, label: c.name, powerWatts: 0 }, now) : null;
                    return (
                    <li key={c.id} className="flex items-center justify-between gap-3 py-1.5">
                      <span className="min-w-0">
                        {format(t.station.ev.charger, {
                          name: c.name,
                          connector: t.backoffice.evChargers.connectors[c.connector],
                          power: c.powerKw,
                        })}
                        {shown && (
                          <span className="block text-xs text-gp-muted">
                            {t.station.outletStatus[shown]}
                            {c.point?.qrStart ? ` · ${t.station.ev.payInApp}` : ""}
                          </span>
                        )}
                      </span>
                      {c.reserved ? (
                        <span className="shrink-0 rounded-full bg-amber-500/15 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:text-amber-300">{t.reserveFlow.reserved}</span>
                      ) : profile && !unattended ? (
                        <button
                          type="button"
                          disabled={busy || !!activeHere || !evFree || !station.status.isOpen || (shown !== null && shown !== "free")}
                          onClick={() => void reserve("charging_point", c.id)}
                          className="min-h-11 shrink-0 rounded-xl bg-gp-green-dark px-3 text-xs font-semibold text-white hover:bg-gp-forest disabled:opacity-40"
                        >
                          {t.reserveFlow.reserve}
                        </button>
                      ) : null}
                    </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </Section>
        )}

        <Section title={S.services}>
          {amenities.length === 0 ? (
            <p className="text-sm text-gp-muted dark:text-zinc-400">{L.amenities.none}</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {amenities.map((a) => {
                const Icon = AMENITY_ICONS[a];
                return (
                  <li
                    key={a}
                    className="inline-flex items-center gap-1.5 rounded-full border border-gp-border bg-gp-surface px-3 py-1.5 text-sm font-medium dark:border-white/10"
                  >
                    <Icon size={16} className="text-gp-green-dark dark:text-gp-green" />
                    {L.amenities[a]}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <StationReviews station={station} onChanged={onChanged} />

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
        <div className="flex items-center gap-2">
          {compactBar && (
            <div className="-order-1 mr-1 shrink-0">
              <div className="text-[11px] text-gp-muted dark:text-zinc-400">{S.swapPrice}</div>
              <div className="whitespace-nowrap font-heading text-lg font-bold leading-tight">{formatXof(swapPrice, locale)}</div>
            </div>
          )}
          {battery && profile && activeHere && (
            <Link
              href={enRouteHref(activeHere.id)}
              className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl bg-gp-green/15 px-4 py-3 text-sm text-gp-forest dark:text-zinc-100"
            >
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-gp-green-dark dark:bg-gp-green" />
              <span className="min-w-0 flex-1 truncate">
                <b className="font-semibold">{t.phase1a.activeReservation}</b>
                {activeHere.pickupCode && (
                  <>
                    {" · "}
                    <span className="font-mono font-semibold tracking-wider">{format(t.phase1a.code, { code: activeHere.pickupCode })}</span>
                  </>
                )}
                {" · "}
                <Countdown expiresAt={activeHere.expiresAt} />
              </span>
              <span className="shrink-0 font-semibold text-gp-green-dark dark:text-gp-green">{t.phase1a.view}</span>
            </Link>
          )}
          {battery && unattended && !activeHere && (
            <p className="flex flex-1 items-center rounded-2xl bg-zinc-500/10 px-4 py-3 text-sm text-gp-muted dark:text-zinc-400">{L.unattendedHint}</p>
          )}
          {battery && !unattended && profile && swap && !activeHere && (
            <button
              type="button"
              disabled={busy || availableBatteries(station) === 0 || noFreeType}
              onClick={reserveBattery}
              className={primary}
            >
              <BatteryIcon size={18} />
              {compactBar ? S.reserve : t.station.reserveBattery}
            </button>
          )}
          {battery && !unattended && profile && charging && !connected && !activeHere && (
            <button type="button" disabled={busy || slots === 0} onClick={() => void reserve("charging_point", null)} className={primary}>
              <BoltIcon size={18} />
              {t.station.reserveSlot}
            </button>
          )}
          {battery && !unattended && !profile && (
            <Link href={loginHref(stationHref(station.id))} className={primary}>
              {compactBar ? S.reserve : t.station.loginToReserve}
            </Link>
          )}
          <a
            href={directionsUrl(station)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t.station.directions}
            className={`${twoReserve || activeHere || compactBar ? iconSecondary : secondary} ${compactBar ? "-order-1" : ""}`}
          >
            <NavigateIcon size={18} />
            {!twoReserve && !activeHere && !compactBar && t.station.directions}
          </a>
        </div>
      </div>

      <ConfirmSheet
        open={picker !== null}
        title={picker === "swap" ? t.reserveFlow.chooseType : t.reserveFlow.chooseOutlet}
        confirmLabel={t.reserveFlow.reserve}
        busy={busy}
        onConfirm={() => {
          if (choice && picker) void reserve(picker === "swap" ? "swap" : "charging_point", choice);
        }}
        onCancel={() => setPicker(null)}
      >
        <div className="space-y-3">
          <p className="text-sm text-gp-muted">{picker === "swap" ? t.reserveFlow.chooseTypeHint : t.reserveFlow.chooseOutletHint}</p>
          {picker === "swap" && brandNarrowed && brand && <p className="text-sm">{format(t.reserveFlow.brandOnly, { brand })}</p>}
          <div role="radiogroup" aria-label={picker === "swap" ? t.reserveFlow.chooseType : t.reserveFlow.chooseOutlet} className="grid gap-2">
            {(picker === "swap"
              ? typeChoices.map((bt) => ({ id: bt.id, label: batteryTypeLabel(bt), note: format(t.reserveFlow.free, { n: freeOfType(bt) }) }))
              : outletChoices.map((p) => ({ id: p.id, label: p.label, note: t.station.outletStatus.free }))
            ).map((o) => (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={choice === o.id}
                onClick={() => setChoice(o.id)}
                className={`flex min-h-12 items-center justify-between gap-3 rounded-2xl border-2 px-4 text-left text-sm font-semibold ${
                  choice === o.id ? "border-gp-green-dark bg-gp-green/10 text-gp-green-dark dark:border-gp-green dark:text-gp-green" : "border-gp-border bg-gp-surface dark:border-white/10"
                }`}
              >
                <span>{o.label}</span>
                <span className="text-xs font-medium text-gp-muted">{o.note}</span>
              </button>
            ))}
          </div>
          {picker === "swap" && typeChoices.length === 0 && <p className="text-sm text-gp-closed">{t.reserveFlow.noType}</p>}
          {picker === "outlet" && outletChoices.length === 0 && <p className="text-sm text-gp-closed">{t.reserveFlow.noOutlet}</p>}
          {picker === "swap" && brandNarrowed && (
            <button type="button" onClick={() => setAllTypes(true)} className="min-h-11 text-sm font-semibold text-gp-green-dark underline dark:text-gp-green">
              {t.reserveFlow.allTypes}
            </button>
          )}
        </div>
      </ConfirmSheet>

      <ConfirmSheet
        open={sheetOpen && !!reserved}
        title={t.phase1a.reservedTitle}
        confirmLabel={t.enRoute.go}
        cancelLabel={t.station.close}
        onConfirm={() => reserved && router.push(enRouteHref(reserved.id))}
        onCancel={() => setSheetOpen(false)}
      >
        <div className="flex flex-col items-center gap-2 py-2 text-center">
          <SuccessCheck size={64} />
          {reserved?.pickupCode && (
            <>
              <span className="text-xs text-gp-muted">{t.reservations.pickupCode}</span>
              <span className="font-mono text-5xl font-bold tracking-[0.3em] text-gp-green-dark dark:text-gp-green">{reserved.pickupCode}</span>
            </>
          )}
          {reserved?.targetLabel && <p className="font-semibold">{reserved.targetLabel}</p>}
          <p className="text-sm">{format(t.phase1a.reservedBody, { minutes: RESERVATION_MINUTES })}</p>
        </div>
      </ConfirmSheet>
    </div>
  );
}
