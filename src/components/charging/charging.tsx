"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  CHARGE_POLL_MS,
  chargeSeconds,
  customerCode,
  formatDuration,
  formatKwh,
  type ChargeSession,
} from "@/lib/charging";
import type { CounterCard } from "@/lib/charge-cards";
import { parseCreditCode } from "@/lib/wallet";
import { displayStatus } from "@/lib/iot/charging-points";
import { useErrorMessage, useLiveQuery, useNow } from "@/lib/hooks";
import { format, formatXof } from "@/lib/i18n/format";
import type { ChargingPoint, StationView } from "@/lib/types";
import { useApp } from "../app-provider";
import { ConfirmSheet } from "../confirm-sheet";
import { useI18n } from "../i18n-provider";
import { QrImage } from "../parcels/qr-image";
import { canScanQr, QrScanner } from "../parcels/qr-scanner";

// Charging at a socket (src/lib/charging.ts): the staff screen, the customer's charges and "Mon code".

const input = "w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-base dark:border-white/20 dark:bg-zinc-900";
const button = "rounded-full bg-gp-green-dark px-4 py-2 text-sm font-semibold text-white disabled:opacity-50";
const ghost = "rounded-full border border-black/15 px-4 py-2 text-sm dark:border-white/20 disabled:opacity-50";

/** Reloads every CHARGE_POLL_MS while `active`, so power, energy and price stay fresh. */
function usePolling(reload: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(reload, CHARGE_POLL_MS);
    return () => window.clearInterval(id);
  }, [reload, active]);
}

function Figure({ label, value, big = false }: { label: string; value: string; big?: boolean }) {
  return (
    <div>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`font-semibold tabular-nums ${big ? "text-2xl" : "text-lg"}`}>{value}</div>
    </div>
  );
}

