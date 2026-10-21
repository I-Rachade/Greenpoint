"use client";

import { useState, type FormEvent } from "react";
import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import { formatKwh, type AdminCharging, type ChargeTariffInput } from "@/lib/charging";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format, formatXof } from "@/lib/i18n/format";
import { ChargeCardsManager } from "./charge-cards-manager";
import { card, field, Loading, Pill, StaleNotice, Table, td, th, useDateTime } from "./shared";

type Message = { ok: boolean; text: string } | null;

const num = (text: string): number | null => (text.trim() === "" ? null : Number(text));

/** Backoffice "Recharges": the network default price, a price per station, charging cards, and the latest charges. */
export function ChargingManager() {
  const { t, locale } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const when = useDateTime();
  const { data, error, reload } = useLiveQuery(() => backend.adminCharging());
  const [message, setMessage] = useState<Message>(null);
  if (!data) return <Loading error={error} onRetry={reload} />;
  const ch = t.charging;
  const a = ch.admin;
  const xof = (n: number) => formatXof(n, locale);

  async function save(input: ChargeTariffInput) {
    try {
      await backend.saveChargeTariff(input);
      setMessage({ ok: true, text: a.saved });
      reload();
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    }
  }

  return (
    <div className="space-y-4">
      <StaleNotice error={error} onRetry={reload} />
      <h1 className="text-xl font-semibold">{a.title}</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{a.intro}</p>
      {message && <p className={`text-sm ${message.ok ? "text-gp-green-dark dark:text-gp-green" : "text-red-600"}`}>{message.text}</p>}

      <section className={`${card} space-y-3`}>
        <h2 className="font-semibold">{a.defaultTariff}</h2>
        <TariffForm stationId={null} kwh={data.defaultTariff.kwhXof} min={data.defaultTariff.minXof} required onSave={save} />
      </section>

      <section className={`${card} space-y-3`}>
        <h2 className="font-semibold">{a.stationPrices}</h2>
        <p className="text-xs text-zinc-500">{a.stationPricesHint}</p>
        <ul className="divide-y divide-black/5 dark:divide-white/5">
          {stationsFirst(data).map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span>
                <span className="font-medium">{s.name}</span> <span className="text-xs text-zinc-500">{format(a.outlets, { n: s.outlets })}</span>
              </span>
              <TariffForm stationId={s.id} kwh={s.kwhXof} min={s.minXof} placeholder={data.defaultTariff} onSave={save} />
            </li>
          ))}
        </ul>
      </section>

      <section className={`${card} space-y-3`}>
        <h2 className="font-semibold">{a.evTitle}</h2>
        <p className="text-xs text-zinc-500">{a.evHint}</p>
        <TariffForm ev stationId={null} kwh={data.evTariff.kwhXof} min={data.evTariff.minXof} required onSave={save} />
        {data.stations.some((s) => s.evChargers > 0) && (
          <ul className="divide-y divide-black/5 dark:divide-white/5">
            {data.stations
              .filter((s) => s.evChargers > 0)
              .map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span>
                    <span className="font-medium">{s.name}</span>{" "}
                    <span className="text-xs text-zinc-500">{format(a.evChargers, { n: s.evChargers })}</span>
                  </span>
                  <TariffForm ev stationId={s.id} kwh={s.evKwhXof} min={s.evMinXof} placeholder={data.evTariff} onSave={save} />
                </li>
              ))}
          </ul>
        )}
      </section>

      <ChargeCardsManager />

      <h2 className="font-semibold">{a.sessions}</h2>
      <p className="text-sm">{format(a.totals, { amount: xof(data.totals.paidXof), energy: formatKwh(data.totals.energyWh, locale), n: data.totals.count })}</p>
      {data.sessions.length === 0 ? (
        <p className="text-sm text-zinc-500">{a.none}</p>
      ) : (
        <Table
          head={
            <>
              <th className={th}>{a.columns.when}</th>
              <th className={th}>{a.columns.station}</th>
              <th className={th}>{a.columns.customer}</th>
              <th className={th}>{a.columns.energy}</th>
              <th className={th}>{a.columns.amount}</th>
              <th className={th}>{a.columns.status}</th>
            </>
          }
        >
          {data.sessions.map((c) => (
            <tr key={c.id}>
              <td className={td}>{when(c.startedAt)}</td>
              <td className={td}>
                {c.stationName}
                <div className="text-xs text-zinc-500">{c.pointLabel}</div>
              </td>
              <td className={td}>{c.customer ?? ch.cashCustomer}</td>
              <td className={td}>{formatKwh(c.energyWh, locale)}</td>
              <td className={td}>{xof(c.amountXof)}</td>
              <td className={td}>
                {c.status === "paid" ? (
                  <Pill tone="green">{format(ch.paid, { method: ch.methods[c.paymentMethod ?? "cash"] })}</Pill>
                ) : c.status === "charging" ? (
                  <Pill tone="blue">{ch.charging}</Pill>
                ) : c.status === "stopped" ? (
                  <Pill tone="amber">{ch.priceFinal}</Pill>
                ) : (
                  <Pill tone="gray">{ch.cancelled}</Pill>
                )}
              </td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

/** Stations with sockets first, then the others. */
function stationsFirst(data: AdminCharging) {
  return [...data.stations].sort((x, y) => Number(y.outlets > 0) - Number(x.outlets > 0) || x.name.localeCompare(y.name));
}

function TariffForm({
  ev = false,
  stationId,
  kwh,
  min,
  required = false,
  placeholder,
  onSave,
}: {
  /** The car chargers' price instead of the motorbike outlets'. */
  ev?: boolean;
  stationId: string | null;
  kwh: number | null;
  min: number | null;
  required?: boolean;
  placeholder?: { kwhXof: number; minXof: number };
  onSave: (input: ChargeTariffInput) => Promise<void>;
}) {
  const { t } = useI18n();
  const a = t.charging.admin;
  const [kwhText, setKwh] = useState(kwh === null ? "" : String(kwh));
  const [minText, setMin] = useState(min === null ? "" : String(min));
  function submit(e: FormEvent) {
    e.preventDefault();
    void onSave({ ...(ev ? { ev } : {}), stationId, kwhXof: num(kwhText), minXof: num(minText) });
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <label className="space-y-1 text-xs">
        <span className="block text-zinc-500">{a.kwh}</span>
        <input
          className={`${field} w-28`}
          type="number"
          min={5}
          step={5}
          required={required}
          value={kwhText}
          placeholder={placeholder ? String(placeholder.kwhXof) : undefined}
          onChange={(e) => setKwh(e.target.value)}
        />
      </label>
      <label className="space-y-1 text-xs">
        <span className="block text-zinc-500">{a.min}</span>
        <input
          className={`${field} w-28`}
          type="number"
          min={0}
          step={5}
          required={required}
          value={minText}
          placeholder={placeholder ? String(placeholder.minXof) : undefined}
          onChange={(e) => setMin(e.target.value)}
        />
      </label>
      <button type="submit" className="rounded-full bg-gp-green-dark px-4 py-1.5 text-sm font-medium text-white">
        {a.save}
      </button>
    </form>
  );
}
