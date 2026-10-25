"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { BackendError } from "@/lib/backend";
import { distanceMeters, formatDistance, type LatLng } from "@/lib/geo";
import { useErrorMessage, useLiveQuery, useNow } from "@/lib/hooks";
import { format, formatXof } from "@/lib/i18n/format";
import {
  documentsFor,
  rideCost,
  rideTimes,
  SHARE_RESERVE_MINUTES,
  type ShareDocument,
  type ShareMe,
  type ShareRide,
  type ShareStation,
  type ShareTariff,
  type ShareVehicle,
} from "@/lib/share";
import { usePosition } from "@/lib/use-position";
import { useApp } from "../app-provider";
import { ConfirmSheet } from "../confirm-sheet";
import { useI18n } from "../i18n-provider";
import { LoadFailed, OfflineNotice } from "../load-state";

// The Share tab (src/lib/share.ts, worker/share.ts): Share stations with their vehicles, the
// customer's check, the open ride and the rides still to pay. Share stations also show on the map.

const input = "w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-base dark:border-white/20 dark:bg-zinc-900";
const button = "rounded-full bg-gp-green-dark px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";
const ghost = "rounded-full border border-black/15 px-4 py-2 text-sm dark:border-white/20 disabled:opacity-50";
const card = "rounded-xl border border-black/10 p-4 dark:border-white/10";

/** While trackers are simulated the app sends the phone's position this often during a ride. */
const POSITION_EVERY_MS = 20_000;
/** The open ride is reloaded this often, so a change in the backoffice shows. */
const RIDE_POLL_MS = 15_000;

function useAction() {
  const errorMessage = useErrorMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run, setError };
}

export function ShareHome() {
  const { t } = useI18n();
  const { backend, profile } = useApp();
  const overview = useLiveQuery(() => backend.shareOverview());
  const me = useLiveQuery(() => (profile ? backend.shareMe() : Promise.resolve(null)), profile?.id ?? "");
  const { position } = usePosition();
  const s = t.share;
  const loaded = !!overview.data;

  // From the map: the station's card, once the list is there.
  useEffect(() => {
    if (!loaded || !window.location.hash.startsWith("#share-")) return;
    document.getElementById(decodeURIComponent(window.location.hash.slice(1)))?.scrollIntoView({ block: "center" });
  }, [loaded]);

  if (!overview.data) return overview.error ? <LoadFailed error={overview.error} onRetry={overview.reload} /> : <p className="p-6 text-sm text-gp-muted">{t.loading}</p>;
  const mine = me.data;

  return (
    <div className="mx-auto w-full max-w-md space-y-4 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">{s.title}</h1>
        <p className="text-sm text-gp-muted">{s.intro}</p>
      </header>
      {(!!overview.error || !!me.error) && <OfflineNotice />}
      {!profile && (
        <p className={`${card} text-sm`}>
          {s.signInFirst}{" "}
          <Link href="/login" className="font-medium text-gp-green-dark underline dark:text-gp-green">
            {t.ui.tabs.account}
          </Link>
        </p>
      )}
      {mine?.ride && <OpenRide ride={mine.ride} me={mine} stations={overview.data.stations} onChange={me.reload} />}
      {mine && mine.unpaid.map((r) => <PayRide key={r.id} ride={r} me={mine} onDone={me.reload} />)}
      {mine && mine.verification !== "approved" && <Verification me={mine} onChange={me.reload} />}
      <Prices tariffs={overview.data.tariffs} />
      <Stations stations={overview.data.stations} tariffs={overview.data.tariffs} position={position} me={mine} onReserved={me.reload} />
      {mine && <History />}
    </div>
  );
}

// Check ---------------------------------------------------------------------------------------

