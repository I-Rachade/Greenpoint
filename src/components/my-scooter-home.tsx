"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ComponentType } from "react";
import { availableBatteries, DEFAULT_FILTER, isOpenNow, offersSwap, rankStations } from "@shared/availability";
import { formatDistance, scooterMinutes } from "@shared/geo";
import { daysAgo, isLow, kmLeft } from "@shared/scooter-battery";
import { bleReady, readBattery, scanBatteries, stopScan, type FoundBattery } from "@/lib/ble/oves-reader";
import { useLiveQuery, useNow, useRelativeTime } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { isNativeApp } from "@/lib/native";
import { useMyBattery, type MyBatteryReading } from "@/lib/prefs";
import { usePosition } from "@/lib/use-position";
import { useApp } from "./app-provider";
import { BatteryIcon, BellIcon, BoxIcon, ChevronIcon, InfoIcon, NavigateIcon, QrIcon, ScooterIcon, StarIcon, WalletIcon } from "./icons";
import { useI18n } from "./i18n-provider";
import { stationHref } from "./station-card";
import { useToast } from "./ui";

// MapLibre needs the browser (WebGL), so it is never rendered on the server.
const StationMap = dynamic(() => import("./station-map").then((m) => m.StationMap), { ssr: false });

const SCAN_MS = 15_000;

/** The battery drawn as a gauge: green, orange under 25 %, empty outline when unknown. */
function Gauge({ pct }: { pct: number | null }) {
  const fill = pct === null ? 0 : Math.max(6, Math.min(100, pct));
  const tone = pct !== null && isLow(pct) ? "bg-gp-low" : "bg-gp-green";
  return (
    <span aria-hidden className="relative flex h-24 w-14 shrink-0 flex-col justify-end rounded-[14px] border-[3px] border-gp-forest p-1.5 dark:border-zinc-200">
      <span className="absolute -top-2 left-1/2 h-1.5 w-5 -translate-x-1/2 rounded-t-[4px] bg-gp-forest dark:bg-zinc-200" />
      {pct !== null && <span className={`w-full rounded-[8px] ${tone}`} style={{ height: `${fill}%` }} />}
    </span>
  );
}

/**
 * "Lire ma batterie": in the app, finds the Omnivoltaic batteries around (the closest first)
 * and reads the one the rider picks (src/lib/ble/oves-reader.ts). On the web demo it gives a
 * sample reading so the screen can be tried; elsewhere on the web it says to use the app.
 */
