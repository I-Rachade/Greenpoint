"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useDateTime } from "@/components/backoffice/shared";
import { QrImage } from "@/components/parcels/qr-image";
import { BackendError } from "@/lib/backend";
import { useErrorMessage, useLiveQuery, useNow } from "@/lib/hooks";
import { format, formatXof } from "@/lib/i18n/format";
import { creditCodePayload, formatCreditCode, type CreditCode, type WalletTransaction, type WalletView } from "@/lib/wallet";
import { useApp } from "../app-provider";
import { useI18n } from "../i18n-provider";
import { LoadFailed, OfflineNotice } from "../load-state";
import { CountUp } from "../ui";

const input = "w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-base dark:border-white/20 dark:bg-zinc-900";
const button = "rounded-full bg-gp-green-dark px-4 py-2 text-sm font-medium text-white disabled:opacity-50";

/**
 * "Green Credit": the balance, the counter code (PIN on the customer's own phone, then a
 * one-time code staff scan to load the credit or take a swap from it), where it works, and
 * the history. Same page in the web app and the mobile apps. Charges by QR code take the PIN
 * on the outlet page (charge-at-point.tsx).
 */
export function WalletPanel() {
  const { t, locale } = useI18n();
  const { backend } = useApp();
  const { data, error, reload } = useLiveQuery(() => backend.myWallet());

  if (error instanceof BackendError && error.code === "wallet_disabled") {
    return <p className="p-6 text-sm text-gp-muted">{t.errors.wallet_disabled}</p>;
  }
  // A failed refresh keeps the balance on screen (with a notice); only nothing at all shows the error.
  if (!data) return error ? <LoadFailed error={error} onRetry={reload} /> : <p className="p-6 text-sm text-gp-muted">{t.loading}</p>;

  return (
    <div className="mx-auto w-full max-w-md space-y-4 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">{t.wallet.title}</h1>
      {!!error && <OfflineNotice />}
      {data.testMode && <p className="rounded-lg bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">{t.wallet.testMode}</p>}
      <section className="rounded-2xl bg-gp-forest p-5 text-white">
        <div className="text-xs uppercase tracking-wide opacity-80">{t.wallet.balance}</div>
        <CountUp value={data.balanceXof} format={(n) => formatXof(n, locale)} className="mt-1 block text-3xl font-bold" />
        {data.maxXof > 0 && <div className="mt-1 text-xs opacity-80">{format(t.wallet.max, { max: formatXof(data.maxXof, locale) })}</div>}
        {data.frozen && <div className="mt-2 text-sm font-medium text-amber-200">{t.wallet.frozen}</div>}
      </section>
      <p className="text-sm text-gp-muted">{data.balanceXof === 0 ? t.wallet.emptyHint : t.wallet.rules}</p>
      {!data.frozen && <CounterCode onUsed={reload} />}
      <Stations wallet={data} />
      <section className="space-y-2">
        <h2 className="font-semibold">{t.wallet.history}</h2>
        <History items={data.transactions} />
      </section>
    </div>
  );
}

