"use client";

import { useRef, useState } from "react";
import { BackendError } from "@/lib/backend";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { newRequestId, type BatteryEventInput, type BatteryEventView, type CounterRow, type StationCounter } from "@/lib/station-work";
import type { StationView } from "@/lib/types";
import { useApp } from "../app-provider";
import { ConfirmSheet } from "../confirm-sheet";
import { useI18n } from "../i18n-provider";
import { LoadFailed } from "../load-state";
import { Button, Card, EmptyState, Input, SkeletonCard, useToast } from "../ui";
import { RoleBadge, WorkShell } from "./work-shell";

const REASONS = ["inventory", "defective", "lost", "other"] as const;
type ReasonKey = (typeof REASONS)[number];

/** Sends one event; a dropped connection is retried once with the same request id (counted once, R5). */
export async function sendEvent(send: () => Promise<BatteryEventView>): Promise<BatteryEventView> {
  try {
    return await send();
  } catch (err) {
    if (err instanceof BackendError && err.code === "unknown" && err.message === "network") return send();
    throw err;
  }
}

/** One counter: big number, "marked full" +1 and "issue" −1. Taps show at once and are sent one by one. */
function CounterCard({
  station,
  row,
  total,
  capacity,
  canCorrect,
  onCorrect,
  onDone,
}: {
  station: StationView;
  row: CounterRow;
  total: number;
  capacity: number;
  canCorrect: boolean;
  onCorrect: () => void;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const { backend } = useApp();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const c = t.work.counter;
  // While taps are on their way the number shows what they will make; then the server's again.
  const inFlight = useRef(0);
  const [local, setLocal] = useState<{ full: number; total: number } | null>(null);
  const [shake, setShake] = useState(0);
  const full = local?.full ?? row.full;
  const stationTotal = local?.total ?? total;

  function refuse(message: string) {
    setShake((n) => n + 1);
    toast(message, { tone: "error" });
  }

  function tap(type: "full" | "issue") {
    if (type === "issue" && full <= 0) return refuse(c.atZero);
    if (type === "full" && capacity > 0 && stationTotal >= capacity) return refuse(format(c.atCapacity, { n: capacity }));
    const delta = type === "full" ? 1 : -1;
    setLocal({ full: full + delta, total: stationTotal + delta });
    inFlight.current += 1;
    const input: BatteryEventInput = { type, batteryTypeId: row.batteryTypeId, requestId: newRequestId() };
    sendEvent(() => backend.batteryEvent(station.id, input)).then(
      () => toast(t.work.saved),
      (err) => {
        setLocal((cur) => (cur ? { full: cur.full - delta, total: cur.total - delta } : cur));
        refuse(errorMessage(err));
      },
    ).finally(() => {
      inFlight.current -= 1;
      if (inFlight.current === 0) {
        setLocal(null);
        onDone();
      }
    });
  }

  return (
    <Card key={shake} className={`space-y-3 p-4 ${shake ? "animate-gp-shake" : ""}`}>
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-semibold">{row.label ?? c.station}</h2>
        {canCorrect && (
          <Button variant="ghost" size="sm" onClick={onCorrect}>
            {c.correct}
          </Button>
        )}
      </div>
      <div className="flex items-baseline justify-center gap-2" aria-live="polite">
        <span key={full} className="animate-gp-bump font-heading text-6xl font-bold tabular-nums">
          {full}
        </span>
        <span className="text-lg text-gp-muted">{c.full}</span>
      </div>
      <p className="text-center text-sm text-gp-muted">{format(c.charging, { n: row.empty })}</p>
      <div className="grid grid-cols-2 gap-3">
        <Button variant="secondary" size="lg" onClick={() => tap("issue")} aria-label={`${c.issue} −1`}>
          −1 {c.issue}
        </Button>
        <Button size="lg" onClick={() => tap("full")} aria-label={`${c.markFull} +1`}>
          +1 {c.markFull}
        </Button>
      </div>
    </Card>
  );
}

/** Owner and admin: change the counter by up to ±100 with a reason (stock count, faulty, lost, other). */
function CorrectionSheet({ station, row, onClose }: { station: StationView; row: CounterRow | null; onClose: () => void }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const c = t.work.counter;
  const [delta, setDelta] = useState(-1);
  const [reason, setReason] = useState<ReasonKey>("inventory");
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState(newRequestId);
  const text = reason === "other" ? other.trim() : c.reasons[reason];

  async function apply() {
    if (!row || !text || delta === 0) return;
    setBusy(true);
    try {
      await sendEvent(() => backend.batteryEvent(station.id, { type: "correction", batteryTypeId: row.batteryTypeId, delta, reason: text, requestId }));
      toast(t.work.saved);
      setRequestId(newRequestId());
      onClose();
    } catch (err) {
      toast(errorMessage(err), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  const step = (n: number) => setDelta((d) => Math.max(-100, Math.min(100, d + n === 0 ? d + 2 * n : d + n)));
  const stepButton = "grid h-12 w-12 place-items-center rounded-full bg-gp-green-dark text-2xl font-bold text-white active:scale-95";
  return (
    <ConfirmSheet
      open={!!row}
      title={`${c.correctTitle}${row?.label ? ` · ${row.label}` : ""}`}
      confirmLabel={c.apply}
      busy={busy}
      onConfirm={() => void apply()}
      onCancel={onClose}
    >
      <p className="text-sm">{c.correctHint}</p>
      <div className="text-sm font-medium">{c.change}</div>
      <div className="flex items-center justify-center gap-4">
        <button type="button" className={stepButton} onClick={() => step(-1)} aria-label="−1">
          −
        </button>
        <span className="min-w-16 text-center font-heading text-3xl font-bold tabular-nums">{delta > 0 ? `+${delta}` : delta}</span>
        <button type="button" className={stepButton} onClick={() => step(1)} aria-label="+1">
          +
        </button>
      </div>
      {row && <p className="text-center text-sm text-gp-muted">{format(c.after, { n: Math.max(0, row.full + delta) })}</p>}
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{c.reason}</legend>
        <div className="flex flex-wrap gap-2">
          {REASONS.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={reason === r}
              onClick={() => setReason(r)}
              className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${
                reason === r ? "border-gp-green-dark bg-gp-green-dark text-white" : "border-gp-border"
              }`}
            >
              {c.reasons[r]}
            </button>
          ))}
        </div>
        {reason === "other" && <Input value={other} maxLength={200} onChange={(e) => setOther(e.target.value)} placeholder={c.reasonOther} aria-label={c.reasonOther} />}
      </fieldset>
    </ConfirmSheet>
  );
}

function EventList({ counter, mine }: { counter: StationCounter; mine: boolean }) {
  const { t, locale } = useI18n();
  const c = t.work.counter;
  const labels = new Map(counter.rows.map((r) => [r.batteryTypeId, r.label]));
  const time = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold">{mine ? c.todayMine : c.today}</h2>
      {counter.events.length === 0 ? (
        <p className="text-sm text-gp-muted">{c.noEvents}</p>
      ) : (
        <ul className="divide-y divide-gp-border rounded-2xl border border-gp-border bg-gp-surface">
          {counter.events.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3 text-sm">
              <span className="tabular-nums text-gp-muted">{time(e.createdAt)}</span>
              <span className="min-w-0 flex-1 font-medium">
                {c.events[e.type]}
                {labels.get(e.batteryTypeId) ? ` · ${labels.get(e.batteryTypeId)}` : ""}
                {e.reason ? ` · « ${e.reason} »` : ""}
              </span>
              <span className="font-semibold tabular-nums">{e.type === "empty_in" ? "" : e.delta > 0 ? `+${e.delta}` : e.delta}</span>
              <span className="w-full text-xs text-gp-muted sm:w-auto">
                {format(c.after, { n: e.fullAfter })} · {e.person} <RoleBadge role={e.role} />
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StationCounterView({ station, mine }: { station: StationView; mine: boolean }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const { data, error, reload } = useLiveQuery(() => backend.stationCounter(station.id), station.id);
  const [correcting, setCorrecting] = useState<CounterRow | null>(null);
  if (!data) return error ? <LoadFailed error={error} onRetry={reload} /> : <SkeletonCard />;
  const total = data.rows.reduce((n, r) => n + r.full, 0);
  return (
    <>
      <p className="text-sm text-gp-muted">{t.work.counter.intro}</p>
      {data.rows.length === 0 && <EmptyState text={t.work.serviceOff} />}
      <div className="grid gap-3 sm:grid-cols-2">
        {data.rows.map((row) => (
          <CounterCard
            key={row.batteryTypeId}
            station={station}
            row={row}
            total={total}
            capacity={data.capacity}
            canCorrect={data.canCorrect}
            onCorrect={() => setCorrecting(row)}
            onDone={reload}
          />
        ))}
      </div>
      <CorrectionSheet key={correcting?.batteryTypeId ?? "none"} station={station} row={correcting} onClose={() => setCorrecting(null)} />
      <EventList counter={data} mine={mine} />
    </>
  );
}

/** /operator/compteur: full batteries per type, "marked full" and "issue", corrections for owners and admins. */
export function CounterPage() {
  const { t } = useI18n();
  return (
    <WorkShell title={t.work.counter.title} services={["swap"]}>
      {({ station, role }) => <StationCounterView key={station.id} station={station} mine={role === "staff"} />}
    </WorkShell>
  );
}