/** Power, energy, duration and price of one charge; the same card for staff and customer. */
function ChargeCard({ charge: c, showStation = false, children }: { charge: ChargeSession; showStation?: boolean; children?: ReactNode }) {
  const { t, locale } = useI18n();
  const now = useNow(10_000);
  const ch = t.charging;
  const xof = (n: number) => formatXof(n, locale);
  const status =
    c.status === "charging"
      ? ch.charging
      : c.status === "paid"
        ? format(ch.paid, { method: c.paymentMethod ? ch.methods[c.paymentMethod] : "" })
        : c.status === "cancelled"
          ? ch.cancelled
          : ch.stopped;
  const tone =
    c.status === "charging"
      ? "border-gp-green bg-gp-green/10"
      : c.status === "stopped"
        ? "border-amber-400 bg-amber-50 dark:bg-amber-950/30"
        : "border-black/10 dark:border-white/10";
  return (
    <div className={`space-y-3 rounded-xl border p-4 ${tone}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="font-semibold">
          {showStation ? `${c.stationName} · ` : ""}
          {c.pointLabel}
          <span className="ml-2 text-sm font-normal text-zinc-600 dark:text-zinc-400">{c.customer ?? ch.cashCustomer}</span>
        </div>
        <span className="text-sm font-medium">
          {c.status === "charging" && <span className="mr-1 inline-block h-2 w-2 animate-pulse rounded-full bg-gp-green" aria-hidden />}
          {status}
        </span>
      </div>
      {c.endedByDevice && c.status === "stopped" && <p className="text-xs text-zinc-600 dark:text-zinc-400">{ch.endedByDevice}</p>}
      <div className={`grid grid-cols-2 gap-3 ${c.status === "charging" ? "sm:grid-cols-5" : "sm:grid-cols-4"}`}>
        {c.status === "charging" && <Figure label={ch.power} value={`${c.powerWatts} W`} />}
        <Figure label={ch.energy} value={formatKwh(c.energyWh, locale)} />
        <Figure label={ch.duration} value={formatDuration(chargeSeconds(c, now))} />
        <Figure label={ch.kwhPrice} value={`${xof(c.tariff.kwhXof)}/kWh`} />
        <Figure
          label={c.status === "charging" ? ch.priceSoFar : c.status === "paid" ? ch.amountPaid : ch.priceFinal}
          value={xof(c.amountXof)}
          big={c.status !== "charging"}
        />
      </div>
      {c.status === "stopped" && c.energyWh === 0 && <p className="text-sm">{ch.nothingCharged}</p>}
      {c.greenpoints > 0 && <p className="text-sm text-gp-green-dark dark:text-gp-green">🌱 {format(ch.greenpoints, { points: c.greenpoints })}</p>}
      {children}
    </div>
  );
}

// Station staff --------------------------------------------------------------------------

function StartForm({ station, pointId, onDone, customer }: { station: StationView; pointId: string; onDone: (error?: string) => void; customer?: string }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const ch = t.charging;
  // A customer scanned on the scanner page: their account still needs the one-time code from their app.
  const [app, setApp] = useState(!!customer);
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      // Only the customer's one-time Green Credit code puts the charge on their account; without it, an anonymous cash charge.
      await backend.startCharge(station.id, { pointId, creditCode: app ? (parseCreditCode(code) ?? code.trim()) : undefined });
      onDone();
    } catch (err) {
      onDone(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg bg-zinc-100 p-3 dark:bg-zinc-900">
      <div className="flex gap-2" role="radiogroup">
        {[false, true].map((isApp) => (
          <button
            key={String(isApp)}
            type="button"
            role="radio"
            aria-checked={app === isApp}
            onClick={() => setApp(isApp)}
            className={`flex-1 rounded-full px-3 py-2 text-sm font-medium ${app === isApp ? "bg-gp-forest text-white" : "bg-white dark:bg-zinc-800"}`}
          >
            {isApp ? ch.appCustomer : ch.cashCustomer}
          </button>
        ))}
      </div>
      {app && (
        <div className="space-y-2">
          <input
            required
            inputMode="numeric"
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="1234 5678"
            aria-label={ch.contact}
            className={`${input} font-mono tracking-widest`}
          />
          <p className="text-xs text-zinc-500">{ch.contactHint}</p>
          {canScanQr() && !scanning && (
            <button type="button" onClick={() => setScanning(true)} className="text-sm text-gp-green-dark underline dark:text-gp-green">
              {ch.scan}
            </button>
          )}
          {scanning && (
            <QrScanner
              onClose={() => setScanning(false)}
              onResult={(text) => {
                setScanning(false);
                setCode(parseCreditCode(text) ?? text);
              }}
            />
          )}
        </div>
      )}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className={`${button} flex-1`}>
          {ch.start}
        </button>
        <button type="button" onClick={() => onDone()} className={ghost}>
          {ch.cancel}
        </button>
      </div>
    </form>
  );
}

/** Station staff: the connected outlets, starting and stopping a charge, collecting the cash, today's takings. */
/** `customer`: an app customer scanned on the scanner page; each start form opens for an app customer (their one-time code is still needed). */
export function StaffCharging({ station, customer }: { station: StationView; customer?: string }) {
  const { t, locale } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const ch = t.charging;
  const xof = (n: number) => formatXof(n, locale);
  const { data, reload } = useLiveQuery(() => backend.stationCharging(station.id), station.id);
  const [starting, setStarting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Stopping and booking cash cannot be undone, so each is confirmed first.
  const [confirm, setConfirm] = useState<{ kind: "stop" | "cash"; id: string } | null>(null);
  // Motorbike outlets, then the car chargers linked to an outlet (named after the charger, as their charges are).
  const points: (ChargingPoint & { ev?: string })[] = [
    ...(station.chargingPoints ?? []).filter((p) => p.deviceId).sort((a, b) => a.label.localeCompare(b.label)),
    ...(station.evChargers ?? []).flatMap((c) =>
      c.point ? [{ ...c.point, stationId: station.id, label: c.name, powerWatts: 0, ev: `${c.powerKw} kW` }] : [],
    ),
  ];
  usePolling(reload, (data?.open.length ?? 0) > 0);

  if (points.length === 0) return null;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      setConfirm(null);
      reload();
    }
  }

  // The latest values of the charge being confirmed, so energy and price stay current while the sheet is open.
  const pending = confirm ? data?.open.find((c) => c.id === confirm.id) : undefined;

  return (
    <section className="space-y-3 rounded-xl border border-black/10 p-4 dark:border-white/10">
      <div>
        <h3 className="text-sm font-semibold">⚡ {ch.title}</h3>
        <p className="text-xs text-zinc-500">{ch.intro}</p>
        {data && <p className="mt-1 text-xs font-medium">{format(ch.tariff, { kwh: data.tariff.kwhXof, min: data.tariff.minXof })}</p>}
        {data && points.some((p) => p.ev) && (
          <p className="text-xs font-medium">{format(ch.evTariff, { kwh: data.evTariff.kwhXof, min: data.evTariff.minXof })}</p>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <ul className="space-y-3">
        {points.map((p) => {
          const charge = data?.open.find((c) => c.pointLabel === p.label);
          const shown = displayStatus(p);
          return (
            <li key={p.id} className="space-y-2">
              {charge ? (
                <ChargeCard charge={charge}>
                  <div className="flex flex-wrap gap-2">
                    {charge.status === "charging" && (
                      <button type="button" disabled={busy} onClick={() => setConfirm({ kind: "stop", id: charge.id })} className={`${button} min-h-11 bg-red-600`}>
                        {ch.stop}
                      </button>
                    )}
                    {charge.status === "stopped" && charge.card && charge.amountXof > 0 && <p className="text-xs text-zinc-500">{ch.cardPaid}</p>}
                    {charge.status === "stopped" && !charge.card && charge.creditLimitXof !== undefined && charge.amountXof > 0 && (
                      <p className="text-xs text-zinc-500">{ch.creditPaid}</p>
                    )}
                    {charge.status === "stopped" && !charge.card && charge.creditLimitXof === undefined && charge.amountXof > 0 && (
                      <button type="button" disabled={busy} onClick={() => setConfirm({ kind: "cash", id: charge.id })} className={`${button} min-h-11 flex-1`}>
                        {ch.collectCash} · {xof(charge.amountXof)}
                      </button>
                    )}
                    {charge.status === "stopped" && charge.energyWh === 0 && (
                      <button type="button" disabled={busy} onClick={() => run(() => backend.cancelCharge(station.id, charge.id))} className={`${ghost} min-h-11`}>
                        {ch.close}
                      </button>
                    )}
                  </div>
                </ChargeCard>
              ) : (
                <div className="flex items-center justify-between gap-3 rounded-lg bg-zinc-100 px-3 py-2 dark:bg-zinc-900">
                  <span className="text-sm">
                    {p.ev && <span aria-hidden>🚗 </span>}
                    <span className="font-medium">{p.label}</span> {p.ev && <span className="text-xs text-zinc-500">({p.ev})</span>} · {t.station.outletStatus[shown]}
                  </span>
                  {starting !== p.id && (
                    <button type="button" disabled={shown === "offline" || shown === "fault"} onClick={() => setStarting(p.id)} className={button}>
                      {ch.start}
                    </button>
                  )}
                </div>
              )}
              {starting === p.id && !charge && (
                <StartForm
                  station={station}
                  pointId={p.id}
                  customer={customer}
                  onDone={(message) => {
                    setError(message ?? null);
                    if (!message) setStarting(null);
                    reload();
                  }}
                />
              )}
            </li>
          );
        })}
      </ul>
      <ConfirmSheet
        open={!!pending}
        title={
          pending
            ? confirm?.kind === "stop"
              ? format(ch.stopTitle, { outlet: pending.pointLabel })
              : format(ch.cashTitle, { amount: xof(pending.amountXof) })
            : ""
        }
        confirmLabel={confirm?.kind === "stop" ? ch.stopConfirm : ch.cashConfirm}
        danger={confirm?.kind === "stop"}
        busy={busy}
        onConfirm={() => {
          if (!pending || !confirm) return;
          void run(() =>
            confirm.kind === "stop" ? backend.stopCharge(station.id, pending.id) : backend.payChargeCash(station.id, pending.id),
          );
        }}
        onCancel={() => setConfirm(null)}
      >
        {pending && (
          <p>
            {confirm?.kind === "stop"
              ? format(ch.stopBody, { energy: formatKwh(pending.energyWh, locale), price: xof(pending.amountXof) })
              : format(ch.cashBody, { amount: xof(pending.amountXof), outlet: pending.pointLabel })}
          </p>
        )}
      </ConfirmSheet>
      <CardCounter station={station} />
      {data && (
        <div className="space-y-2 border-t border-black/10 pt-3 dark:border-white/10">
          <div className="text-sm font-medium">{ch.today}</div>
          <p className="text-sm">{format(ch.takings, { cash: xof(data.takings.cashXof), app: xof(data.takings.appXof), n: data.takings.count })}</p>
          <ul className="space-y-1 text-sm">
            {data.today.map((c) => (
              <li key={c.id} className="flex justify-between gap-2 text-zinc-600 dark:text-zinc-400">
                <span>
                  {new Date(c.startedAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })} · {c.pointLabel} · {c.customer ?? (c.card ? format(ch.cardCustomer, { tag: c.card }) : ch.cashCustomer)} ·{" "}
                  {formatKwh(c.energyWh, locale)}
                </span>
                <span className="tabular-nums">
                  {c.status === "paid" ? `${xof(c.amountXof)} ${ch.methods[c.paymentMethod ?? "cash"]}` : ch.cancelled}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * Station staff: whose account a charging card belongs to and the Green Credit it pays with.
 * Cards are not topped up here: the customer loads their Green Credit with their one-time QR
 * code (Green Credit page), and an unlinked card charges nothing until an admin links it.
 */
function CardCounter({ station }: { station: StationView }) {
  const { t, locale } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const cc = t.charging.cardCounter;
  const xof = (n: number) => formatXof(n, locale);
  const [tag, setTag] = useState("");
  const [found, setFound] = useState<CounterCard | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function check(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    setFound(null);
    try {
      setFound(await backend.counterCard(station.id, tag.trim()));
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 border-t border-black/10 pt-3 dark:border-white/10">
      <div className="text-sm font-medium">{cc.title}</div>
      <p className="text-xs text-zinc-500">{cc.intro}</p>
      <form onSubmit={check} className="flex gap-2">
        <input
          className={`${input} font-mono uppercase`}
          required
          maxLength={24}
          placeholder={cc.number}
          aria-label={cc.number}
          value={tag}
          onChange={(e) => {
            setTag(e.target.value);
            setFound(null);
          }}
        />
        <button type="submit" disabled={busy} className={`${ghost} shrink-0`}>
          {cc.check}
        </button>
      </form>
      {found && (
        <div className="space-y-1 rounded-lg bg-zinc-100 px-3 py-2 dark:bg-zinc-900">
          {found.linked && found.balanceXof === undefined ? (
            <p className="text-sm">{format(cc.linkedHidden, { tag: found.idTag })}</p>
          ) : found.linked ? (
            <>
              <p className={`text-sm font-medium ${(found.balanceXof ?? 0) < 0 ? "text-red-600" : ""}`}>
                {format(cc.credit, { tag: found.idTag, customer: found.customer ?? "", amount: xof(found.balanceXof ?? 0) })}
              </p>
              <p className="text-xs text-zinc-500">{cc.loadWithQr}</p>
            </>
          ) : (
            <p className="text-sm text-red-600">{format(cc.notLinked, { tag: found.idTag })}</p>
          )}
          {found.blocked && <p className="text-sm text-red-600">{cc.blocked}</p>}
        </div>
      )}
      {message && <p className="text-sm text-red-600">{message}</p>}
    </div>
  );
}

// Customer ----------------------------------------------------------------------------------

function newKey(): string {
  return crypto.randomUUID();
}

/** Paying a finished charge in the app: wallet with the PIN, or Flooz/T-Money. */
function PayInApp({ charge, onDone }: { charge: ChargeSession; onDone: () => void }) {
  const { t, locale } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const ch = t.charging;
  const options = charge.payOptions ?? { wallet: false, mobile: false };
  const [method, setMethod] = useState<"wallet" | "mobile" | null>(null);
  const [pin, setPin] = useState("");
  const [network, setNetwork] = useState<"flooz" | "tmoney">("tmoney");
  const [phone, setPhone] = useState("");
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const amount = formatXof(charge.amountXof, locale);

  if (charge.status !== "stopped" || charge.amountXof <= 0) return null;
  // Paid in advance: taken from the card or the Green Credit when the charge ends.
  if (charge.card || charge.creditLimitXof !== undefined) return <p className="text-sm text-zinc-500">{charge.card ? ch.cardPaid : ch.creditPaid}</p>;
  if (!options.wallet && !options.mobile) return <p className="text-sm">{format(ch.payCashOnly, { amount })}</p>;

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (charge.pendingPaymentId) {
    return (
      <div className="space-y-2">
        <p className="text-sm">{ch.confirmOnPhone}</p>
        <button type="button" disabled={busy} onClick={() => run(() => backend.refreshChargePayment(charge.pendingPaymentId!))} className={button}>
          {ch.checkAgain}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-sm">{format(ch.payHere, { amount })}</p>
      <div className="flex gap-2">
        {options.wallet && (
          <button type="button" onClick={() => setMethod("wallet")} aria-pressed={method === "wallet"} className={method === "wallet" ? button : ghost}>
            {ch.payWallet}
          </button>
        )}
        {options.mobile && (
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
            void run(() => backend.payChargeWallet(charge.id, { pin, idempotencyKey: key }));
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
            void run(() => backend.payChargeMobile(charge.id, { network, phone: phone.trim() }));
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
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

/** The customer stops a charge they started by QR code, after confirming. */
function StopMine({ charge, onDone }: { charge: ChargeSession; onDone: () => void }) {
  const { t, locale } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const ch = t.charging;
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (charge.status !== "charging" || !charge.selfStarted) return null;

  async function stop() {
    setBusy(true);
    setError(null);
    try {
      await backend.stopSelfCharge(charge.id);
      setAsking(false);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <button type="button" onClick={() => setAsking(true)} className={`${ghost} w-full border-red-300 text-red-700 dark:text-red-400`}>
        {ch.stop}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <ConfirmSheet
        open={asking}
        title={ch.qr.stopTitle}
        confirmLabel={ch.stopConfirm}
        danger
        busy={busy}
        onConfirm={() => void stop()}
        onCancel={() => setAsking(false)}
      >
        {format(ch.qr.stopBody, { energy: formatKwh(charge.energyWh, locale), price: formatXof(charge.amountXof, locale) })}
      </ConfirmSheet>
    </div>
  );
}

/** The customer's charges: live while charging, the price and the ways to pay once stopped. */
export function MyCharges() {
  const { t } = useI18n();
  const { backend } = useApp();
  const { data, reload } = useLiveQuery(() => backend.myCharges());
  const open = (data ?? []).filter((c) => c.status === "charging" || c.status === "stopped" || !!c.pendingPaymentId);
  usePolling(reload, open.length > 0);
  if (!data || data.length === 0) return null;
  const recent = data.filter((c) => !open.includes(c)).slice(0, 5);
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">⚡ {t.charging.mine}</h2>
      {open.map((c) => (
        <ChargeCard key={c.id} charge={c} showStation>
          <StopMine charge={c} onDone={reload} />
          <PayInApp charge={c} onDone={reload} />
        </ChargeCard>
      ))}
      {recent.map((c) => (
        <ChargeCard key={c.id} charge={c} showStation />
      ))}
    </section>
  );
}

/** "Mon code": the QR code staff scan to find the customer (a charge on their account needs their Green Credit code, 0052). */
export function MyCode({ contact }: { contact: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <section className="space-y-2 rounded-2xl border border-gp-border bg-gp-surface p-4 shadow-sm dark:border-white/10">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center justify-between text-left">
        <span className="font-semibold">{t.charging.myCode}</span>
        <span aria-hidden>{open ? "−" : "+"}</span>
      </button>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.charging.myCodeHint}</p>
      {open && (
        <div className="flex flex-col items-center gap-2 pt-2">
          <QrImage text={customerCode(contact)} label={t.charging.myCode} size={220} />
          <div className="font-mono text-lg font-semibold">{contact}</div>
        </div>
      )}
    </section>
  );
}
