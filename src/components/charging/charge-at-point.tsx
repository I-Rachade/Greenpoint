"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { pointIdFromCode, type ChargePointState } from "@/lib/charging";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { loginHref } from "@/lib/next-path";
import { useApp } from "../app-provider";
import { useI18n } from "../i18n-provider";
import { PageTitle } from "../page-title";
import { canScanQr, QrScanner } from "../parcels/qr-scanner";
import { MyCharges } from "./charging";

// Charging by QR code (src/lib/charging.ts): the customer scans the sticker on an outlet,
// sees the station, the price and whether it is free, and starts the charge. The running
// charge, its stop button and the payment are in MyCharges below.

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
  const pointId = useSearchParams().get("p") ?? "";
  const { profile, ready } = useApp();
  const [scanning, setScanning] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 pb-6 pt-4">
      <PageTitle title={q.title} back />
      {pointId ? <PointCard key={pointId} pointId={pointId} /> : <p className="text-sm text-zinc-600 dark:text-zinc-400">{q.scanHint}</p>}
      {scanning ? (
        <QrScanner
          onClose={() => setScanning(false)}
          onResult={(text) => {
            setScanning(false);
            const id = pointIdFromCode(text);
            setScanError(id ? null : q.notOurCode);
            if (id) router.replace(`/recharge?p=${encodeURIComponent(id)}`);
          }}
        />
      ) : canScanQr() ? (
        <button
          type="button"
          onClick={() => {
            setScanError(null);
            setScanning(true);
          }}
          className={pointId ? "text-sm text-gp-green-dark underline dark:text-gp-green" : button}
        >
          {q.scan}
        </button>
      ) : (
        !pointId && <p className="text-sm">{q.noScanner}</p>
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

function PointCard({ pointId }: { pointId: string }) {
  const { t } = useI18n();
  const q = t.charging.qr;
  const { backend, profile, ready } = useApp();
  const errorMessage = useErrorMessage();
  const { data: info, error, reload } = useLiveQuery(() => backend.chargePoint(pointId), pointId);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (!info) {
    return error ? (
      <p role="alert" className="text-sm text-red-600">
        {q.notFound}
      </p>
    ) : (
      <p className="text-sm text-zinc-500">{t.loading}</p>
    );
  }

  async function start() {
    setBusy(true);
    setMessage(null);
    try {
      await backend.startSelfCharge(pointId);
      setMessage({ ok: true, text: q.started });
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
      reload();
    }
  }

  const here = `/recharge?p=${encodeURIComponent(pointId)}`;
  return (
    <section className="space-y-3 rounded-2xl border border-gp-border bg-gp-surface p-4 shadow-sm dark:border-white/10">
      <div>
        <div className="text-sm text-zinc-600 dark:text-zinc-400">{info.stationName}</div>
        <h2 className="text-xl font-semibold">{format(q.outlet, { label: info.label })}</h2>
      </div>
      <p className={`text-sm font-medium ${STATE_TONE[info.state]}`}>{q.states[info.state]}</p>
      <p className="text-sm">{format(t.charging.tariff, { kwh: info.tariff.kwhXof, min: info.tariff.minXof })}</p>
      {info.state === "free" &&
        ready &&
        (profile ? (
          <>
            <p className="text-sm">{q.plugIn}</p>
            <button type="button" disabled={busy} onClick={() => void start()} className={button}>
              {q.start}
            </button>
          </>
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