/** The ID photo and a selfie (the licence too, for cars), once; an admin approves them. */
function Verification({ me, onChange }: { me: ShareMe; onChange: () => void }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const s = t.share;
  const { busy, error, run } = useAction();
  const needed = documentsFor("emoto");

  async function upload(kind: ShareDocument, file: File | undefined) {
    if (!file) return;
    if (await run(() => backend.uploadShareDocument(kind, file))) onChange();
  }

  return (
    <section className={`${card} space-y-3`}>
      <h2 className="font-semibold">{s.check.title}</h2>
      <p className="text-sm text-gp-muted">
        {me.verification === "pending" && needed.every((d) => me.documents.includes(d)) ? s.check.pending : s.check.intro}
      </p>
      {me.verification === "rejected" && <p className="text-sm text-red-600">{format(s.check.rejected, { reason: me.rejectReason ?? "" })}</p>}
      <ul className="space-y-2">
        {needed.map((kind) => (
          <li key={kind} className="flex items-center justify-between gap-2">
            <span className="text-sm">
              {me.documents.includes(kind) ? "✓ " : ""}
              {s.documents[kind]}
            </span>
            <label className={`${ghost} cursor-pointer`}>
              {me.documents.includes(kind) ? s.check.replace : s.check.add}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture={kind === "selfie" ? "user" : "environment"}
                className="sr-only"
                disabled={busy}
                onChange={(e) => void upload(kind, e.target.files?.[0])}
              />
            </label>
          </li>
        ))}
      </ul>
      <p className="text-xs text-gp-muted">{s.check.carsNeedLicence}</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}

// Prices and stations --------------------------------------------------------------------------

function Prices({ tariffs }: { tariffs: ShareTariff[] }) {
  const { t, locale } = useI18n();
  const s = t.share;
  const active = tariffs.filter((x) => x.isActive);
  if (!active.length) return <p className={`${card} text-sm text-gp-muted`}>{s.noPrices}</p>;
  const xof = (n: number) => formatXof(n, locale);
  return (
    <section className={`${card} space-y-2`}>
      <h2 className="font-semibold">{s.prices}</h2>
      {active.map((x) => (
        <div key={x.kind} className="text-sm">
          <div className="font-medium">{s.kinds[x.kind]}</div>
          <div className="text-gp-muted">
            {format(s.priceLine, { unlock: xof(x.unlockXof), minute: xof(x.minuteXof), pause: xof(x.pauseMinuteXof) })}
            {x.depositXof > 0 && ` · ${format(s.deposit, { amount: xof(x.depositXof) })}`}
          </div>
        </div>
      ))}
      <p className="text-xs text-gp-muted">{s.returnRule}</p>
    </section>
  );
}

function Stations({
  stations,
  tariffs,
  position,
  me,
  onReserved,
}: {
  stations: ShareStation[];
  tariffs: ShareTariff[];
  position: LatLng | null;
  me: ShareMe | null;
  onReserved: () => void;
}) {
  const { t } = useI18n();
  const s = t.share;
  const [pick, setPick] = useState<{ station: ShareStation; vehicle: ShareVehicle } | null>(null);
  const sorted = useMemo(
    () =>
      stations
        .map((st) => ({ st, d: position ? distanceMeters(position, st) : null }))
        .sort((a, b) => (a.d ?? 0) - (b.d ?? 0) || a.st.name.localeCompare(b.st.name)),
    [stations, position],
  );
  const canRent = !!me && me.verification === "approved" && !me.ride && me.unpaid.length === 0;
  const priced = new Set(tariffs.filter((x) => x.isActive).map((x) => x.kind));

  if (!stations.length) return <p className={`${card} text-sm text-gp-muted`}>{s.noStations}</p>;
  return (
    <section className="space-y-2">
      <h2 className="font-semibold">{s.stations}</h2>
      {sorted.map(({ st, d }) => (
        <div key={st.stationId} id={`share-${st.stationId}`} className={`${card} space-y-2`}>
          <div className="flex items-baseline justify-between gap-2">
            <Link href={`/station?id=${encodeURIComponent(st.stationId)}`} className="font-medium hover:underline">
              {st.name}
            </Link>
            {d !== null && <span className="text-xs text-gp-muted">{formatDistance(d)}</span>}
          </div>
          <div className="text-xs text-gp-muted">
            {format(s.stationLine, { n: st.vehicles.length, radius: st.radiusM })}
            {st.helmets > 0 && ` · ${format(s.helmets, { n: st.helmets })}`}
          </div>
          {st.vehicles.map((v) => (
            <div key={v.id} className="flex items-center justify-between gap-2 rounded-lg bg-black/[0.03] px-3 py-2 dark:bg-white/5">
              <div className="text-sm">
                <div className="font-medium">{v.name}</div>
                <div className="text-xs text-gp-muted">
                  {s.kinds[v.kind]}
                  {v.plate && ` · ${v.plate}`}
                  {v.batteryPercent !== null && ` · ${format(s.battery, { n: v.batteryPercent })}`}
                </div>
              </div>
              <button type="button" className={button} disabled={!canRent || !priced.has(v.kind)} onClick={() => setPick({ station: st, vehicle: v })}>
                {s.reserve}
              </button>
            </div>
          ))}
        </div>
      ))}
      {pick && <ReserveSheet {...pick} stations={stations} onClose={() => setPick(null)} onDone={onReserved} />}
    </section>
  );
}

/** Destination (only for planning), helmet, then reserve or start right away. */
function ReserveSheet({
  station,
  vehicle,
  stations,
  onClose,
  onDone,
}: {
  station: ShareStation;
  vehicle: ShareVehicle;
  stations: ShareStation[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const { backend } = useApp();
  const s = t.share;
  const [to, setTo] = useState("");
  const [helmet, setHelmet] = useState(false);
  const { busy, error, run } = useAction();

  async function reserve(start: boolean) {
    if (await run(() => backend.reserveShare({ vehicleId: vehicle.id, toStationId: to || null, helmet, start }))) {
      onDone();
      onClose();
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 sm:items-center" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="w-full max-w-md space-y-3 rounded-t-2xl bg-gp-surface p-5 sm:rounded-2xl dark:bg-zinc-900" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold">{vehicle.name}</h2>
        <p className="text-sm text-gp-muted">{format(s.reserveAt, { station: station.name, minutes: SHARE_RESERVE_MINUTES })}</p>
        <label className="block space-y-1">
          <span className="text-sm font-medium">{s.destination}</span>
          <select className={input} value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">{s.destinationNone}</option>
            {stations
              .filter((x) => x.stationId !== station.stationId)
              .map((x) => (
                <option key={x.stationId} value={x.stationId}>
                  {x.name}
                </option>
              ))}
          </select>
          <span className="block text-xs text-gp-muted">{s.destinationHint}</span>
        </label>
        {vehicle.kind !== "car" && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={helmet} onChange={(e) => setHelmet(e.target.checked)} disabled={station.helmets === 0} />
            {station.helmets > 0 ? s.helmetLoan : s.helmetNone}
          </label>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={button} disabled={busy} onClick={() => void reserve(false)}>
            {s.reserve}
          </button>
          <button type="button" className={ghost} disabled={busy} onClick={() => void reserve(true)}>
            {s.startNow}
          </button>
          <button type="button" className={ghost} onClick={onClose}>
            {t.ui.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}

// The open ride --------------------------------------------------------------------------------

function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return `${h ? `${h}:` : ""}${String(m).padStart(h ? 2 : 1, "0")}:${String(sec).padStart(2, "0")}`;
}

function OpenRide({ ride, me, stations, onChange }: { ride: ShareRide; me: ShareMe; stations: ShareStation[]; onChange: () => void }) {
  const { t, locale } = useI18n();
  const { backend } = useApp();
  const s = t.share;
  const now = useNow(1_000);
  const { position } = usePosition();
  const { busy, error, run } = useAction();
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const lastSent = useRef(0);
  const onRoad = ride.status === "riding" || ride.status === "paused";

  // Keeps the ride fresh (an admin may end it, a reservation runs out).
  useEffect(() => {
    const id = window.setInterval(onChange, RIDE_POLL_MS);
    return () => window.clearInterval(id);
  }, [onChange]);

  // Without real trackers the phone tells where the vehicle is.
  useEffect(() => {
    if (!me.simulated || !onRoad || !position) return;
    if (Date.now() - lastSent.current < POSITION_EVERY_MS) return;
    lastSent.current = Date.now();
    backend.reportSharePosition(ride.id, position).catch(() => undefined);
  }, [me.simulated, onRoad, position, backend, ride.id]);

  const times = rideTimes(ride, now.getTime());
  const estimate = rideCost(ride.tariff, times);
  const nearest = position
    ? stations
        .map((st) => ({ st, d: distanceMeters(position, st) }))
        .sort((a, b) => a.d - b.d)[0]
    : null;
  const inZone = !!nearest && nearest.d <= nearest.st.radiusM;
  const action = (a: "start" | "cancel" | "pause" | "resume") => run(() => backend.shareRideAction(ride.id, a)).then((ok) => {
            if (ok) onChange();
          });

  return (
    <section className="space-y-3 rounded-2xl bg-gp-forest p-5 text-white">
      <div className="text-xs uppercase tracking-wide opacity-80">{s.status[ride.status]}</div>
      <div className="text-lg font-semibold">
        {ride.vehicle.name}
        {ride.vehicle.plate && <span className="ml-2 text-sm font-normal opacity-80">{ride.vehicle.plate}</span>}
      </div>
      {ride.status === "reserved" && ride.reserveExpiresAt && (
        <p className="text-sm">
          {format(s.reservedUntil, {
            station: ride.fromStationName,
            time: clock(Math.max(0, Date.parse(ride.reserveExpiresAt) - now.getTime())),
          })}
        </p>
      )}
      {onRoad && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs opacity-80">{s.time}</div>
            <div className="text-2xl font-bold tabular-nums">{clock(times.ridingMs)}</div>
            {times.pausedMs > 0 && <div className="text-xs opacity-80">{format(s.paused, { time: clock(times.pausedMs) })}</div>}
          </div>
          <div>
            <div className="text-xs opacity-80">{s.estimate}</div>
            <div className="text-2xl font-bold tabular-nums">{formatXof(estimate, locale)}</div>
          </div>
        </div>
      )}
      {onRoad && ride.toStationName && <p className="text-sm opacity-90">{format(s.heading, { station: ride.toStationName })}</p>}
      {onRoad && nearest && (
        <p className="text-sm opacity-90">{inZone ? format(s.inZone, { station: nearest.st.name }) : format(s.nearest, { station: nearest.st.name, distance: formatDistance(nearest.d) })}</p>
      )}
      {ride.helmet && <p className="text-xs opacity-80">{s.helmetReminder}</p>}
      <div className="flex flex-wrap gap-2">
        {ride.status === "reserved" && (
          <>
            <button type="button" className="rounded-full bg-gp-yellow px-4 py-2 text-sm font-semibold text-gp-forest disabled:opacity-50" disabled={busy} onClick={() => void action("start")}>
              {s.unlock}
            </button>
            <button type="button" className="rounded-full border border-white/40 px-4 py-2 text-sm disabled:opacity-50" disabled={busy} onClick={() => void action("cancel")}>
              {s.cancelReservation}
            </button>
          </>
        )}
        {onRoad && (
          <>
            <button type="button" className="rounded-full bg-gp-yellow px-4 py-2 text-sm font-semibold text-gp-forest disabled:opacity-50" disabled={busy} onClick={() => setConfirmEnd(true)}>
              {s.end}
            </button>
            <button type="button" className="rounded-full border border-white/40 px-4 py-2 text-sm disabled:opacity-50" disabled={busy} onClick={() => void action(ride.status === "paused" ? "resume" : "pause")}>
              {ride.status === "paused" ? s.resume : s.pause}
            </button>
            <button type="button" className="rounded-full border border-white/40 px-4 py-2 text-sm disabled:opacity-50" disabled={busy} onClick={() => setProblem("")}>
              {s.problem}
            </button>
          </>
        )}
      </div>
      {error && <p className="rounded-lg bg-white/10 p-2 text-sm text-amber-200">{error}</p>}
      <ConfirmSheet
        open={confirmEnd}
        title={s.endTitle}
        confirmLabel={s.end}
        busy={busy}
        onCancel={() => setConfirmEnd(false)}
        onConfirm={() => {
          setConfirmEnd(false);
          void run(() => backend.endShareRide(ride.id, position)).then((ok) => {
            if (ok) onChange();
          });
        }}
      >
        <p className="text-sm">{s.endMessage}</p>
      </ConfirmSheet>
      {problem !== null && (
        <form
          className="space-y-2 rounded-xl bg-white/10 p-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void run(() => backend.reportShareProblem(ride.id, problem)).then((ok) => {
              if (!ok) return;
              setProblem(null);
              onChange();
            });
          }}
        >
          <p className="text-sm">{s.problemHint}</p>
          <textarea className={`${input} text-zinc-900 dark:text-white`} rows={3} value={problem} onChange={(e) => setProblem(e.target.value)} maxLength={500} />
          <div className="flex gap-2">
            <button type="submit" className="rounded-full bg-gp-yellow px-4 py-2 text-sm font-semibold text-gp-forest disabled:opacity-50" disabled={busy}>
              {s.problemSend}
            </button>
            <button type="button" className="rounded-full border border-white/40 px-4 py-2 text-sm" onClick={() => setProblem(null)}>
              {t.ui.cancel}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

// Paying ---------------------------------------------------------------------------------------

/** An ended ride to pay: Green Credit with the PIN, Flooz/T-Money, or cash to the staff. */
function PayRide({ ride, me, onDone }: { ride: ShareRide; me: ShareMe; onDone: () => void }) {
  const { t, locale } = useI18n();
  const { backend } = useApp();
  const s = t.share;
  const ch = t.charging;
  const [method, setMethod] = useState<"wallet" | "mobile" | null>(null);
  const [pin, setPin] = useState("");
  const [network, setNetwork] = useState<"flooz" | "tmoney">("tmoney");
  const [phone, setPhone] = useState("");
  const [key] = useState(() => crypto.randomUUID());
  const { busy, error, run } = useAction();
  const amount = formatXof(ride.amountXof, locale);
  const pending = me.pendingPayments[ride.id];

  return (
    <section className={`${card} space-y-3`}>
      <h2 className="font-semibold">{format(s.toPay, { amount })}</h2>
      <p className="text-sm text-gp-muted">
        {format(s.rideSummary, {
          vehicle: ride.vehicle.name,
          from: ride.fromStationName,
          to: ride.endStationName ?? s.outsideStation,
        })}
      </p>
      {pending ? (
        <div className="space-y-2">
          <p className="text-sm">{ch.confirmOnPhone}</p>
          <button type="button" disabled={busy} onClick={() => void run(() => backend.refreshChargePayment(pending)).then(onDone)} className={button}>
            {ch.checkAgain}
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {me.payOptions.wallet && (
              <button type="button" onClick={() => setMethod("wallet")} aria-pressed={method === "wallet"} className={method === "wallet" ? button : ghost}>
                {ch.payWallet}
                {me.walletBalanceXof !== null && ` (${formatXof(me.walletBalanceXof, locale)})`}
              </button>
            )}
            {me.payOptions.mobile && (
              <button type="button" onClick={() => setMethod("mobile")} aria-pressed={method === "mobile"} className={method === "mobile" ? button : ghost}>
                {ch.payMobile}
              </button>
            )}
          </div>
          {method === "wallet" && (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => backend.payShareWallet(ride.id, { pin, idempotencyKey: key })).then((ok) => {
                  if (ok) onDone();
                });
              }}
            >
              <label className="block space-y-1">
                <span className="text-sm font-medium">{ch.pin}</span>
                <input
                  className={`${input} tracking-[0.4em]`}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                  inputMode="numeric"
                  type="password"
                  autoComplete="off"
                  required
                />
              </label>
              <button type="submit" disabled={busy || pin.length !== 4} className={`${button} w-full`}>
                {format(ch.payNow, { amount })}
              </button>
            </form>
          )}
          {method === "mobile" && (
            <form
              className="space-y-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => backend.payShareMobile(ride.id, { network, phone: phone.trim() })).then((ok) => {
                  if (ok) onDone();
                });
              }}
            >
              <div className="flex gap-2">
                {(["tmoney", "flooz"] as const).map((n) => (
                  <button key={n} type="button" onClick={() => setNetwork(n)} aria-pressed={network === n} className={network === n ? button : ghost}>
                    {n === "tmoney" ? "T-Money" : "Flooz"}
                  </button>
                ))}
              </div>
              <input required value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="+228 90 00 00 00" aria-label={ch.phone} className={input} />
              <button type="submit" disabled={busy} className={`${button} w-full`}>
                {format(ch.payNow, { amount })}
              </button>
            </form>
          )}
          <p className="text-xs text-gp-muted">{s.payCash}</p>
        </>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}

// History --------------------------------------------------------------------------------------

function History() {
  const { t, locale } = useI18n();
  const { backend } = useApp();
  const s = t.share;
  const { data, error } = useLiveQuery(() => backend.myShareRides());
  const done = (data ?? []).filter((r) => r.status === "ended");
  if (error instanceof BackendError || !done.length) return null;
  return (
    <section className="space-y-2">
      <h2 className="font-semibold">{s.history}</h2>
      <ul className="divide-y divide-black/10 rounded-xl border border-black/10 dark:divide-white/10 dark:border-white/10">
        {done.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-2 p-3 text-sm">
            <div>
              <div className="font-medium">
                {r.fromStationName} → {r.endStationName ?? s.outsideStation}
              </div>
              <div className="text-xs text-gp-muted">
                {new Date(r.endedAt ?? r.reservedAt).toLocaleString(locale === "fr" ? "fr-FR" : "en-GB", { dateStyle: "short", timeStyle: "short" })} · {r.vehicle.name}
                {r.distanceM > 0 && ` · ${formatDistance(r.distanceM)}`}
              </div>
            </div>
            <div className="text-right">
              <div className="font-semibold tabular-nums">{formatXof(r.amountXof, locale)}</div>
              <div className="text-xs text-gp-muted">{r.paymentStatus === "paid" ? (r.paidWith ? s.paidWith[r.paidWith] : "") : s.unpaid}</div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
