"use client";

import { useState } from "react";
import { useDateTime } from "@/components/backoffice/shared";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { formatKg, LEVEL_EMOJI, LEVELS, type GreenpointEntry, type GreenpointReward, type GreenpointView } from "@/lib/greenpoint";
import { VEHICLE_TYPES, type VehicleType } from "@/lib/types";
import { useApp } from "../app-provider";
import { SunIcon } from "../icons";
import { useI18n } from "../i18n-provider";

const button = "rounded-full bg-gp-green-dark px-4 py-2 text-sm font-medium text-white disabled:opacity-50";
const section = "space-y-2 rounded-2xl border border-gp-border bg-gp-surface p-4 dark:border-white/10";

/** "greenpoint": the green label (CO2 saved, level), greenpoints, rewards with a code for the staff, and history. */
export function GreenpointPanel() {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const { data, error, reload } = useLiveQuery(() => backend.myGreenpoint());
  const [message, setMessage] = useState<string | null>(null);

  if (error) return <p className="p-6 text-sm text-red-600">{errorMessage(error)}</p>;
  if (!data) return <p className="p-6 text-sm text-zinc-500">{t.loading}</p>;

  async function run(action: () => Promise<unknown>) {
    setMessage(null);
    try {
      await action();
      reload();
    } catch (err) {
      setMessage(errorMessage(err));
    }
  }

  return (
    <div className="mx-auto w-full max-w-md space-y-4 overflow-y-auto p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">{t.greenpoint.title}</h1>
      <p className="text-sm text-gp-muted dark:text-zinc-400">{t.greenpoint.intro}</p>
      <p className="flex items-start gap-2 rounded-2xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-400/10 dark:text-amber-200">
        <SunIcon size={18} className="mt-0.5 shrink-0" />
        {t.greenpoint.solarOnly}
      </p>
      <Label view={data} />
      {message && (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      )}
      {data.redemption && (
        <OpenCode view={data} onCancel={() => run(() => backend.cancelRedemption(data.redemption!.id))} />
      )}
      <Rewards
        rewards={data.rewards}
        points={data.points}
        busy={!!data.redemption}
        onRedeem={(id) => run(() => backend.startRedemption(id))}
      />
      <section className={section}>
        <label htmlFor="gp-vehicle" className="text-sm font-semibold">
          {t.greenpoint.vehicle}
        </label>
        <select
          id="gp-vehicle"
          value={data.vehicle}
          onChange={(e) => run(() => backend.setGreenpointVehicle(e.target.value as VehicleType))}
          className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-base dark:border-white/20 dark:bg-zinc-900"
        >
          {VEHICLE_TYPES.map((v) => (
            <option key={v} value={v}>
              {t.vehicles[v]}
            </option>
          ))}
        </select>
        <p className="text-xs text-gp-muted dark:text-zinc-400">{t.greenpoint.vehicleHint}</p>
      </section>
      <History items={data.history} />
      <p className="text-xs text-gp-muted dark:text-zinc-400">{t.greenpoint.rules}</p>
    </div>
  );
}

/** The label card: level, CO2 saved (estimate), trees, progress to the next level, points. */
function Label({ view }: { view: GreenpointView }) {
  const { t, locale } = useI18n();
  const kg = (g: number) => formatKg(g, locale);
  const levelName = t.greenpoint.levels[view.level];
  const from = LEVELS.find((l) => l.level === view.level)!.fromGrams;
  const progress = view.next ? Math.min(100, Math.round(((view.co2Grams - from) / (view.next.fromGrams - from)) * 100)) : 100;
  const shareText = format(t.greenpoint.shareText, { kg: kg(view.co2Grams), level: levelName });

  function share() {
    if (typeof navigator !== "undefined" && navigator.share) {
      navigator.share({ text: shareText }).catch(() => {});
    } else {
      window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, "_blank", "noopener");
    }
  }

  return (
    <section className="space-y-3 rounded-2xl bg-gp-forest p-5 text-white">
      <div className="flex items-center gap-3">
        <span className="text-4xl" aria-hidden>
          {LEVEL_EMOJI[view.level]}
        </span>
        <div>
          <div className="text-xs uppercase tracking-wide opacity-80">{t.greenpoint.level}</div>
          <div className="text-xl font-semibold text-gp-yellow">{levelName}</div>
        </div>
      </div>
      <div>
        <div className="text-xs uppercase tracking-wide opacity-80">
          {t.greenpoint.co2} · {t.greenpoint.estimate}
        </div>
        <div className="text-3xl font-bold">{kg(view.co2Grams)}</div>
        <div className="text-sm opacity-80">{format(t.greenpoint.trees, { n: view.trees.toLocaleString(locale === "fr" ? "fr-FR" : "en-GB") })}</div>
      </div>
      <div>
        <div className="h-2 overflow-hidden rounded-full bg-white/20" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full rounded-full bg-gp-yellow" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-1 text-xs opacity-80">
          {view.next
            ? format(t.greenpoint.nextLevel, { kg: kg(view.next.fromGrams - view.co2Grams), level: t.greenpoint.levels[view.next.level] })
            : t.greenpoint.topLevel}
        </div>
      </div>
      <div className="flex items-end justify-between gap-3 border-t border-white/15 pt-3">
        <div>
          <div className="text-2xl font-bold text-gp-yellow">{view.points.toLocaleString(locale === "fr" ? "fr-FR" : "en-GB")}</div>
          <div className="text-xs opacity-80">
            {t.greenpoint.points} · {t.greenpoint.pointsHint}
          </div>
        </div>
        <button type="button" onClick={share} className="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-gp-forest">
          {t.greenpoint.share}
        </button>
      </div>
    </section>
  );
}

