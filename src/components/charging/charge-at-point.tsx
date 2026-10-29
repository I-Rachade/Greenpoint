"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { boxFromCode, outletParam, type ChargeOutletSocket, type ChargePointState } from "@shared/charging";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format, formatXof } from "@/lib/i18n/format";
import { loginHref } from "@/lib/next-path";
import { useApp } from "../app-provider";
import { useI18n } from "../i18n-provider";
import { PageTitle } from "../page-title";
import { canScanQr, QrScanner } from "../parcels/qr-scanner";
import { MyCharges } from "./charging";

// Charging by QR code (shared/charging.ts): the customer scans the one sticker on a socket
// box (?o=), sees the station, the price and every outlet of the box, picks a free one and
// starts the charge with the PIN of their Green Credit, which pays it in advance (worker/charging.ts
// selfCharge). The running charge and its stop button are in MyCharges below.

const button = "w-full rounded-full bg-gp-green-dark px-4 py-3 text-sm font-semibold text-white disabled:opacity-50";

const STATE_TONE: Record<ChargePointState, string> = {
  free: "text-gp-green-dark dark:text-gp-green",
  busy: "text-amber-700 dark:text-amber-400",
  reserved: "text-amber-700 dark:text-amber-400",
  offline: "text-red-600",
  fault: "text-red-600",
  disabled: "text-zinc-600 dark:text-zinc-400",
};

export function ChargeAtPoint() {
  const { t } = useI18n();
  const q = t.charging.qr;
  const router = useRouter();
  const params = useSearchParams();
  const boxToken = params.get("o") ?? "";
  // One outlet's code (?s=): that outlet is selected when it is free.
  const outlet = outletParam(params.get("s"));
  // A per-outlet code from before one code per box (?p=) no longer opens an outlet.
  const oldCode = !boxToken && params.has("p");
  const { profile, ready } = useApp();
  // The scan button on the map (?scan=1) opens the camera straight away. useSearchParams
  // renders this page in the browser only, so canScanQr() can be asked here.
  const [scanning, setScanning] = useState(() => params.get("scan") === "1" && canScanQr());
  const [scanError, setScanError] = useState<string | null>(null);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 pb-6 pt-4">
      <PageTitle title={q.title} back />
      {boxToken ? (
        <BoxCard key={`${boxToken}:${outlet}`} token={boxToken} outlet={outlet} />
      ) : oldCode ? (
        <p role="alert" className="text-sm text-red-600">
          {q.oldCode}
        </p>
      ) : (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{q.scanHint}</p>
      )}
      {scanning ? (
        <QrScanner
          onClose={() => setScanning(false)}
          onResult={(text) => {
            setScanning(false);
            const box = boxFromCode(text);
            setScanError(box ? null : q.notOurCode);
            if (box) router.replace(`/recharge?o=${box.token}${box.outlet ? `&s=${box.outlet}` : ""}`);
          }}
        />
      ) : canScanQr() ? (
        <button
          type="button"
          onClick={() => {
            setScanError(null);
            setScanning(true);
          }}
          className={boxToken ? "text-sm text-gp-green-dark underline dark:text-gp-green" : button}
        >
          {q.scan}
        </button>
      ) : (
        !boxToken && <p className="text-sm">{q.noScanner}</p>
      )}
      {scanError && (
        <p role="alert" className="text-sm text-red-600">
          {scanError}
        </p>
      )}
      {ready && profile && <MyCharges />}
    </div>
  );
}

const TILE: Record<ChargePointState, string> = {
  free: "border-gp-green-dark bg-white text-zinc-900 dark:border-gp-green dark:bg-white/5 dark:text-white",
  busy: "border-gp-border bg-zinc-100 text-zinc-500 dark:border-white/10 dark:bg-white/5 dark:text-zinc-400",
  reserved: "border-gp-border bg-zinc-100 text-zinc-500 dark:border-white/10 dark:bg-white/5 dark:text-zinc-400",
  offline: "border-gp-border bg-zinc-100 text-zinc-500 dark:border-white/10 dark:bg-white/5 dark:text-zinc-400",
  fault: "border-gp-border bg-zinc-100 text-zinc-500 dark:border-white/10 dark:bg-white/5 dark:text-zinc-400",
  disabled: "border-gp-border bg-zinc-100 text-zinc-500 dark:border-white/10 dark:bg-white/5 dark:text-zinc-400",
};

