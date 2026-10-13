"use client";

import { useState, type FormEvent } from "react";
import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import { formatKg, type GreenpointFactors, type GreenpointReward, type GreenpointRewardInput } from "@/lib/greenpoint";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { VEHICLE_TYPES } from "@/lib/types";
import { card, field, Loading, Pill, Table, td, th, useDateTime } from "./shared";

type Message = { ok: boolean; text: string } | null;

const EMPTY_REWARD: GreenpointRewardInput = {
  title: "",
  description: "",
  costPoints: 100,
  provider: "network",
  partnerName: null,
  stock: null,
  validUntil: null,
  isActive: true,
};

/** Backoffice "greenpoint": totals, CO2 factors, rewards (network and partners) and the latest movements. */
export function GreenpointManager() {
  const { t, locale } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const when = useDateTime();
  const { data, error, reload } = useLiveQuery(() => backend.adminGreenpoint());
  const [message, setMessage] = useState<Message>(null);
  const [editing, setEditing] = useState<{ id: string | null; input: GreenpointRewardInput } | null>(null);
  if (!data) return <Loading error={error} />;

  const g = t.greenpoint.admin;
  const n = (x: number) => x.toLocaleString(locale === "fr" ? "fr-FR" : "en-GB");

  async function run(action: () => Promise<void>) {
    try {
      await action();
      setMessage({ ok: true, text: g.saved });
      reload();
      return true;
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
      return false;
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{g.title}</h1>
      {message && <p className={`text-sm ${message.ok ? "text-gp-green-dark dark:text-gp-green" : "text-red-600"}`}>{message.text}</p>}

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          [g.totals.co2, formatKg(data.totals.co2Grams, locale)],
          [g.totals.earned, n(data.totals.pointsEarned)],
          [g.totals.redeemed, n(data.totals.pointsRedeemed)],
          [g.totals.members, n(data.totals.members)],
        ].map(([label, value]) => (
          <section key={label} className={card}>
            <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
            <div className="mt-1 text-2xl font-semibold">{value}</div>
          </section>
        ))}
      </div>

      <Factors factors={data.factors} onSave={(f) => run(() => backend.saveGreenpointFactors(f))} />

      <section className={`${card} space-y-3`}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">{g.rewards}</h2>
          <button type="button" className="text-sm text-gp-green-dark underline dark:text-gp-green" onClick={() => setEditing({ id: null, input: EMPTY_REWARD })}>
            {g.newReward}
          </button>
        </div>
        {editing && (
          <RewardForm
            initial={editing.input}
            onCancel={() => setEditing(null)}
            onSave={async (input) => {
              if (await run(() => backend.saveGreenpointReward(editing.id, input))) setEditing(null);
            }}
          />
        )}
        <ul className="divide-y divide-black/5 text-sm dark:divide-white/5">
          {data.rewards.map((r) => (
            <RewardRow key={r.id} reward={r} onEdit={() => setEditing({ id: r.id, input: withoutId(r) })} />
          ))}
        </ul>
      </section>

      <h2 className="font-semibold">{g.recent}</h2>
      <Table
        head={
          <>
            <th className={th}>{t.backoffice.nav.activity}</th>
            <th className={th}>{t.greenpoint.co2}</th>
            <th className={th}>{t.greenpoint.points}</th>
          </>
        }
      >
        {data.recent.map((e) => (
          <tr key={e.id}>
            <td className={td}>
              <div className="font-medium">
                {e.person} · {e.kind === "redeem" && e.rewardTitle ? e.rewardTitle : t.greenpoint.kinds[e.kind]}
              </div>
              <div className="text-xs text-zinc-500">{[when(e.createdAt), e.stationName, e.vehicle ? t.vehicles[e.vehicle] : null].filter(Boolean).join(" · ")}</div>
            </td>
            <td className={td}>{e.co2Grams ? formatKg(e.co2Grams, locale) : ""}</td>
            <td className={td}>{e.points > 0 ? `+${e.points}` : e.points}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function withoutId(r: GreenpointReward): GreenpointRewardInput {
  const { id: _id, ...input } = r;
  void _id;
  return input;
}

function Factors({ factors, onSave }: { factors: GreenpointFactors; onSave: (f: GreenpointFactors) => Promise<boolean> }) {
  const { t } = useI18n();
  const g = t.greenpoint.admin;
  const [draft, setDraft] = useState(factors);
  const num = (v: string) => Math.max(0, Math.floor(Number(v) || 0));
  return (
    <form
      className={`${card} space-y-3`}
      onSubmit={(e) => {
        e.preventDefault();
        void onSave(draft);
      }}
    >
      <h2 className="font-semibold">{g.factors}</h2>
      <p className="text-xs text-zinc-500">{g.factorsHint}</p>
      <div className="grid gap-2 sm:grid-cols-5">
        {VEHICLE_TYPES.map((v) => (
          <label key={v} className="space-y-1 text-sm">
            <span className="block">{t.vehicles[v]}</span>
            <input
              type="number"
              min={0}
              value={draft.batteryGrams[v]}
              onChange={(e) => setDraft({ ...draft, batteryGrams: { ...draft.batteryGrams, [v]: num(e.target.value) } })}
              className={`${field} w-full`}
            />
            <span className="block text-xs text-zinc-500">{g.perBattery}</span>
          </label>
        ))}
        <label className="space-y-1 text-sm">
          <span className="block">kWh</span>
          <input type="number" min={0} value={draft.kwhGrams} onChange={(e) => setDraft({ ...draft, kwhGrams: num(e.target.value) })} className={`${field} w-full`} />
          <span className="block text-xs text-zinc-500">{g.perKwh}</span>
        </label>
      </div>
      <button type="submit" className="rounded-full bg-gp-green-dark px-4 py-1.5 text-sm font-medium text-white">
        {g.save}
      </button>
    </form>
  );
}

function RewardRow({ reward: r, onEdit }: { reward: GreenpointReward; onEdit: () => void }) {
  const { t } = useI18n();
  const g = t.greenpoint.admin;
  return (
    <li className="flex flex-wrap items-center gap-3 py-2">
      <div className="flex-1">
        <div className="font-medium">
          {r.title} <Pill tone={r.isActive ? "green" : "gray"}>{r.isActive ? g.active : "–"}</Pill>
        </div>
        <div className="text-xs text-zinc-500">
          {[
            `${r.costPoints} greenpoints`,
            r.provider === "partner" ? `${g.partner}: ${r.partnerName}` : g.network,
            r.stock === null ? null : `${g.stock.split(" (")[0]}: ${r.stock}`,
            r.validUntil ? `${g.validUntil} ${r.validUntil.slice(0, 10)}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </div>
      </div>
      <button type="button" onClick={onEdit} className="text-sm text-gp-green-dark underline dark:text-gp-green">
        {g.edit}
      </button>
    </li>
  );
}

function RewardForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: GreenpointRewardInput;
  onSave: (input: GreenpointRewardInput) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const g = t.greenpoint.admin;
  const [r, setR] = useState(initial);
  function submit(e: FormEvent) {
    e.preventDefault();
    void onSave(r);
  }
  return (
    <form onSubmit={submit} className="grid gap-2 rounded-lg bg-zinc-50 p-3 text-sm sm:grid-cols-2 dark:bg-zinc-800">
      <label className="space-y-1">
        <span className="block">{g.rewardTitle}</span>
        <input required maxLength={80} value={r.title} onChange={(e) => setR({ ...r, title: e.target.value })} className={`${field} w-full`} />
      </label>
      <label className="space-y-1">
        <span className="block">{g.rewardCost}</span>
        <input
          required
          type="number"
          min={1}
          value={r.costPoints}
          onChange={(e) => setR({ ...r, costPoints: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
          className={`${field} w-full`}
        />
      </label>
      <label className="space-y-1 sm:col-span-2">
        <span className="block">{g.rewardDescription}</span>
        <input maxLength={240} value={r.description} onChange={(e) => setR({ ...r, description: e.target.value })} className={`${field} w-full`} />
      </label>
      <label className="space-y-1">
        <span className="block">{g.provider}</span>
        <select value={r.provider} onChange={(e) => setR({ ...r, provider: e.target.value as "network" | "partner" })} className={`${field} w-full`}>
          <option value="network">{g.network}</option>
          <option value="partner">{g.partner}</option>
        </select>
      </label>
      {r.provider === "partner" && (
        <label className="space-y-1">
          <span className="block">{g.partnerName}</span>
          <input required maxLength={80} value={r.partnerName ?? ""} onChange={(e) => setR({ ...r, partnerName: e.target.value })} className={`${field} w-full`} />
        </label>
      )}
      <label className="space-y-1">
        <span className="block">{g.stock}</span>
        <input
          type="number"
          min={0}
          value={r.stock ?? ""}
          onChange={(e) => setR({ ...r, stock: e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value))) })}
          className={`${field} w-full`}
        />
      </label>
      <label className="space-y-1">
        <span className="block">{g.validUntil}</span>
        <input
          type="date"
          value={r.validUntil?.slice(0, 10) ?? ""}
          onChange={(e) => setR({ ...r, validUntil: e.target.value ? `${e.target.value}T23:59:59.000Z` : null })}
          className={`${field} w-full`}
        />
      </label>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={r.isActive} onChange={(e) => setR({ ...r, isActive: e.target.checked })} />
        {g.active}
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className="rounded-full bg-gp-green-dark px-4 py-1.5 font-medium text-white">
          {g.save}
        </button>
        <button type="button" onClick={onCancel} className="rounded-full px-4 py-1.5 text-zinc-600 dark:text-zinc-300">
          {t.greenpoint.cancel}
        </button>
      </div>
    </form>
  );
}
