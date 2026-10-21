"use client";

import { useState, type FormEvent } from "react";
import { useApp } from "@/components/app-provider";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { useI18n } from "@/components/i18n-provider";
import { parseContact } from "@/lib/contact";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format, formatXof } from "@/lib/i18n/format";
import { parseAmount, type AdminWallet, type WalletAdjustInput } from "@/lib/wallet";
import { card, field, Loading, Pill, StaleNotice, Table, td, th, useAdminSnapshot, useDateTime, userLabel } from "./shared";

type Message = { ok: boolean; text: string } | null;

/** Backoffice "Green Credit": module switch, totals, balance limit, Green Credit stations, corrections and cash refunds, and the ledger. */
export function WalletManager() {
  const { t, locale } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const when = useDateTime();
  const [type, setType] = useState("");
  const { data, error, reload } = useLiveQuery(() => backend.adminWallet({ type: type || undefined }), type);
  const [message, setMessage] = useState<Message>(null);
  if (!data) return <Loading error={error} onRetry={reload} />;

  const b = t.backoffice.wallet;
  const xof = (n: number) => formatXof(n, locale);

  async function run<T>(action: () => Promise<T>, success: string | ((result: T) => string)) {
    try {
      const result = await action();
      setMessage({ ok: true, text: typeof success === "string" ? success : success(result) });
      reload();
      return true;
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
      return false;
    }
  }

  return (
    <div className="space-y-4">
      <StaleNotice error={error} onRetry={reload} />
      <div>
        <h1 className="text-xl font-semibold">{b.title}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{b.intro}</p>
      </div>
      {message && <p className={`text-sm ${message.ok ? "text-gp-green-dark dark:text-gp-green" : "text-red-600"}`}>{message.text}</p>}

      <div className="grid gap-3 sm:grid-cols-4">
        <section className={card}>
          <div className="text-xs uppercase tracking-wide text-zinc-500">{b.module}</div>
          <div className="mt-1">
            <Pill tone={data.enabled ? "green" : "amber"}>{data.enabled ? b.enabled : b.disabled}</Pill>
          </div>
          <button
            type="button"
            className="mt-2 text-sm text-gp-green-dark underline dark:text-gp-green"
            onClick={() => {
              if (!data.enabled && !window.confirm(b.enableWarning)) return;
              void run(() => backend.setWalletEnabled(!data.enabled), b.saved);
            }}
          >
            {data.enabled ? b.disable : b.enable}
          </button>
        </section>
        <Kpi label={b.balances} value={xof(data.totals.balancesXof)} detail={format(b.wallets, { n: data.totals.wallets })} />
        <Kpi label={b.toppedUp} value={xof(data.totals.toppedUpXof)} />
        <Kpi label={b.transactions} value={String(data.totals.transactions)} />
      </div>
      {!data.enabled && <p className="text-sm text-amber-700 dark:text-amber-300">{b.enableWarning}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <MaxForm key={data.maxXof} maxXof={data.maxXof} onSave={(next) => run(() => backend.setCreditMax(next), b.saved)} />
          <StationsForm stations={data.stations} onToggle={(id, on) => run(() => backend.setStationGreenCredit(id, on), b.saved)} />
        </div>
        <AdjustForm
          onAdjust={(input) => run(() => backend.adjustWallet(input), (tx) => format(b.adjusted, { amount: xof(tx.balanceAfterXof) }))}
          onFreeze={(contact, frozen) => run(() => backend.setWalletFrozen(contact, frozen), frozen ? b.frozenDone : b.unfrozenDone)}
        />
      </div>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold">{b.ledger}</h2>
          <select className={field} value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">{b.all}</option>
            <option value="transfer">{t.wallet.types.transfer}</option>
            <option value="admin_adjust">{t.wallet.types.admin_adjust}</option>
            <option value="topup">{t.wallet.types.topup}</option>
            <option value="charge">{t.wallet.types.charge}</option>
          </select>
        </div>
        {data.transactions.length === 0 ? (
          <p className="text-sm text-zinc-500">{b.empty}</p>
        ) : (
          <Table
            head={
              <>
                <th className={th}>{b.cols.date}</th>
                <th className={th}>{b.cols.trx}</th>
                <th className={th}>{b.cols.client}</th>
                <th className={th}>{b.cols.type}</th>
                <th className={th}>{b.cols.side}</th>
                <th className={`${th} text-right`}>{b.cols.amount}</th>
                <th className={`${th} text-right`}>{b.cols.fee}</th>
                <th className={`${th} text-right`}>{b.cols.balance}</th>
                <th className={th}>{b.cols.note}</th>
              </>
            }
          >
            {data.transactions.map((x) => (
              <tr key={x.id}>
                <td className={`${td} whitespace-nowrap`}>{when(x.createdAt)}</td>
                <td className={`${td} font-mono`}>{x.trxId}</td>
                <td className={td}>{x.userLabel ?? <span className="text-zinc-500">{b.deleted}</span>}</td>
                <td className={td}>
                  {t.wallet.types[x.type]}
                  {x.counterparty && <div className="text-xs text-zinc-500">{x.counterparty}</div>}
                </td>
                <td className={td}>
                  <Pill tone={x.attribute === "received" ? "green" : "gray"}>{b.sides[x.attribute]}</Pill>
                </td>
                <td className={`${td} text-right`}>{xof(x.totalXof)}</td>
                <td className={`${td} text-right`}>{x.feeXof ? xof(x.feeXof) : ""}</td>
                <td className={`${td} text-right`}>{xof(x.balanceAfterXof)}</td>
                <td className={`${td} max-w-[14rem] truncate`}>{x.remark}</td>
              </tr>
            ))}
          </Table>
        )}
      </section>
    </div>
  );
}

function Kpi({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <section className={card}>
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {detail && <div className="text-xs text-zinc-500">{detail}</div>}
    </section>
  );
}

function MaxForm({ maxXof, onSave }: { maxXof: number; onSave: (maxXof: number) => Promise<boolean> }) {
  const { t } = useI18n();
  const b = t.backoffice.wallet;
  const [value, setValue] = useState(String(maxXof));
  return (
    <form
      className={`${card} space-y-3`}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void onSave(Math.max(0, Math.floor(Number(value) || 0)));
      }}
    >
      <h2 className="font-semibold">{b.maxTitle}</h2>
      <label className="block space-y-1 text-sm">
        <span className="block text-zinc-600 dark:text-zinc-400">{b.maxLabel}</span>
        <input className={`${field} w-full`} type="number" min={0} step={1} value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <p className="text-xs text-zinc-500">{b.zeroUnlimited}</p>
      <button type="submit" className="rounded-full bg-gp-forest px-4 py-1.5 text-sm text-white">
        {b.save}
      </button>
    </form>
  );
}

