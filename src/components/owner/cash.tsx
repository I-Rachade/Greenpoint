"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import { Badge, Button, EmptyState, Input, type BadgeTone } from "@/components/ui";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import {
  HANDOVER_METHODS,
  HANDOVER_NOTE_MAX,
  HANDOVER_REFERENCE_MAX,
  OWN_CASH_KINDS,
  type CashHandover,
  type CashKind,
  type HandoverMethod,
  type HandoverStatus,
  type StationCash,
} from "@shared/station-cash";
import { Loaded, Section, useWhen, useXof } from "./shared";

const STATUS_TONE: Record<HandoverStatus, BadgeTone> = { pending: "amber", confirmed: "green", rejected: "red" };
const LINES: CashKind[] = ["chargesXof", "swapsXof", "parcelsXof", "driversXof", "cardsXof", "creditXof"];

function Row({ label, value, strong = false }: { label: ReactNode; value: number; strong?: boolean }) {
  const xof = useXof();
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1.5 ${strong ? "font-semibold" : ""}`}>
      <dt className={strong ? "" : "text-gp-muted"}>{label}</dt>
      <dd className="tabular-nums">{xof(value)}</dd>
    </div>
  );
}

/** The day's closing: amount, how it was handed over and its reference, a reason when it differs. */
function CloseForm({ cash, onDone }: { cash: StationCash; onDone: () => void }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const c = t.stationCash;
  const due = Math.max(0, cash.dueXof);
  const [amount, setAmount] = useState(String(due));
  const [method, setMethod] = useState<HandoverMethod>("cash");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const amountXof = Number(amount);
  const differs = amount !== "" && amountXof !== due;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      await backend.closeCashDay({
        stationId: cash.stationId,
        staffId: cash.staffId,
        amountXof,
        method,
        reference,
        note: note.trim() || null,
        expectedDueXof: cash.dueXof,
      });
      setMessage({ text: c.saved, ok: true });
      setReference("");
      setNote("");
      onDone();
    } catch (err) {
      setMessage({ text: errorMessage(err), ok: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-gp-border p-3">
      <h3 className="font-medium">{c.close}</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm">
          <span>{c.amount}</span>
          <Input type="number" inputMode="numeric" min={0} step={1} required value={amount} onChange={(e) => setAmount(e.target.value)} />
        </label>
        <fieldset className="space-y-1 text-sm">
          <legend>{c.method}</legend>
          <select
            className="min-h-11 w-full rounded-xl border border-gp-border bg-gp-surface px-3 text-base"
            value={method}
            onChange={(e) => setMethod(e.target.value as HandoverMethod)}
            aria-label={c.method}
          >
            {HANDOVER_METHODS.map((m) => (
              <option key={m} value={m}>
                {c.methods[m]}
              </option>
            ))}
          </select>
        </fieldset>
        <label className="space-y-1 text-sm sm:col-span-2">
          <span>{c.reference[method]}</span>
          <Input required maxLength={HANDOVER_REFERENCE_MAX} value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>
        {differs && (
          <label className="space-y-1 text-sm sm:col-span-2">
            <span>{c.note}</span>
            <Input required maxLength={HANDOVER_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} />
            <span className="block text-xs text-gp-muted">{c.noteHint}</span>
          </label>
        )}
      </div>
      <Button type="submit" busy={busy}>
        {c.submit}
      </Button>
      {message && (
        <p role="status" className={`text-sm ${message.ok ? "text-gp-green-dark dark:text-gp-green" : "text-red-600"}`}>
          {message.text}
        </p>
      )}
    </form>
  );
}

/** One handover with its status; an admin confirms or rejects a pending one. */
function HandoverItem({ h, admin, onChanged }: { h: CashHandover; admin: boolean; onChanged: () => void }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const xof = useXof();
  const when = useWhen();
  const c = t.stationCash;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function decide(confirm: boolean) {
    let reason: string | undefined;
    if (!confirm) {
      reason = window.prompt(c.rejectReason)?.trim();
      if (!reason) return;
    }
    setBusy(true);
    setError(null);
    try {
      await backend.decideHandover(h.id, confirm, reason);
      onChanged();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="space-y-1 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={STATUS_TONE[h.status]}>{c.statuses[h.status]}</Badge>
        <span className="font-medium tabular-nums">{format(c.handoverLine, { amount: xof(h.amountXof), due: xof(Math.max(0, h.dueXof)) })}</span>
      </div>
      <div className="text-gp-muted">
        {c.methods[h.method]} · {h.reference} · {format(c.by, { person: h.createdBy, date: when(h.createdAt) })}
      </div>
      {h.note && <div className="text-gp-muted">« {h.note} »</div>}
      {h.decidedBy && h.decidedAt && (
        <div className="text-gp-muted">{format(c.decided, { status: c.statuses[h.status], person: h.decidedBy, date: when(h.decidedAt) })}</div>
      )}
      {h.rejectReason && <div className="text-red-700 dark:text-red-300">{format(c.rejectedBecause, { reason: h.rejectReason })}</div>}
      {admin && h.status === "pending" && (
        <div className="flex flex-wrap gap-2 pt-1">
          <Button size="sm" busy={busy} onClick={() => decide(true)}>
            {c.confirm}
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => decide(false)}>
            {c.reject}
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
    </li>
  );
}

/**
 * A partner station's cash (at an own station: one staff member's): what it took for poinderecharge
 * since the last closing, the carry over, the commission kept back and the amount due; the closing
 * form and the handovers.
 */
export function StationCashCard({ cash, admin, onChanged, extra }: { cash: StationCash; admin: boolean; onChanged: () => void; extra?: ReactNode }) {
  const { t } = useI18n();
  const xof = useXof();
  const when = useWhen();
  const c = t.stationCash;
  const [closing, setClosing] = useState(false);
  const pendingCount = cash.handovers.filter((h) => h.status === "pending").length;
  return (
    <Section
      title={cash.staffName ? `${cash.stationName} · ${cash.staffName}` : cash.stationName}
      aside={
        <>
          <Badge tone={cash.type === "shop" ? "blue" : cash.type === "own" ? "green" : "neutral"}>{c.types[cash.type]}</Badge>
          {cash.late && <Badge tone="red">{c.late}</Badge>}
          {admin && pendingCount > 0 && <Badge tone="amber">{format(c.toConfirm, { n: pendingCount })}</Badge>}
        </>
      }
    >
      <p className="text-xs text-gp-muted">
        {cash.operatorName} · {c.typeHints[cash.type]} · {format(c.since, { date: when(cash.since) })}
      </p>
      {cash.late && <p className="text-sm text-red-700 dark:text-red-300">{c.lateHint}</p>}
      {extra}
      <dl className="divide-y divide-black/5 text-sm dark:divide-white/10">
        {/* At an own station every kind the staff member takes, also at 0, so the breakdown reads the same each day. */}
        {(cash.type === "own" ? OWN_CASH_KINDS : LINES.filter((k) => cash.lines[k] !== 0)).map((k) => (
          <Row key={k} label={c.lines[k]} value={cash.lines[k]} />
        ))}
        <Row label={c.collected} value={cash.lines.totalXof} strong />
        {cash.carryXof !== 0 && <Row label={c.carry} value={cash.carryXof} />}
        {cash.commissionXof > 0 && <Row label={format(c.commission, { pct: cash.commissionPct })} value={-cash.commissionXof} />}
        <Row label={cash.dueXof < 0 ? c.owedToYou : c.due} value={Math.abs(cash.dueXof)} strong />
      </dl>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gp-muted">
        {cash.pendingXof > 0 && <span>{format(c.pending, { amount: xof(cash.pendingXof) })}</span>}
        {cash.commissionPct > 0 && (
          <span>
            {format(c.monthCommission, { amount: xof(cash.monthCommissionXof) })} ({cash.commissionPct} %, {c.commissionModes[cash.commissionMode]})
          </span>
        )}
      </div>
      {closing ? (
        <CloseForm
          cash={cash}
          onDone={() => {
            setClosing(false);
            onChanged();
          }}
        />
      ) : cash.dueXof === 0 && cash.lines.totalXof === 0 ? (
        <p className="text-sm text-gp-muted">{c.nothingDue}</p>
      ) : (
        <Button onClick={() => setClosing(true)}>{c.close}</Button>
      )}
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{c.history}</h3>
        {cash.handovers.length === 0 ? (
          <p className="text-sm text-gp-muted">{c.noHistory}</p>
        ) : (
          <ul className="divide-y divide-black/5 dark:divide-white/10">
            {cash.handovers.map((h) => (
              <HandoverItem key={h.id} h={h} admin={admin} onChanged={onChanged} />
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}

/** Cards are per station, at own stations per staff member. */
export const cashKey = (s: StationCash) => `${s.stationId}:${s.staffId ?? ""}`;

/** The owner's "Cash" tab: one card per partner station of the selection, per staff member at own stations. */
export function CashView({ stationId }: { stationId: string | null }) {
  const { t } = useI18n();
  const { backend, profile } = useApp();
  const { data, error, reload } = useLiveQuery(() => backend.ownerCash(stationId), stationId ?? "");
  return (
    <Loaded data={data} error={error} reload={reload}>
      {(stations) =>
        stations.length === 0 ? (
          <EmptyState text={t.stationCash.noStations} />
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-gp-muted">{t.stationCash.ownerIntro}</p>
            {stations.map((s) => (
              <StationCashCard key={cashKey(s)} cash={s} admin={profile?.role === "admin"} onChanged={reload} />
            ))}
          </div>
        )
      }
    </Loaded>
  );
}
