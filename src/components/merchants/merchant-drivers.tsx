"use client";

import { useId, useState, type FormEvent } from "react";
import { useErrorMessage } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import {
  cleanRate,
  MAX_HOURLY_RATE_FCFA,
  MERCHANT_PAY_MODES,
  type MerchantCheckin,
  type MerchantDriver,
  type MerchantDriverKind,
  type MerchantDriverStatus,
  type MerchantPayMode,
  type MerchantView,
} from "@shared/merchants";
import { useApp } from "../app-provider";
import { ConfirmSheet } from "../confirm-sheet";
import { Notice, useFcfa } from "../drivers/shared";
import { useI18n } from "../i18n-provider";
import { Badge, Button, useToast, type BadgeTone } from "../ui";
import { Block, field, useAction, useClock, useDuration, useLongDate } from "./shared";

const STATUS_TONE: Record<MerchantDriverStatus, BadgeTone> = { pending: "amber", active: "green", declined: "neutral", ended: "neutral" };

/** "Par course" or "1 500 FCFA / heure". */
function usePay() {
  const { t } = useI18n();
  const fcfa = useFcfa();
  return (mode: MerchantPayMode | null, rate: number | null) =>
    mode === "hourly" && rate ? format(t.merchant.drivers.hourlyValue, { rate: fcfa(rate) }) : mode ? t.merchant.drivers.pay[mode] : "";
}

/** Pay option and hourly rate, for a new assignment or a change. */
function PayFields({ mode, rate, onMode, onRate }: { mode: MerchantPayMode; rate: string; onMode: (m: MerchantPayMode) => void; onRate: (r: string) => void }) {
  const { t } = useI18n();
  const d = t.merchant.drivers;
  const name = useId();
  return (
    <div className="space-y-3">
      <fieldset className="space-y-1 text-sm">
        <legend className="font-medium">{d.payMode}</legend>
        <div className="flex flex-wrap gap-4">
          {MERCHANT_PAY_MODES.map((p) => (
            <label key={p} className="flex min-h-11 items-center gap-2">
              <input type="radio" name={name} className="h-4 w-4 accent-gp-green-dark" checked={mode === p} onChange={() => onMode(p)} />
              {d.pay[p]}
            </label>
          ))}
        </div>
        <p className="text-xs text-gp-muted">{d.payHint[mode]}</p>
      </fieldset>
      {mode === "hourly" && (
        <label className="block space-y-1 text-sm">
          <span>{d.rate}</span>
          <input className={field} type="number" inputMode="numeric" min={1} max={MAX_HOURLY_RATE_FCFA} step={1} value={rate} onChange={(e) => onRate(e.target.value)} required />
        </label>
      )}
    </div>
  );
}

/** Drivers: favorites and assigned drivers, adding by code or phone, pay changes, ending, open hourly amounts. */
export function MerchantDrivers({ view }: { view: MerchantView }) {
  const { t } = useI18n();
  const d = t.merchant.drivers;
  const favorites = view.drivers.filter((x) => x.kind === "favorite");
  const assigned = view.drivers.filter((x) => x.kind === "assigned");
  return (
    <div className="space-y-4">
      <p className="text-sm text-gp-muted">{d.intro}</p>
      <AddDriver />
      <Block title={d.assigned}>
        {assigned.length === 0 ? (
          <p className="text-sm text-gp-muted">{d.noAssigned}</p>
        ) : (
          <ul className="space-y-2">
            {assigned.map((x) => (
              <DriverRow key={x.id} driver={x} />
            ))}
          </ul>
        )}
      </Block>
      <Block title={d.favorites}>
        {favorites.length === 0 ? (
          <p className="text-sm text-gp-muted">{d.noFavorites}</p>
        ) : (
          <ul className="space-y-2">
            {favorites.map((x) => (
              <DriverRow key={x.id} driver={x} />
            ))}
          </ul>
        )}
      </Block>
      <Block title={d.unpaid} hint={d.unpaidHint}>
        {view.unpaid.length === 0 ? (
          <p className="text-sm text-gp-muted">{d.noUnpaid}</p>
        ) : (
          <UnpaidList rows={view.unpaid} />
        )}
      </Block>
    </div>
  );
}

function AddDriver() {
  const { t } = useI18n();
  const d = t.merchant.drivers;
  const { backend } = useApp();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [kind, setKind] = useState<MerchantDriverKind>("favorite");
  const [driver, setDriver] = useState("");
  const [mode, setMode] = useState<MerchantPayMode>("per_trip");
  const [rate, setRate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !driver.trim()) return;
    let ratePerHourFcfa: number | null = null;
    if (kind === "assigned") {
      const clean = cleanRate(mode, rate);
      if (clean === undefined) {
        setError(d.rateInvalid);
        return;
      }
      ratePerHourFcfa = clean;
    }
    setError("");
    setBusy(true);
    try {
      await backend.addMerchantDriver(
        kind === "assigned" ? { kind, driver: driver.trim(), payMode: mode, ratePerHourFcfa } : { kind, driver: driver.trim() },
      );
      toast(kind === "assigned" ? d.addedPending : d.added, { tone: "success" });
      setDriver("");
      setRate("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Block title={d.add}>
      <form onSubmit={submit} className="space-y-3">
        <div role="radiogroup" aria-label={d.add} className="grid grid-cols-2 gap-2">
          {(["favorite", "assigned"] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={`min-h-11 rounded-xl border px-3 text-sm font-semibold ${
                kind === k
                  ? "border-gp-green-dark bg-gp-green-dark/10 text-gp-green-dark dark:border-gp-green dark:text-gp-green"
                  : "border-gp-border text-gp-muted dark:border-white/15"
              }`}
            >
              {d.kind[k]}
            </button>
          ))}
        </div>
        <p className="text-xs text-gp-muted">{d.kindHint[kind]}</p>
        <label className="block space-y-1 text-sm">
          <span>{d.driver}</span>
          <input className={field} autoComplete="off" spellCheck={false} maxLength={40} value={driver} onChange={(e) => setDriver(e.target.value)} required />
          <span className="block text-xs text-gp-muted">{d.driverHint}</span>
        </label>
        {kind === "assigned" && <PayFields mode={mode} rate={rate} onMode={setMode} onRate={setRate} />}
        <Button type="submit" busy={busy} disabled={!driver.trim()}>
          {d.addSubmit}
        </Button>
        <Notice error={error} notice="" />
      </form>
    </Block>
  );
}