function OpenCode({ view, onCancel }: { view: GreenpointView; onCancel: () => void }) {
  const { t, locale } = useI18n();
  const r = view.redemption!;
  const time = new Date(r.expiresAt).toLocaleTimeString(locale === "fr" ? "fr-FR" : "en-GB", { hour: "2-digit", minute: "2-digit" });
  return (
    <section className="space-y-2 rounded-2xl border-2 border-gp-yellow bg-gp-surface p-4 text-center">
      <div className="text-sm font-semibold">{r.rewardTitle}</div>
      <div className="text-xs text-gp-muted">{t.greenpoint.code}</div>
      <div className="font-mono text-4xl font-bold tracking-[0.3em]">{r.code}</div>
      <div className="text-xs text-gp-muted">
        {format(t.greenpoint.codeValid, { time })} · {format(t.greenpoint.cost, { n: r.costPoints })}
      </div>
      <button type="button" onClick={onCancel} className="text-sm text-gp-green-dark underline dark:text-gp-green">
        {t.greenpoint.cancel}
      </button>
    </section>
  );
}

function Rewards({
  rewards,
  points,
  busy,
  onRedeem,
}: {
  rewards: GreenpointReward[];
  points: number;
  busy: boolean;
  onRedeem: (id: string) => void;
}) {
  const { t } = useI18n();
  return (
    <section className={section}>
      <h2 className="text-sm font-semibold">{t.greenpoint.rewards}</h2>
      {rewards.length === 0 ? (
        <p className="text-sm text-gp-muted">{t.greenpoint.noRewards}</p>
      ) : (
        <ul className="divide-y divide-gp-border dark:divide-white/10">
          {rewards.map((r) => (
            <li key={r.id} className="flex items-center gap-3 py-2">
              <div className="flex-1">
                <div className="text-sm font-medium">{r.title}</div>
                {r.description && <div className="text-xs text-gp-muted dark:text-zinc-400">{r.description}</div>}
                <div className="text-xs text-gp-muted dark:text-zinc-400">
                  {format(t.greenpoint.cost, { n: r.costPoints })}
                  {r.provider === "partner" && r.partnerName ? ` · ${format(t.greenpoint.partner, { name: r.partnerName })}` : ""}
                </div>
              </div>
              <button type="button" className={button} disabled={busy || points < r.costPoints} onClick={() => onRedeem(r.id)}>
                {t.greenpoint.redeem}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function History({ items }: { items: GreenpointEntry[] }) {
  const { t, locale } = useI18n();
  const dateTime = useDateTime();
  return (
    <section className={section}>
      <h2 className="text-sm font-semibold">{t.greenpoint.history}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-gp-muted">{t.greenpoint.noHistory}</p>
      ) : (
        <ul className="divide-y divide-gp-border text-sm dark:divide-white/10">
          {items.map((e) => (
            <li key={e.id} className="flex items-center gap-3 py-2">
              <div className="flex-1">
                <div className="font-medium">{e.kind === "redeem" && e.rewardTitle ? e.rewardTitle : t.greenpoint.kinds[e.kind]}</div>
                <div className="text-xs text-gp-muted dark:text-zinc-400">
                  {[dateTime(e.createdAt), e.stationName, e.vehicle ? t.vehicles[e.vehicle] : null].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div className="text-right">
                <div className={`font-semibold ${e.points < 0 ? "text-red-700 dark:text-red-400" : "text-gp-green-dark dark:text-gp-green"}`}>
                  {e.points > 0 ? `+${e.points}` : e.points}
                </div>
                {e.co2Grams > 0 && <div className="text-xs text-gp-muted">{formatKg(e.co2Grams, locale)} CO₂</div>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
