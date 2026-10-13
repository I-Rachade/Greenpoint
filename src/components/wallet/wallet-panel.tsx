"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useDateTime } from "@/components/backoffice/shared";
import { canScanQr, QrScanner } from "@/components/parcels/qr-scanner";
import { QrImage } from "@/components/parcels/qr-image";
import { BackendError } from "@/lib/backend";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format, formatXof } from "@/lib/i18n/format";
import {
  checkLimits,
  guessTopupNetwork,
  parseAmount,
  parseReceivePayload,
  quoteFee,
  remaining,
  TOPUP_MAX_XOF,
  TOPUP_MIN_XOF,
  TOPUP_NETWORK_LABEL,
  type TopupNetwork,
  type WalletTopup,
  type WalletTransaction,
  type WalletView,
} from "@/lib/wallet";
import { useApp } from "../app-provider";
import { useI18n } from "../i18n-provider";

const input = "w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-base dark:border-white/20 dark:bg-zinc-900";
const button = "rounded-full bg-gp-green-dark px-4 py-2 text-sm font-medium text-white disabled:opacity-50";

type Tab = "topup" | "send" | "receive" | "history";

/** "Portefeuille": balance, top up with Flooz/T-Money, send money with the PIN, receive by QR code, history. Same page in the web app and the mobile apps. */
export function WalletPanel() {
  const { t, locale } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const { data, error, reload } = useLiveQuery(() => backend.myWallet());
  const [tab, setTab] = useState<Tab | null>(null);
  // Back from the card provider's page: /portefeuille?topup=<id>.
  const [returnedTopup] = useState(() => (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("topup")));
  useEffect(() => {
    if (returnedTopup) window.history.replaceState(null, "", window.location.pathname);
  }, [returnedTopup]);

  if (error) {
    const disabled = error instanceof BackendError && error.code === "wallet_disabled";
    return <p className="p-6 text-sm text-zinc-600 dark:text-zinc-400">{disabled ? t.errors.wallet_disabled : errorMessage(error)}</p>;
  }
  if (!data) return <p className="p-6 text-sm text-zinc-500">{t.loading}</p>;

  // An empty wallet opens on "Recharger", so the first thing people see is how to put money in.
  const current = tab ?? (returnedTopup || data.balanceXof === 0 ? "topup" : "send");
  const tabs: { id: Tab; label: string }[] = [
    { id: "topup", label: t.wallet.topup },
    { id: "send", label: t.wallet.send },
    { id: "receive", label: t.wallet.receive },
    { id: "history", label: t.wallet.history },
  ];

  return (
    <div className="mx-auto w-full max-w-md space-y-4 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">{t.wallet.title}</h1>
      {data.testMode && <p className="rounded-lg bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">{t.wallet.testMode}</p>}
      <section className="rounded-2xl bg-gp-forest p-5 text-white">
        <div className="text-xs uppercase tracking-wide opacity-80">{t.wallet.balance}</div>
        <div className="mt-1 text-3xl font-bold">{formatXof(data.balanceXof, locale)}</div>
        {data.frozen && <div className="mt-2 text-sm font-medium text-amber-200">{t.wallet.frozen}</div>}
        {data.balanceXof === 0 && current !== "topup" && (
          <button type="button" onClick={() => setTab("topup")} className="mt-3 rounded-full bg-white px-4 py-1.5 text-sm font-medium text-gp-forest">
            {t.wallet.topup}
          </button>
        )}
      </section>
      <div role="tablist" className="flex gap-1 rounded-full bg-zinc-100 p-1 text-sm dark:bg-zinc-800">
        {tabs.map((x) => (
          <button
            key={x.id}
            type="button"
            role="tab"
            aria-selected={current === x.id}
            onClick={() => setTab(x.id)}
            className={`flex-1 rounded-full px-3 py-1.5 ${current === x.id ? "bg-white font-medium shadow dark:bg-zinc-950" : "text-zinc-600 dark:text-zinc-400"}`}
          >
            {x.label}
          </button>
        ))}
      </div>
      {current === "topup" && <TopupForm wallet={data} onDone={reload} returnedTopup={returnedTopup} />}
      {current === "send" && <SendForm wallet={data} onDone={() => setTab("history")} />}
      {current === "receive" && <Receive code={data.receiveCode} />}
      {current === "history" && <History items={data.transactions} />}
    </div>
  );
}

const TOPUP_PRESETS = [1_000, 2_000, 5_000, 10_000];
const POLL_MS = 4_000;
const POLL_MAX = 45; // three minutes, about how long a Flooz/T-Money request stays open on the phone