/** The PIN, then the one-time code for the counter, with its countdown. */
function CounterCode({ onUsed }: { onUsed: () => void }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const now = useNow(1_000);
  const [pin, setPin] = useState("");
  const [code, setCode] = useState<CreditCode | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const left = code ? Math.max(0, Math.floor((new Date(code.expiresAt).getTime() - now.getTime()) / 1000)) : 0;

  // While the code is on screen, the balance follows what staff do with it.
  useEffect(() => {
    if (!code) return;
    const id = window.setInterval(onUsed, 5_000);
    return () => window.clearInterval(id);
  }, [code, onUsed]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setCode(await backend.createCreditCode(pin));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPin("");
      setBusy(false);
    }
  }

  if (code) {
    const expired = left === 0;
    return (
      <section className="flex flex-col items-center gap-3 rounded-xl border border-black/10 p-4 text-center dark:border-white/10">
        <h2 className="font-semibold">{t.wallet.codeTitle}</h2>
        <div className={expired ? "opacity-30" : ""}>
          <QrImage text={creditCodePayload(code.code)} label={t.wallet.codeTitle} size={200} />
        </div>
        <div className="font-mono text-2xl font-semibold tracking-widest">{formatCreditCode(code.code)}</div>
        <p className={`text-sm ${expired ? "text-red-600" : "text-gp-muted"}`}>
          {expired ? t.wallet.codeExpired : format(t.wallet.codeValid, { time: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}` })}
        </p>
        <button type="button" onClick={() => setCode(null)} className="text-sm font-medium text-gp-green-dark underline dark:text-gp-green">
          {expired ? t.wallet.newCode : t.wallet.close}
        </button>
      </section>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-black/10 p-4 dark:border-white/10">
      <h2 className="font-semibold">{t.wallet.counter}</h2>
      <p className="text-sm text-gp-muted">{t.wallet.counterHint}</p>
      <div className="flex gap-2">
        <input
          className={`${input} tracking-[0.4em]`}
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))}
          inputMode="numeric"
          type="password"
          autoComplete="off"
          aria-label={t.wallet.pin}
          placeholder={t.wallet.pin}
          required
        />
        <button type="submit" className={`${button} shrink-0`} disabled={busy || pin.length !== 4}>
          {t.wallet.showCode}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}

function Stations({ wallet }: { wallet: WalletView }) {
  const { t } = useI18n();
  return (
    <section className="space-y-2">
      <h2 className="font-semibold">{t.wallet.stations}</h2>
      {wallet.stations.length === 0 ? (
        <p className="text-sm text-gp-muted">{t.wallet.noStations}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {wallet.stations.map((s) => (
            <li key={s.id} className="rounded-full bg-gp-green/10 px-3 py-1 text-sm">
              {s.name}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function History({ items }: { items: WalletTransaction[] }) {
  const { t, locale } = useI18n();
  const when = useDateTime();
  if (items.length === 0) return <p className="text-sm text-gp-muted">{t.wallet.noHistory}</p>;
  return (
    <ul className="divide-y divide-black/5 rounded-xl border border-black/10 dark:divide-white/10 dark:border-white/10">
      {items.map((x) => {
        const incoming = x.attribute === "received";
        const who =
          x.type === "admin_adjust"
            ? t.wallet.byAdmin
            : x.type === "topup"
              ? format(t.wallet.topupAt, { name: x.counterparty ?? "" })
              : x.type === "charge"
                ? // A Green Credit charge takes its limit when it starts and gives the rest back when it ends (0052).
                  format(x.hold === "held" ? t.wallet.chargeHeldAt : x.hold === "refund" ? t.wallet.chargeHeldBack : t.wallet.chargeAt, { name: x.counterparty ?? "" })
              : x.type === "trip"
                ? format(incoming ? t.wallet.tripRefund : t.wallet.tripPaid, { name: x.counterparty ?? "" })
              : format(incoming ? t.wallet.from : t.wallet.to, { name: x.counterparty ?? "?" });
        return (
          <li key={x.id} className="flex items-start gap-3 p-3 text-sm">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{who}</div>
              <div className="text-xs text-gp-muted">
                {when(x.createdAt)} · {t.wallet.types[x.type]} · {x.trxId}
                {x.status !== "success" && ` · ${x.hold === "held" && x.status === "pending" ? t.wallet.holdPending : t.wallet.status[x.status]}`}
              </div>
              {x.remark && <div className="truncate text-xs text-gp-muted">« {x.remark} »</div>}
            </div>
            <div className="text-right">
              <div className={`font-semibold ${incoming ? "text-gp-green-dark dark:text-gp-green" : ""}`}>
                {incoming ? "+" : "−"}
                {formatXof(x.totalXof, locale)}
              </div>
              {x.feeXof > 0 && <div className="text-xs text-gp-muted">{format(t.wallet.feeLine, { fee: formatXof(x.feeXof, locale) })}</div>}
              <div className="text-xs text-gp-muted">{format(t.wallet.balanceAfter, { amount: formatXof(x.balanceAfterXof, locale) })}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