/** One sticker per box: every outlet of it, only free ones can be picked. */
function BoxCard({ token, outlet }: { token: string; outlet: number | null }) {
  const { t, locale } = useI18n();
  const q = t.charging.qr;
  const { backend, profile, ready } = useApp();
  const [pin, setPin] = useState("");
  const errorMessage = useErrorMessage();
  const { data: info, error, reload } = useLiveQuery(() => backend.chargeOutlet(token), `${token}:${profile?.id ?? ""}`);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Outlets are taken and freed by others: the list follows without a reload.
  useEffect(() => {
    const timer = setInterval(reload, 10_000);
    return () => clearInterval(timer);
  }, [reload]);

  if (!info) {
    return error ? (
      <p role="alert" className="text-sm text-red-600">
        {q.notFound}
      </p>
    ) : (
      <p className="text-sm text-zinc-500">{t.loading}</p>
    );
  }

  const free = info.outlets.filter((o) => o.state === "free");
  // The scanned outlet's own code, then the customer's own reservation, else the only free outlet.
  const preferred = free.find((o) => o.outlet === outlet) ?? free.find((o) => o.yours) ?? (free.length === 1 ? free[0] : undefined);
  const choice = free.find((o) => o.pointId === picked) ?? preferred;

  async function start(outlet: ChargeOutletSocket) {
    setBusy(true);
    setMessage(null);
    try {
      await backend.startOutletCharge(token, outlet.pointId, pin);
      setMessage({ ok: true, text: q.started });
      setPicked(null);
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    } finally {
      setPin("");
      setBusy(false);
      reload();
    }
  }

  const here = `/recharge?o=${token}${outlet ? `&s=${outlet}` : ""}`;
  const xof = (n: number) => formatXof(n, locale);
  const balance = info.balanceXof ?? 0;
  const enough = balance >= info.tariff.minXof;
  // A car charger linked to this box (0048): shown by its name, plug and power, at the car price.
  const car = info.outlets.length > 0 && info.outlets.every((o) => o.ev) ? info.outlets[0].ev : undefined;
  const plug = (c: string) => t.backoffice.evChargers.connectors[c as keyof typeof t.backoffice.evChargers.connectors] ?? c;
  return (
    <section className="space-y-3 rounded-2xl border border-gp-border bg-gp-surface p-4 shadow-sm dark:border-white/10">
      <div>
        <div className="text-sm text-zinc-600 dark:text-zinc-400">{info.stationName}</div>
        <h2 className="text-xl font-semibold">{car ? `🚗 ${car.name}` : format(q.box, { label: info.label })}</h2>
        {car && <div className="text-sm text-zinc-600 dark:text-zinc-400">{format(q.car, { plug: plug(car.connector), power: car.powerKw })}</div>}
      </div>
      <p className="text-sm">{format(car ? t.charging.evTariff : t.charging.tariff, { kwh: info.tariff.kwhXof, min: info.tariff.minXof })}</p>
      {!info.creditAccepted && (
        <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
          {q.creditNotAccepted}
        </p>
      )}
      {info.creditAccepted && <p className="text-sm">{free.length ? (car ? q.carPlug : q.pick) : q.noneFree}</p>}
      {outlet && free.length > 0 && !free.some((o) => o.outlet === outlet) && info.outlets.some((o) => o.outlet === outlet) && (
        <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
          {format(q.socketTaken, { n: outlet })}
        </p>
      )}
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label={q.pick}>
        {info.outlets.map((o) => {
          const selectable = o.state === "free";
          const selected = choice?.pointId === o.pointId;
          return (
            <li key={o.pointId}>
              <button
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={!selectable || busy}
                onClick={() => setPicked(o.pointId)}
                className={`w-full rounded-xl border-2 px-3 py-3 text-left disabled:cursor-not-allowed ${TILE[o.state]} ${
                  selected ? "ring-4 ring-gp-yellow" : ""
                }`}
              >
                <span className="block text-base font-semibold">{o.ev ? o.ev.name : format(q.socket, { n: o.outlet })}</span>
                <span className={`block text-xs font-medium ${selectable ? STATE_TONE.free : ""}`}>{o.yours ? q.yours : q.tile[o.state]}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {choice &&
        ready &&
        (profile ? (
          enough ? (
            <>
              <p className="text-sm">{format(q.credit, { amount: xof(balance) })}</p>
              <p className="text-sm">{q.plugIn}</p>
              <input
                className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-base tracking-[0.4em] dark:border-white/20 dark:bg-zinc-900"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
                inputMode="numeric"
                type="password"
                autoComplete="off"
                aria-label={q.creditPin}
                placeholder={q.creditPin}
              />
              <button type="button" disabled={busy || pin.length !== 4} onClick={() => void start(choice)} className={button}>
                {car ? q.start : format(q.startOn, { n: choice.outlet })}
              </button>
            </>
          ) : (
            <>
              <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
                {format(q.creditLow, { amount: xof(balance), min: xof(info.tariff.minXof) })}
              </p>
              <Link href="/portefeuille" className="text-sm font-medium text-gp-green-dark underline dark:text-gp-green">
                {q.creditTopup}
              </Link>
            </>
          )
        ) : (
          <>
            <p className="text-sm">{q.login}</p>
            <Link href={loginHref(here)} className={`${button} block text-center`}>
              {t.nav.login}
            </Link>
          </>
        ))}
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-gp-green-dark dark:text-gp-green" : "text-red-600"}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}