function ReadButton({ demo, hasReading, onRead }: { demo: boolean; hasReading: boolean; onRead: (r: MyBatteryReading) => void }) {
  const { t } = useI18n();
  const M = t.myScooter;
  const x = t.bleRead;
  const toast = useToast();
  const [scanning, setScanning] = useState(false);
  const [found, setFound] = useState<Record<string, FoundBattery>>({});
  const [reading, setReading] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const native = isNativeApp();

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (native) stopScan();
    },
    [native],
  );

  async function stop() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    await stopScan();
    setScanning(false);
  }

  async function start() {
    if (!native) {
      // Web demo: a battery at 22 %, 70.4 V, 6.6 Ah left.
      onRead({ socPct: 22, voltageMv: 70_400, remainingMah: 6_600, serial: "B0724525100136", at: new Date().toISOString() });
      return;
    }
    try {
      if (!(await bleReady())) {
        toast(x.off, { tone: "error" });
        return;
      }
      setFound({});
      await scanBatteries((b) => setFound((f) => ({ ...f, [b.id]: b })));
      setScanning(true);
      timer.current = setTimeout(stop, SCAN_MS);
    } catch (e) {
      toast(format(x.failed, { error: e instanceof Error ? e.message : String(e) }), { tone: "error" });
    }
  }

  async function read(b: FoundBattery) {
    await stop();
    setReading(b.id);
    try {
      const r = await readBattery(b.id);
      onRead({ socPct: r.socPct!, voltageMv: r.voltageMv, remainingMah: r.remainingMah, serial: r.serial, at: new Date().toISOString() });
      setFound({});
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast(msg === "no_soc" ? x.noSoc : format(x.failed, { error: msg }), { tone: "error" });
    } finally {
      setReading(null);
    }
  }

  if (!native && !demo) return <p className="mt-3 text-sm text-gp-muted dark:text-zinc-400">{M.appOnly}</p>;
  const list = Object.values(found).sort((a, b) => (b.rssi ?? -999) - (a.rssi ?? -999));
  return (
    <div className="mt-3 space-y-2">
      <button
        type="button"
        onClick={scanning ? stop : start}
        disabled={reading !== null}
        className="inline-flex min-h-11 items-center gap-2 rounded-[14px] border-2 border-gp-green-dark px-4 text-sm font-semibold text-gp-green-dark disabled:opacity-60 dark:border-gp-green dark:text-gp-green"
      >
        <BatteryIcon size={18} />
        {scanning ? x.stop : hasReading ? M.reread : M.read}
      </button>
      {scanning && <p className="text-sm text-gp-muted dark:text-zinc-400">{list.length ? x.pick : `${x.searching} ${x.hint}`}</p>}
      {list.length > 0 && (
        <ul className="divide-y divide-gp-border dark:divide-white/10">
          {list.map((b, i) => (
            <li key={b.id}>
              <button type="button" onClick={() => read(b)} disabled={reading !== null} className="flex min-h-11 w-full items-center gap-3 py-2 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{b.name}</span>
                  {i === 0 && <span className="block text-xs text-gp-muted dark:text-zinc-400">{x.closest}</span>}
                </span>
                <span className="text-sm font-semibold text-gp-green-dark dark:text-gp-green">{reading === b.id ? "…" : x.choose}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function QuickAction({ href, icon: Icon, label, primary }: { href: string; icon: ComponentType<{ size?: number }>; label: string; primary?: boolean }) {
  return (
    <Link
      href={href}
      className={`flex min-h-24 min-w-0 flex-col items-center justify-center gap-2 rounded-[20px] p-2 text-center active:scale-[0.99] ${
        primary ? "bg-gp-forest text-white hover:bg-gp-forest/90" : "border border-gp-border bg-gp-surface hover:border-gp-green dark:border-white/10"
      }`}
    >
      <span
        className={`flex h-11 w-11 items-center justify-center rounded-[14px] ${primary ? "bg-gp-green text-gp-forest" : "bg-gp-green/15 text-gp-green-dark dark:text-gp-green"}`}
      >
        <Icon size={22} />
      </span>
      <span className="w-full break-words text-[13px] font-semibold leading-tight">{label}</span>
    </Link>
  );
}

/**
 * Home of a signed-in rider (mockup A1): their battery, read by Bluetooth, with the kilometres
 * left and a swap advised under 25 %; the last swap; the nearest open swap station with full
 * batteries, a small map and "Go now"; quick actions; greenpoints in the header.
 */
export function MyScooterHome() {
  const { t, locale } = useI18n();
  const M = t.myScooter;
  const { backend, features, profile } = useApp();
  const now = useNow(60_000);
  const relativeTime = useRelativeTime();
  const { position } = usePosition();
  const [battery, setBattery] = useMyBattery();
  const { data: stations } = useLiveQuery(() => backend.listStations());
  const { data: lastSwap } = useLiveQuery(() => backend.myLastSwap().catch(() => null));
  const { data: greenpoint } = useLiveQuery(() => backend.myGreenpoint().catch(() => null));

  const nearest = useMemo(() => {
    const ranked = rankStations(stations ?? [], position, DEFAULT_FILTER).filter(({ station }) => offersSwap(station.kind) && isOpenNow(station));
    return ranked.find(({ station }) => availableBatteries(station) > 0) ?? ranked[0] ?? null;
  }, [stations, position]);
  const single = useMemo(() => (nearest ? [nearest.station] : []), [nearest]);

  const firstName = profile?.fullName?.trim().split(/\s+/)[0] ?? "";
  const evening = now.getHours() >= 17;
  const pct = battery?.socPct ?? null;
  const low = pct !== null && isLow(pct);
  const day = (iso: string) => {
    const n = daysAgo(iso, now);
    return n === 0 ? M.today : n === 1 ? M.yesterday : format(M.daysAgo, { n });
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pb-6">
      <header className="bg-gp-forest px-4 pb-16 pt-4 text-white md:pt-6">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] bg-gp-green font-heading text-lg font-bold text-gp-forest">
            {firstName ? firstName[0].toUpperCase() : "⚡"}
          </span>
          <div className="min-w-0 flex-1">
            {firstName ? (
              <>
                <p className="truncate text-sm text-white/75">{evening ? M.evening : M.morning} 👋</p>
                <p className="truncate font-heading text-xl font-bold">{firstName}</p>
              </>
            ) : (
              <p className="truncate font-heading text-xl font-bold">{evening ? M.evening : M.morning} 👋</p>
            )}
          </div>
          {greenpoint && (
            <Link href="/greenpoint" className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full bg-gp-yellow px-3 font-heading text-sm font-bold text-gp-forest">
              <StarIcon size={16} />
              {format(M.points, { n: new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-GB").format(greenpoint.points) })}
            </Link>
          )}
          {/* On computers the bell is already in the top bar. */}
          <Link href="/notifications" aria-label={t.ui.alerts.title} className="flex h-10 w-10 shrink-0 md:hidden items-center justify-center rounded-full text-white hover:bg-white/10">
            <BellIcon size={22} />
          </Link>
        </div>
      </header>

      {/* Phones: one column. Computers: the scooter beside the nearest station, quick actions below. */}
      <div className="mx-auto -mt-12 max-w-5xl space-y-4 px-4 md:grid md:grid-cols-2 md:items-start md:gap-4 md:space-y-0">
        <section className="rounded-[20px] border border-gp-border bg-gp-surface p-4 shadow-sm dark:border-white/10">
          <div className="flex items-baseline justify-between gap-2">
            <h1 className="font-heading text-lg font-bold">{M.title}</h1>
            {lastSwap?.batteryTypeLabel && <span className="min-w-0 truncate text-sm text-gp-muted dark:text-zinc-400">{lastSwap.batteryTypeLabel}</span>}
          </div>
          <div className="mt-3 flex items-center gap-4">
            <Gauge pct={pct} />
            <div className="min-w-0 flex-1">
              {battery ? (
                <>
                  <p className="flex items-baseline gap-2">
                    <span className="font-heading text-5xl font-bold leading-none tabular-nums">{kmLeft(battery)}</span>
                    <span className="text-base font-semibold">{M.kmLeft}</span>
                  </p>
                  <p className={`mt-2 flex items-start gap-1.5 text-sm font-semibold ${low ? "text-amber-800 dark:text-amber-300" : "text-gp-green-dark dark:text-gp-green"}`}>
                    {low && <InfoIcon size={18} className="mt-px shrink-0" />}
                    {format(low ? M.low : M.battery, { pct: pct ?? 0 })}
                  </p>
                  <p className="mt-1 text-xs text-gp-muted dark:text-zinc-400">{format(M.readAt, { when: relativeTime(battery.at, now) })}</p>
                </>
              ) : (
                <>
                  <p className="font-heading text-xl font-bold">{M.unknown}</p>
                  <p className="mt-1 text-sm text-gp-muted dark:text-zinc-400">{M.readHint}</p>
                </>
              )}
            </div>
          </div>
          <p className="mt-3 text-sm text-gp-muted dark:text-zinc-400">
            {lastSwap
              ? lastSwap.outPct !== null
                ? format(M.lastSwapPct, { when: day(lastSwap.at), station: lastSwap.stationName, pct: lastSwap.outPct })
                : format(M.lastSwap, { when: day(lastSwap.at), station: lastSwap.stationName })
              : M.noSwap}
          </p>
          <ReadButton demo={backend.mode === "demo"} hasReading={!!battery} onRead={setBattery} />
        </section>

        {nearest ? (
          <div className="space-y-4">
            {/* The tint sits on a solid card: on computers this card overlaps the dark header. */}
            <div className="rounded-[20px] bg-gp-surface">
              <section className="flex gap-3 rounded-[20px] border border-gp-green/30 bg-gp-green/10 p-4">
                <Link href={stationHref(nearest.station.id)} className="min-w-0 flex-1">
                  <h2 className="font-heading text-base font-bold">{M.nearest}</h2>
                  <p className="mt-1 text-sm">
                    <span className="font-semibold">{nearest.station.name}</span>
                    {nearest.distance !== null && (
                      <>
                        {" · "}
                        <b>{formatDistance(nearest.distance)}</b> · {format(t.stationLook.summary.minutes, { n: scooterMinutes(nearest.distance) })}
                      </>
                    )}
                  </p>
                  <p className="mt-2 flex flex-wrap gap-2 text-sm font-semibold">
                    <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-gp-surface px-3 text-gp-green-dark dark:text-gp-green">
                      <BatteryIcon size={16} />
                      {availableBatteries(nearest.station) > 0 ? format(M.full, { n: availableBatteries(nearest.station) }) : M.noneFull}
                    </span>
                    <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-gp-surface px-3 text-gp-green-dark dark:text-gp-green">
                      <span aria-hidden className="h-2 w-2 rounded-full bg-gp-green-dark dark:bg-gp-green" />
                      {M.open}
                    </span>
                  </p>
                </Link>
                <Link
                  href="/carte"
                  aria-label={M.seeMap}
                  className="relative h-28 w-28 shrink-0 overflow-hidden rounded-[14px] border-2 border-gp-surface sm:w-40 md:h-36 lg:w-48 [&_*]:pointer-events-none"
                >
                  <StationMap
                    stations={single}
                    position={position}
                    selectedId={nearest.station.id}
                    onSelect={() => undefined}
                    controls={false}
                    route
                    padding={{ top: 24, bottom: 16, left: 16, right: 16 }}
                  />
                </Link>
              </section>
            </div>
            <Link
              href={stationHref(nearest.station.id)}
              className="flex min-h-14 items-center justify-center gap-2 rounded-[14px] bg-gp-green-dark px-5 font-heading text-lg font-bold text-white hover:bg-gp-forest"
            >
              <NavigateIcon size={22} />
              {M.go}
            </Link>
          </div>
        ) : (
          stations && <p className="rounded-[20px] border border-gp-border bg-gp-surface p-4 text-sm text-gp-muted dark:border-white/10">{M.noStation}</p>
        )}

        <section className="md:col-span-2">
          <div className="flex items-baseline justify-between">
            <h2 className="font-heading text-lg font-bold">{M.quick}</h2>
            <Link href="/carte" className="inline-flex items-center gap-0.5 text-sm font-semibold text-gp-green-dark dark:text-gp-green">
              {M.seeMap}
              <ChevronIcon size={16} />
            </Link>
          </div>
          <div className={`mt-2 grid gap-2 ${features.parcels ? "grid-cols-4" : "grid-cols-3"}`}>
            <QuickAction href={nearest ? stationHref(nearest.station.id) : "/stations"} icon={ScooterIcon} label={M.swap} primary />
            <QuickAction href="/scanner" icon={QrIcon} label={M.scan} />
            <QuickAction href="/portefeuille" icon={WalletIcon} label={M.credit} />
            {features.parcels && <QuickAction href="/colis" icon={BoxIcon} label={M.parcels} />}
          </div>
        </section>
      </div>
    </div>
  );
}