function DriverRow({ driver: x }: { driver: MerchantDriver }) {
  const { t } = useI18n();
  const d = t.merchant.drivers;
  const { backend } = useApp();
  const pay = usePay();
  const clock = useClock();
  const { busy, run } = useAction();
  const [sheet, setSheet] = useState<"pay" | "end" | null>(null);
  const [mode, setMode] = useState<MerchantPayMode>(x.payMode ?? "per_trip");
  const [rate, setRate] = useState(x.ratePerHourFcfa ? String(x.ratePerHourFcfa) : "");
  const [error, setError] = useState("");
  const open = x.status === "pending" || x.status === "active";

  function savePay() {
    const clean = cleanRate(mode, rate);
    if (clean === undefined) {
      setError(d.rateInvalid);
      return;
    }
    setError("");
    void run(() => backend.changeMerchantPay(x.id, mode, clean), d.payChanged).then((ok) => {
      if (ok) setSheet(null);
    });
  }

  return (
    <li className="space-y-2 rounded-xl border border-black/10 p-3 text-sm dark:border-white/10">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{x.driverName}</span>
        <Badge tone={STATUS_TONE[x.status]}>{d.status[x.status]}</Badge>
        {x.checkedInSince && <Badge tone="blue">{format(d.checkedIn, { time: clock(x.checkedInSince) })}</Badge>}
        {x.driverPhone && (
          <a href={`tel:${x.driverPhone}`} className="text-gp-green-dark underline dark:text-gp-green">
            {x.driverPhone}
          </a>
        )}
        <span className="flex-1" />
        <span className="text-xs text-gp-muted">{x.vehicle ? `${t.drivers.vehicle[x.vehicle.type]} · ${x.vehicle.plate}` : ""}</span>
      </div>
      {x.kind === "assigned" && (
        <p className="text-xs text-gp-muted">
          {pay(x.payMode, x.ratePerHourFcfa)}
          {x.status === "active" && x.approvedAs ? ` · ${d.approvedAs[x.approvedAs]}` : ""}
          {x.status === "pending" ? ` · ${d.waitingApproval}` : ""}
        </p>
      )}
      {open && (
        <div className="flex flex-wrap gap-2">
          {x.kind === "assigned" && !x.checkedInSince && (
            <Button variant="secondary" size="md" onClick={() => setSheet("pay")}>
              {d.changePay}
            </Button>
          )}
          <Button variant="ghost" size="md" onClick={() => setSheet("end")}>
            {d.end}
          </Button>
        </div>
      )}
      <ConfirmSheet
        open={sheet === "pay"}
        title={format(d.changePayTitle, { name: x.driverName })}
        confirmLabel={d.save}
        busy={busy}
        onCancel={() => setSheet(null)}
        onConfirm={savePay}
      >
        <p className="mb-3 text-sm">{d.changePayText}</p>
        <PayFields mode={mode} rate={rate} onMode={setMode} onRate={setRate} />
        <Notice error={error} notice="" />
      </ConfirmSheet>
      <ConfirmSheet
        open={sheet === "end"}
        title={format(d.endTitle, { name: x.driverName })}
        confirmLabel={d.end}
        danger
        busy={busy}
        onCancel={() => setSheet(null)}
        onConfirm={() =>
          void run(() => backend.endMerchantDriver(x.id), d.ended).then((ok) => {
            if (ok) setSheet(null);
          })
        }
      >
        <p className="text-sm">{d.endText}</p>
      </ConfirmSheet>
    </li>
  );
}

/** Hourly check-ins the driver has not confirmed as paid yet. */
function UnpaidList({ rows }: { rows: MerchantCheckin[] }) {
  const { t } = useI18n();
  const d = t.merchant.drivers;
  const fcfa = useFcfa();
  const longDate = useLongDate();
  const duration = useDuration();
  const total = rows.reduce((n, r) => n + (r.amountFcfa ?? 0), 0);
  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-black/10 p-3 text-sm dark:border-white/10">
            <span className="font-semibold">{r.driverName}</span>
            <span className="text-gp-muted">
              {format(d.unpaidLine, { date: longDate(r.inAt), hours: r.outAt ? duration(r.inAt, r.outAt) : "–" })}
            </span>
            <span className="flex-1" />
            <span className="font-semibold">{fcfa(r.amountFcfa ?? 0)}</span>
          </li>
        ))}
      </ul>
      <p className="text-right text-sm font-semibold">{format(d.unpaidTotal, { amount: fcfa(total) })}</p>
    </div>
  );
}
