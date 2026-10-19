"use client";

import { useState, type FormEvent } from "react";
import { StationCashCard } from "@/components/owner/cash";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format, formatXof } from "@/lib/i18n/format";
import type { StationView } from "@/lib/types";
import { CREDIT_TOPUP_MIN_XOF, parseAmount, parseCreditCode, type CounterCredit } from "@/lib/wallet";
import { useApp } from "../app-provider";
import { ConfirmSheet } from "../confirm-sheet";
import { useI18n } from "../i18n-provider";
import { canScanQr, QrScanner } from "../parcels/qr-scanner";
import { Card, EmptyState } from "../ui";
import { WorkShell } from "./work-shell";

const input = "w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-base dark:border-white/20 dark:bg-zinc-900";
const button = "min-h-11 rounded-full bg-gp-green-dark px-4 text-sm font-semibold text-white disabled:opacity-50";
const ghost = "min-h-11 rounded-full border border-black/15 px-4 text-sm dark:border-white/20 disabled:opacity-50";

/**
 * /operator/green-credit: staff load a customer's Green Credit with the cash they hand over
 * (worker/wallet.ts topUpCredit). The customer typed their PIN on their own phone, which shows a
 * one-time code; staff scan it, see the name and balance, take the cash and confirm.
 */
export function CreditPage() {
  const { t } = useI18n();
  return (
    <WorkShell title={t.wallet.staff.title}>
      {({ station }) =>
        station.greenCredit ? (
          <div className="space-y-4">
            <CreditCounter key={station.id} station={station} />
            <MyCash key={`cash:${station.id}`} stationId={station.id} />
          </div>
        ) : (
          <EmptyState text={t.wallet.staff.notHere} />
        )
      }
    </WorkShell>
  );
}

/**
 * At our own stations (0051): the Green Credit this staff member loaded in cash since their last
 * closing, closed at the end of the shift (worker/station-cash.ts). Partner stations: the owner
 * closes the station's day in the backoffice instead, so nothing shows here.
 */
function MyCash({ stationId }: { stationId: string }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const { data, reload } = useLiveQuery(() => backend.myStationCash(stationId).then((cash) => ({ cash })), stationId);
  if (!data?.cash) return null;
  return (
    <div className="space-y-2">
      <h2 className="font-heading text-lg font-semibold">{t.stationCash.myCash}</h2>
      <p className="text-sm text-gp-muted">{t.stationCash.myCashIntro}</p>
      <StationCashCard cash={data.cash} admin={false} onChanged={reload} />
    </div>
  );
}

function CreditCounter({ station }: { station: StationView }) {
  const { t, locale } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const s = t.wallet.staff;
  const xof = (n: number) => formatXof(n, locale);
  const [code, setCode] = useState("");
  const [found, setFound] = useState<(CounterCredit & { code: string }) | null>(null);
  const [amount, setAmount] = useState("");
  const [scanning, setScanning] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const value = parseAmount(amount);
  const okAmount = value !== null && value >= CREDIT_TOPUP_MIN_XOF && (found?.maxTopupXof == null || value <= found.maxTopupXof);

  async function check(raw: string) {
    const parsed = parseCreditCode(raw);
    setMessage(null);
    setFound(null);
    if (!parsed) return setMessage({ ok: false, text: t.errors.credit_code_invalid });
    setBusy(true);
    try {
      setFound({ ...(await backend.checkCreditCode(station.id, parsed)), code: parsed });
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function topUp() {
    if (!found || value === null) return;
    setBusy(true);
    try {
      const done = await backend.topUpCredit(station.id, { code: found.code, amountXof: value });
      setMessage({ ok: true, text: format(s.done, { amount: xof(done.amountXof), name: done.customer, balance: xof(done.balanceXof) }) });
      // The code is used up: the next customer starts from an empty form.
      setFound(null);
      setCode("");
      setAmount("");
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <Card className="space-y-3 p-4">
      <p className="text-sm text-gp-muted">{s.intro}</p>
      <form
        className="flex gap-2"
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void check(code);
        }}
      >
        <input
          className={`${input} font-mono tracking-widest`}
          inputMode="numeric"
          maxLength={12}
          placeholder="1234 5678"
          aria-label={s.code}
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setFound(null);
          }}
        />
        <button type="submit" disabled={busy || !code.trim()} className={`${ghost} shrink-0`}>
          {s.check}
        </button>
      </form>
      {canScanQr() && !scanning && (
        <button type="button" onClick={() => setScanning(true)} className="text-sm font-medium text-gp-green-dark underline dark:text-gp-green">
          {s.scan}
        </button>
      )}
      {scanning && (
        <QrScanner
          onClose={() => setScanning(false)}
          onResult={(text) => {
            setScanning(false);
            setCode(parseCreditCode(text) ?? text);
            void check(text);
          }}
        />
      )}
      {found && (
        <div className="space-y-2 rounded-lg bg-zinc-100 px-3 py-2 dark:bg-zinc-900">
          <p className="text-sm font-medium">{format(s.customer, { name: found.customer, amount: xof(found.balanceXof) })}</p>
          {found.maxTopupXof !== null && <p className="text-xs text-gp-muted">{format(s.left, { amount: xof(found.maxTopupXof) })}</p>}
          <div className="flex gap-2">
            <input
              className={input}
              inputMode="numeric"
              placeholder={s.amount}
              aria-label={s.amount}
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d\s]/g, ""))}
            />
            <button type="button" disabled={busy || !okAmount} onClick={() => setConfirming(true)} className={`${button} shrink-0`}>
              {s.topUp}
            </button>
          </div>
          {value !== null && found.maxTopupXof !== null && value > found.maxTopupXof && <p className="text-xs text-red-600">{t.errors.credit_limit_reached}</p>}
        </div>
      )}
      {message && (
        <p role="status" className={`text-sm ${message.ok ? "text-gp-green-dark dark:text-gp-green" : "text-red-600"}`}>
          {message.text}
        </p>
      )}
      <ConfirmSheet
        open={confirming && !!found && value !== null}
        title={found && value !== null ? format(s.confirmTitle, { amount: xof(value), name: found.customer }) : ""}
        confirmLabel={s.confirm}
        busy={busy}
        onConfirm={() => void topUp()}
        onCancel={() => setConfirming(false)}
      >
        <p>{format(s.confirmBody, { amount: xof(value ?? 0) })}</p>
      </ConfirmSheet>
    </Card>
  );
}