function TopupForm({ wallet, onDone, returnedTopup }: { wallet: WalletView; onDone: () => void; returnedTopup: string | null }) {
  const { t, locale } = useI18n();
  const { backend, profile } = useApp();
  const errorMessage = useErrorMessage();
  const [amountText, setAmountText] = useState("");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const methods: TopupNetwork[] = [...(wallet.topupAvailable ? (["tmoney", "flooz"] as const) : []), ...(wallet.cardTopupAvailable ? (["card"] as const) : [])];
  const [network, setNetwork] = useState<TopupNetwork>(wallet.topupAvailable ? guessTopupNetwork(profile?.phone) : "card");
  const [busy, setBusy] = useState(false);
  const [topup, setTopup] = useState<WalletTopup | null>(null);
  const [error, setError] = useState<string | null>(null);
  const xof = (n: number) => formatXof(n, locale);
  const amount = parseAmount(amountText);
  const card = network === "card";
  const notMultipleOf5 = card && amount !== null && amount % 5 !== 0;
  const inRange = amount !== null && amount >= TOPUP_MIN_XOF && amount <= TOPUP_MAX_XOF && !notMultipleOf5;

  // Back from the card page: show where that payment stands (and keep asking below while it is pending).
  useEffect(() => {
    if (!returnedTopup) return;
    backend.refreshTopup(returnedTopup).then(
      (next) => {
        setTopup(next);
        if (next.status === "succeeded") onDone();
      },
      () => {},
    );
  }, [backend, returnedTopup, onDone]);

  // While the person confirms on the phone, ask for the status every few seconds.
  const pendingId = topup?.status === "pending" ? topup.id : null;
  useEffect(() => {
    if (!pendingId) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      tries++;
      backend.refreshTopup(pendingId).then(
        (next) => {
          if (next.status !== "pending" || tries >= POLL_MAX) window.clearInterval(timer);
          if (next.status !== "pending") {
            setTopup(next);
            if (next.status === "succeeded") onDone();
          }
        },
        () => tries >= POLL_MAX && window.clearInterval(timer),
      );
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [backend, pendingId, onDone]);

  if (methods.length === 0) return <p className="rounded-lg border border-black/10 p-3 text-sm dark:border-white/10">{t.wallet.topupUnavailable}</p>;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!amount || !inRange) return;
    setBusy(true);
    setError(null);
    setTopup(null);
    try {
      const started = await backend.startTopup({ amountXof: amount, network, phone: card ? undefined : phone.trim() });
      setTopup(started);
      // Cards are paid on the provider's page, which sends the person back to /portefeuille?topup=<id>.
      if (started.checkoutUrl) window.location.assign(started.checkoutUrl);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function checkNow() {
    if (!topup) return;
    const next = await backend.refreshTopup(topup.id).catch(() => topup);
    setTopup(next);
    if (next.status === "succeeded") onDone();
  }

  const label = (n: TopupNetwork) => TOPUP_NETWORK_LABEL[n];
  return (
    <form onSubmit={submit} className="space-y-4">
      <h2 className="font-semibold">{t.wallet.topupTitle}</h2>
      {wallet.balanceXof === 0 && !topup && <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.wallet.emptyHint}</p>}
      <label className="block space-y-1">
        <span className="text-sm font-medium">{t.wallet.topupAmount}</span>
        <input className={input} value={amountText} onChange={(e) => setAmountText(e.target.value.replace(/[^\d\s]/g, ""))} inputMode="numeric" required />
        <span className="block text-xs text-zinc-500">{format(t.wallet.topupLimits, { min: xof(TOPUP_MIN_XOF), max: xof(TOPUP_MAX_XOF) })}</span>
        {notMultipleOf5 && <span className="block text-xs text-red-600">{t.wallet.topupMultipleOf5}</span>}
      </label>
      <div className="flex flex-wrap gap-2">
        {TOPUP_PRESETS.map((n) => (
          <button key={n} type="button" onClick={() => setAmountText(String(n))} className="rounded-full border border-black/15 px-3 py-1 text-sm dark:border-white/20">
            {xof(n)}
          </button>
        ))}
      </div>
      <fieldset className="space-y-1">
        <legend className="text-sm font-medium">{t.wallet.topupNetwork}</legend>
        <div className="flex gap-2">
          {methods.map((n) => (
            <button
              key={n}
              type="button"
              aria-pressed={network === n}
              onClick={() => setNetwork(n)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm ${network === n ? "border-gp-green-dark bg-gp-green/10 font-medium" : "border-black/15 dark:border-white/20"}`}
            >
              {label(n)}
            </button>
          ))}
        </div>
      </fieldset>
      {!wallet.topupAvailable && <p className="text-xs text-zinc-500">{t.wallet.topupUnavailable}</p>}
      {!wallet.cardTopupAvailable && <p className="text-xs text-zinc-500">{t.wallet.topupCardUnavailable}</p>}
      {card ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.wallet.topupCardHint}</p>
      ) : (
        <label className="block space-y-1">
          <span className="text-sm font-medium">{t.wallet.topupPhone}</span>
          <input
            className={input}
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              if (/^\+228\d{8}$/.test(e.target.value.replace(/\s/g, ""))) setNetwork(guessTopupNetwork(e.target.value.replace(/\s/g, "")));
            }}
            inputMode="tel"
            autoComplete="tel"
            placeholder="+228 90 00 00 00"
            required
          />
        </label>
      )}
      <button type="submit" className={`${button} w-full`} disabled={busy || !inRange || (!card && !phone.trim()) || topup?.status === "pending"}>
        {format(t.wallet.topupConfirm, { amount: amount ? xof(amount) : "" })}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {topup?.status === "pending" && (
        <div className="space-y-2 rounded-lg bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
          <p>{topup.network === "card" ? t.wallet.topupCardReturn : format(t.wallet.topupWaiting, { amount: xof(topup.amountXof), network: label(topup.network) })}</p>
          <button type="button" onClick={() => void checkNow()} className="underline">
            {t.wallet.topupCheck}
          </button>
        </div>
      )}
      {topup?.status === "succeeded" && <p className="text-sm text-gp-green-dark dark:text-gp-green">{format(t.wallet.topupDone, { amount: xof(topup.amountXof) })}</p>}
      {topup && topup.status !== "pending" && topup.status !== "succeeded" && (
        <p className="text-sm text-red-600">{format(t.wallet.topupFailed, { status: t.wallet.topupStatus[topup.status] })}</p>
      )}
    </form>
  );
}

function newKey(): string {
  return crypto.randomUUID();
}

function SendForm({ wallet, onDone }: { wallet: WalletView; onDone: () => void }) {
  const { t, locale } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const [contact, setContact] = useState("");
  const [recipient, setRecipient] = useState<string | null>(null);
  const [amountText, setAmountText] = useState("");
  const [remark, setRemark] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [scanning, setScanning] = useState(false);
  // One key per payment the person means to make: a retry after a network error reuses it.
  const [key, setKey] = useState(newKey);

  const xof = (n: number) => formatXof(n, locale);
  const s = wallet.transfer;
  const amount = parseAmount(amountText);
  const quote = amount ? quoteFee(amount, s) : null;
  const problem = amount ? checkLimits(amount, s, wallet.usage) : null;
  const left = remaining(s, wallet.usage);

  async function check(value = contact) {
    setRecipient(null);
    setMessage(null);
    if (!value.trim()) return;
    try {
      setRecipient((await backend.findWalletRecipient(value.trim())).label);
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!amount || !quote) return;
    setBusy(true);
    setMessage(null);
    try {
      const tx = await backend.sendMoney({ contact: contact.trim(), amountXof: amount, pin, idempotencyKey: key, remark: remark || null });
      setMessage({ ok: true, text: format(t.wallet.sent, { amount: xof(tx.amountXof), name: tx.counterparty ?? "", trx: tx.trxId }) });
      setContact("");
      setRecipient(null);
      setAmountText("");
      setRemark("");
      setPin("");
      setKey(newKey());
      window.setTimeout(onDone, 2500);
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
      // A refusal is final: the next attempt is a new payment. After a network error the key stays.
      if (err instanceof BackendError && err.code !== "unknown") setKey(newKey());
      setPin("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block space-y-1">
        <span className="text-sm font-medium">{t.wallet.recipient}</span>
        <div className="flex gap-2">
          <input
            className={input}
            value={contact}
            onChange={(e) => {
              setContact(e.target.value);
              setRecipient(null);
            }}
            onBlur={() => void check()}
            inputMode="email"
            autoComplete="off"
            placeholder="+228 90 00 00 00"
            required
          />
          <button type="button" onClick={() => void check()} className="whitespace-nowrap rounded-full border border-black/15 px-3 text-sm dark:border-white/20">
            {t.wallet.check}
          </button>
        </div>
        <span className="block text-xs text-zinc-500">{t.wallet.recipientHint}</span>
      </label>
      {canScanQr() && !scanning && (
        <button type="button" onClick={() => setScanning(true)} className="text-sm text-gp-green-dark underline dark:text-gp-green">
          {t.wallet.scan}
        </button>
      )}
      {scanning && (
        <QrScanner
          onClose={() => setScanning(false)}
          onResult={(text) => {
            setScanning(false);
            const scanned = parseReceivePayload(text);
            setContact(scanned);
            void check(scanned);
          }}
        />
      )}
      {recipient && <p className="rounded-lg bg-gp-green/10 p-2 text-sm">{format(t.wallet.recipientIs, { name: recipient })}</p>}

      <label className="block space-y-1">
        <span className="text-sm font-medium">{t.wallet.amount}</span>
        <input className={input} value={amountText} onChange={(e) => setAmountText(e.target.value.replace(/[^\d\s]/g, ""))} inputMode="numeric" required />
        <span className="block text-xs text-zinc-500">
          {format(t.wallet.limits, { min: xof(s.minXof), max: s.maxXof ? xof(s.maxXof) : "–" })}
          {left.todayXof !== null && ` · ${format(t.wallet.remainingToday, { amount: xof(left.todayXof) })}`}
          {left.monthXof !== null && ` · ${format(t.wallet.remainingMonth, { amount: xof(left.monthXof) })}`}
        </span>
      </label>
      {quote && (
        <dl className="grid grid-cols-2 gap-1 rounded-lg border border-black/10 p-3 text-sm dark:border-white/10">
          <dt className="text-zinc-500">{t.wallet.fee}</dt>
          <dd className="text-right">{xof(quote.feeXof)}</dd>
          <dt className="font-medium">{t.wallet.total}</dt>
          <dd className="text-right font-medium">{xof(quote.payableXof)}</dd>
        </dl>
      )}
      {problem && <p className="text-sm text-red-600">{t.errors[problem]}</p>}
      {quote && !problem && quote.payableXof > wallet.balanceXof && <p className="text-sm text-red-600">{t.errors.insufficient_balance}</p>}

      <label className="block space-y-1">
        <span className="text-sm font-medium">{t.wallet.remark}</span>
        <input className={input} value={remark} onChange={(e) => setRemark(e.target.value)} maxLength={120} />
      </label>
      <label className="block space-y-1">
        <span className="text-sm font-medium">{t.wallet.pin}</span>
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
      <button
        type="submit"
        className={`${button} w-full`}
        disabled={busy || !quote || !!problem || wallet.frozen || pin.length !== 4 || quote.payableXof > wallet.balanceXof}
      >
        {format(t.wallet.confirm, { amount: amount ? xof(amount) : "" })}
      </button>
      {message && <p className={`text-sm ${message.ok ? "text-gp-green-dark dark:text-gp-green" : "text-red-600"}`}>{message.text}</p>}
    </form>
  );
}

function Receive({ code }: { code: string | null }) {
  const { t } = useI18n();
  if (!code) return null;
  const contact = parseReceivePayload(code);
  return (
    <section className="flex flex-col items-center gap-3 rounded-xl border border-black/10 p-4 text-center dark:border-white/10">
      <QrImage text={code} label={t.wallet.receive} size={220} />
      <div>
        <div className="text-xs uppercase tracking-wide text-zinc-500">{t.wallet.yourContact}</div>
        <div className="font-mono text-lg font-semibold">{contact}</div>
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.wallet.receiveText}</p>
    </section>
  );
}

function History({ items }: { items: WalletTransaction[] }) {
  const { t, locale } = useI18n();
  const when = useDateTime();
  if (items.length === 0) return <p className="text-sm text-zinc-500">{t.wallet.noHistory}</p>;
  return (
    <ul className="divide-y divide-black/5 rounded-xl border border-black/10 dark:divide-white/10 dark:border-white/10">
      {items.map((x) => {
        const incoming = x.attribute === "received";
        const who =
          x.type === "admin_adjust"
            ? t.wallet.byAdmin
            : x.type === "topup"
              ? format(t.wallet.viaNetwork, { name: x.counterparty ?? "" })
              : format(incoming ? t.wallet.from : t.wallet.to, { name: x.counterparty ?? "?" });
        return (
          <li key={x.id} className="flex items-start gap-3 p-3 text-sm">
            <div className="min-w-0 flex-1">
              <div className="font-medium">{who}</div>
              <div className="text-xs text-zinc-500">
                {when(x.createdAt)} · {t.wallet.types[x.type]} · {x.trxId}
                {x.status !== "success" && ` · ${t.wallet.status[x.status]}`}
              </div>
              {x.remark && <div className="truncate text-xs text-zinc-600 dark:text-zinc-400">« {x.remark} »</div>}
            </div>
            <div className="text-right">
              <div className={`font-semibold ${incoming ? "text-gp-green-dark dark:text-gp-green" : ""}`}>
                {incoming ? "+" : "−"}
                {formatXof(x.totalXof, locale)}
              </div>
              {x.feeXof > 0 && <div className="text-xs text-zinc-500">{format(t.wallet.feeLine, { fee: formatXof(x.feeXof, locale) })}</div>}
              <div className="text-xs text-zinc-500">{format(t.wallet.balanceAfter, { amount: formatXof(x.balanceAfterXof, locale) })}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