/** Which stations load and accept Green Credit (stations.green_credit). */
function StationsForm({ stations, onToggle }: { stations: AdminWallet["stations"]; onToggle: (id: string, on: boolean) => Promise<boolean> }) {
  const { t } = useI18n();
  const b = t.backoffice.wallet;
  const [busy, setBusy] = useState<string | null>(null);
  return (
    <section className={`${card} space-y-3`}>
      <h2 className="font-semibold">{b.stationsTitle}</h2>
      <p className="text-xs text-zinc-500">{b.stationsHint}</p>
      {stations.length === 0 ? (
        <p className="text-sm text-zinc-500">{b.noStations}</p>
      ) : (
        <ul className="divide-y divide-black/5 dark:divide-white/10">
          {stations.map((x) => (
            <li key={x.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0 truncate">{x.name}</span>
              <label className="flex shrink-0 items-center gap-2">
                <Pill tone={x.greenCredit ? "green" : "gray"}>{x.greenCredit ? b.stationOn : b.stationOff}</Pill>
                <input
                  type="checkbox"
                  aria-label={x.name}
                  checked={x.greenCredit}
                  disabled={busy === x.id}
                  onChange={(e) => {
                    setBusy(x.id);
                    void onToggle(x.id, e.target.checked).finally(() => setBusy(null));
                  }}
                />
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

type Pending = { kind: "adjust"; input: WalletAdjustInput } | { kind: "freeze"; contact: string; frozen: boolean };

function AdjustForm({
  onAdjust,
  onFreeze,
}: {
  onAdjust: (input: WalletAdjustInput) => Promise<boolean>;
  onFreeze: (contact: string, frozen: boolean) => Promise<boolean>;
}) {
  const { t, locale } = useI18n();
  const { backend } = useApp();
  const { data: snap } = useAdminSnapshot();
  const b = t.backoffice.wallet;
  const xof = (n: number) => formatXof(n, locale);
  const [contact, setContact] = useState("");
  const [direction, setDirection] = useState<WalletAdjustInput["direction"]>("add");
  const [amount, setAmount] = useState("");
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);
  // Money and blocking are asked first, with the account, the amount and the balance it leads to.
  const [pending, setPending] = useState<Pending | null>(null);
  // undefined: loading; null: no transaction on record, so the balance is not known here.
  const [balance, setBalance] = useState<number | null | undefined>(undefined);
  const valid = !!contact.trim() && parseAmount(amount) !== null && !!remark.trim();

  function findUser(text: string) {
    const c = parseContact(text);
    return c ? snap?.users.find((u) => (c.kind === "phone" ? u.phone === c.value : u.email?.toLowerCase() === c.value)) : undefined;
  }
  const pendingContact = pending ? (pending.kind === "adjust" ? pending.input.contact : pending.contact) : "";
  const account = pending ? userLabel(findUser(pendingContact), pendingContact) : "";

  async function ask(next: Pending) {
    setPending(next);
    if (next.kind !== "adjust") return;
    setBalance(undefined);
    const user = findUser(next.input.contact);
    if (!user) return setBalance(null);
    try {
      // The latest successful booking of this account carries its balance after it.
      const history = await backend.adminWallet({ userId: user.id });
      setBalance(history.transactions.find((tx) => tx.status === "success")?.balanceAfterXof ?? null);
    } catch {
      setBalance(null);
    }
  }

  async function confirm() {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.kind === "adjust") {
        if (await onAdjust(pending.input)) {
          setAmount("");
          setRemark("");
        }
      } else {
        await onFreeze(pending.contact, pending.frozen);
      }
    } finally {
      setBusy(false);
      setPending(null);
    }
  }

  const adjust = pending?.kind === "adjust" ? pending.input : null;
  const after = adjust && typeof balance === "number" ? balance + (adjust.direction === "add" ? adjust.amountXof : -adjust.amountXof) : null;
  const confirmTitle = { add: b.confirmCredit, subtract: b.confirmDebit, refund: b.confirmRefund };
  const directionLabel = { add: b.add, subtract: b.subtract, refund: b.refund };

  return (
    <form
      className={`${card} space-y-3`}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        if (busy) return;
        void ask({ kind: "adjust", input: { contact: contact.trim(), direction, amountXof: parseAmount(amount) ?? 0, remark: remark.trim() } });
      }}
    >
      <h2 className="font-semibold">{b.adjustTitle}</h2>
      <label className="block space-y-1 text-sm">
        <span className="block text-zinc-600 dark:text-zinc-400">{b.contact}</span>
        <input className={`${field} w-full`} value={contact} onChange={(e) => setContact(e.target.value)} required />
      </label>
      <div className="flex flex-wrap gap-4 text-sm">
        {(["add", "subtract", "refund"] as const).map((d) => (
          <label key={d} className="flex items-center gap-1">
            <input type="radio" name="direction" checked={direction === d} onChange={() => setDirection(d)} />
            {directionLabel[d]}
          </label>
        ))}
      </div>
      {direction === "refund" && <p className="text-xs text-zinc-500">{b.refundHint}</p>}
      <label className="block space-y-1 text-sm">
        <span className="block text-zinc-600 dark:text-zinc-400">{b.amount}</span>
        <input className={`${field} w-full`} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" required />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="block text-zinc-600 dark:text-zinc-400">{b.reason}</span>
        <input className={`${field} w-full`} value={remark} onChange={(e) => setRemark(e.target.value)} maxLength={120} required />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={!valid || busy} className="min-h-11 rounded-full bg-gp-forest px-4 text-sm text-white disabled:opacity-50">
          {b.adjust}
        </button>
        {([true, false] as const).map((frozen) => (
          <button
            key={String(frozen)}
            type="button"
            disabled={!contact.trim() || busy}
            onClick={() => void ask({ kind: "freeze", contact: contact.trim(), frozen })}
            className="min-h-11 rounded-full border border-black/15 px-3 text-sm disabled:opacity-50 dark:border-white/20"
          >
            {frozen ? b.freeze : b.unfreeze}
          </button>
        ))}
      </div>
      <ConfirmSheet
        open={!!pending}
        title={
          adjust
            ? format(confirmTitle[adjust.direction], { amount: xof(adjust.amountXof) })
            : format(pending?.kind === "freeze" && pending.frozen ? b.confirmFreeze : b.confirmUnfreeze, { account })
        }
        confirmLabel={adjust ? b.adjust : pending?.kind === "freeze" && pending.frozen ? b.freeze : b.unfreeze}
        danger={adjust ? adjust.direction !== "add" : pending?.kind === "freeze" && pending.frozen}
        busy={busy}
        onConfirm={() => void confirm()}
        onCancel={() => setPending(null)}
      >
        {adjust ? (
          <>
            <p className="font-medium">{format(b.confirmAccount, { account })}</p>
            <p>{format(b.confirmReason, { reason: adjust.remark })}</p>
            <p className="tabular-nums">
              {balance === undefined
                ? b.confirmBalanceLoading
                : balance === null || after === null
                  ? b.confirmBalanceUnknown
                  : format(b.confirmBalance, { before: xof(balance), after: xof(after) })}
            </p>
          </>
        ) : (
          pending?.kind === "freeze" && <p>{pending.frozen ? b.confirmFreezeBody : b.confirmUnfreezeBody}</p>
        )}
      </ConfirmSheet>
    </form>
  );
}
