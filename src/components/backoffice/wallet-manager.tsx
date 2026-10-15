"use client";

import { useState, type FormEvent } from "react";
import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format, formatXof } from "@/lib/i18n/format";
import { parseAmount, type WalletAdjustInput, type WalletFeeSetting } from "@/lib/wallet";
import { card, field, Loading, Pill, Table, td, th, useDateTime } from "./shared";

type Message = { ok: boolean; text: string } | null;

/** Backoffice "Portefeuille": module switch, totals, fees and limits, balance corrections and the ledger. */
export function WalletManager() {
  const { t, locale } = useI18n();
  const { backend, features } = useApp();
  const errorMessage = useErrorMessage();
  const when = useDateTime();
  const [type, setType] = useState("");
  const { data, error, reload } = useLiveQuery(() => backend.adminWallet({ type: type || undefined }), type);
  const [message, setMessage] = useState<Message>(null);
  if (!data) return <Loading error={error} />;

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
      <div>
        <h1 className="text-xl font-semibold">{b.title}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{b.intro}</p>
        {features.lite && <p className="text-sm text-amber-700 dark:text-amber-300">{t.backoffice.lite.moduleHidden}</p>}
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
        <Kpi label={b.fees} value={xof(data.totals.feesXof)} />
        <Kpi label={b.transactions} value={String(data.totals.transactions)} />
      </div>
      {!data.enabled && <p className="text-sm text-amber-700 dark:text-amber-300">{b.enableWarning}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        {data.settings.map((s) => (
          <FeeForm key={`${s.product}-${JSON.stringify(s)}`} setting={s} onSave={(next) => run(() => backend.saveWalletFees(next), b.saved)} />
        ))}
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

function FeeForm({ setting, onSave }: { setting: WalletFeeSetting; onSave: (s: WalletFeeSetting) => Promise<boolean> }) {
  const { t } = useI18n();
  const b = t.backoffice.wallet;
  const [s, setS] = useState(setting);
  const ints: { key: "fixedXof" | "minXof" | "maxXof" | "dailyXof" | "monthlyXof"; label: string }[] = [
    { key: "fixedXof", label: b.fixed },
    { key: "minXof", label: b.min },
    { key: "maxXof", label: b.max },
    { key: "dailyXof", label: b.daily },
    { key: "monthlyXof", label: b.monthly },
  ];
  return (
    <form
      className={`${card} space-y-3`}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void onSave(s);
      }}
    >
      <h2 className="font-semibold">
        {b.feesTitle} · {b.products[s.product]}
      </h2>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <label className="space-y-1">
          <span className="block text-zinc-600 dark:text-zinc-400">{b.percent}</span>
          <input
            className={`${field} w-full`}
            type="number"
            min={0}
            max={50}
            step={0.01}
            value={s.percent}
            onChange={(e) => setS({ ...s, percent: Number(e.target.value) })}
          />
        </label>
        {ints.map(({ key, label }) => (
          <label key={key} className="space-y-1">
            <span className="block text-zinc-600 dark:text-zinc-400">{label}</span>
            <input
              className={`${field} w-full`}
              type="number"
              min={0}
              step={1}
              value={s[key]}
              onChange={(e) => setS({ ...s, [key]: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
            />
          </label>
        ))}
      </div>
      <p className="text-xs text-zinc-500">{b.zeroUnlimited}</p>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={s.isActive} onChange={(e) => setS({ ...s, isActive: e.target.checked })} />
        {b.active}
      </label>
      <button type="submit" className="rounded-full bg-gp-forest px-4 py-1.5 text-sm text-white">
        {b.save}
      </button>
    </form>
  );
}

function AdjustForm({
  onAdjust,
  onFreeze,
}: {
  onAdjust: (input: WalletAdjustInput) => Promise<boolean>;
  onFreeze: (contact: string, frozen: boolean) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const b = t.backoffice.wallet;
  const [contact, setContact] = useState("");
  const [direction, setDirection] = useState<"add" | "subtract">("add");
  const [amount, setAmount] = useState("");
  const [remark, setRemark] = useState("");
  const valid = !!contact.trim() && parseAmount(amount) !== null && !!remark.trim();
  return (
    <form
      className={`${card} space-y-3`}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        void onAdjust({ contact: contact.trim(), direction, amountXof: parseAmount(amount) ?? 0, remark: remark.trim() }).then((ok) => {
          if (!ok) return;
          setAmount("");
          setRemark("");
        });
      }}
    >
      <h2 className="font-semibold">{b.adjustTitle}</h2>
      <label className="block space-y-1 text-sm">
        <span className="block text-zinc-600 dark:text-zinc-400">{b.contact}</span>
        <input className={`${field} w-full`} value={contact} onChange={(e) => setContact(e.target.value)} required />
      </label>
      <div className="flex gap-4 text-sm">
        {(["add", "subtract"] as const).map((d) => (
          <label key={d} className="flex items-center gap-1">
            <input type="radio" name="direction" checked={direction === d} onChange={() => setDirection(d)} />
            {d === "add" ? b.add : b.subtract}
          </label>
        ))}
      </div>
      <label className="block space-y-1 text-sm">
        <span className="block text-zinc-600 dark:text-zinc-400">{b.amount}</span>
        <input className={`${field} w-full`} value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" required />
      </label>
      <label className="block space-y-1 text-sm">
        <span className="block text-zinc-600 dark:text-zinc-400">{b.reason}</span>
        <input className={`${field} w-full`} value={remark} onChange={(e) => setRemark(e.target.value)} maxLength={120} required />
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={!valid} className="rounded-full bg-gp-forest px-4 py-1.5 text-sm text-white disabled:opacity-50">
          {b.adjust}
        </button>
        <button type="button" disabled={!contact.trim()} onClick={() => void onFreeze(contact.trim(), true)} className="rounded-full border border-black/15 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-white/20">
          {b.freeze}
        </button>
        <button type="button" disabled={!contact.trim()} onClick={() => void onFreeze(contact.trim(), false)} className="rounded-full border border-black/15 px-3 py-1.5 text-sm disabled:opacity-50 dark:border-white/20">
          {b.unfreeze}
        </button>
      </div>
    </form>
  );
}
