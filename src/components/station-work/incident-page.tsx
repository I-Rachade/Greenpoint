"use client";

import { useState, type FormEvent } from "react";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { INCIDENT_KINDS, INCIDENT_TEXT_MAX, type Incident, type IncidentKind } from "@shared/incidents";
import { newRequestId } from "@shared/station-work";
import type { StationView } from "@shared/types";
import { useApp } from "../app-provider";
import { useI18n } from "../i18n-provider";
import { LoadFailed } from "../load-state";
import { Badge, Button, Card, SkeletonCard, SuccessCheck, useToast } from "../ui";
import { Chips, ScanField } from "./swap-page";
import { WorkShell } from "./work-shell";

const textareaClass =
  "min-h-24 w-full rounded-xl border border-gp-border bg-gp-surface px-4 py-2.5 text-base outline-none transition-colors duration-160 placeholder:text-gp-muted focus:border-gp-green-dark focus-visible:ring-2 focus-visible:ring-gp-green/40 dark:focus:border-gp-green";

/** When, as staff read it: the time today, else the day and time. */
export function useIncidentWhen() {
  const { locale } = useI18n();
  return (iso: string) => {
    const d = new Date(iso);
    const today = new Date().toISOString().slice(0, 10) === iso.slice(0, 10);
    return today
      ? d.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
      : d.toLocaleString(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  };
}

/** One reported problem: kind, battery, comment, who and when, handled or not; `action` for owners. */
export function IncidentItem({ incident, action }: { incident: Incident; action?: React.ReactNode }) {
  const { t } = useI18n();
  const x = t.work.incident;
  const when = useIncidentWhen();
  return (
    <li className="space-y-1 px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{x.kinds[incident.kind]}</span>
        <Badge tone={incident.status === "open" ? "amber" : "green"}>{x.statuses[incident.status]}</Badge>
        {incident.batteryLabel && <span className="font-mono text-gp-muted">{incident.batteryLabel}</span>}
      </div>
      {incident.comment && <p>{incident.comment}</p>}
      <p className="text-xs text-gp-muted">
        {when(incident.createdAt)} · {incident.person}
      </p>
      {incident.status === "resolved" && (
        <p className="text-xs text-gp-muted">
          {x.resolvedBy.replace("{person}", incident.resolvedBy ?? "–").replace("{when}", incident.resolvedAt ? when(incident.resolvedAt) : "")}
          {incident.resolution ? ` : ${incident.resolution}` : ""}
        </p>
      )}
      {action}
    </li>
  );
}

function IncidentForm({ station, onDone }: { station: StationView; onDone: () => void }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const x = t.work.incident;
  const [kind, setKind] = useState<IncidentKind | "">("");
  const [battery, setBattery] = useState("");
  const [comment, setComment] = useState("");
  const [requestId, setRequestId] = useState(newRequestId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!kind) return setError(t.errors.incident_kind_required);
    setBusy(true);
    try {
      await backend.reportIncident(station.id, { requestId, kind, comment: comment || null, batteryLabel: kind === "battery" ? battery || null : null });
      toast(x.sent, { tone: "success" });
      setKind("");
      setBattery("");
      setComment("");
      setRequestId(newRequestId());
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{x.kind}</legend>
        <Chips value={kind} label={x.kind} onChange={setKind} options={INCIDENT_KINDS.map((id) => ({ id, label: x.kinds[id] }))} />
      </fieldset>
      {kind === "battery" && <ScanField label={x.battery} hint={x.batteryHint} value={battery} onChange={setBattery} barcodes />}
      <label className="block space-y-1">
        <span className="text-sm font-medium">{kind === "other" ? x.commentRequired : x.comment}</span>
        <textarea
          className={textareaClass}
          value={comment}
          maxLength={INCIDENT_TEXT_MAX}
          required={kind === "other"}
          placeholder={x.commentHint}
          onChange={(e) => setComment(e.target.value)}
        />
      </label>
      {kind === "battery" && <p className="text-sm font-medium text-amber-700 dark:text-amber-300">{x.batterySafety}</p>}
      {error && (
        <p role="alert" className="animate-gp-shake text-sm text-red-600">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={busy || !kind}>
        {x.send}
      </Button>
    </form>
  );
}

function IncidentView({ station }: { station: StationView }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const x = t.work.incident;
  const [sent, setSent] = useState(false);
  const { data, error, reload } = useLiveQuery(() => backend.stationIncidents(station.id), station.id);
  return (
    <>
      <p className="text-sm text-gp-muted">{x.intro}</p>
      {sent ? (
        <Card className="flex flex-col items-center gap-3 p-6 text-center">
          <SuccessCheck />
          <p className="font-semibold">{x.sent}</p>
          <p className="text-sm text-gp-muted">{x.sentHint}</p>
          <Button onClick={() => setSent(false)}>{x.another}</Button>
        </Card>
      ) : (
        <IncidentForm
          station={station}
          onDone={() => {
            setSent(true);
            reload();
          }}
        />
      )}
      <h2 className="pt-2 font-heading text-lg font-semibold">{x.list}</h2>
      {!data ? (
        error ? (
          <LoadFailed error={error} onRetry={reload} />
        ) : (
          <SkeletonCard />
        )
      ) : data.length === 0 ? (
        <p className="text-sm text-gp-muted">{x.none}</p>
      ) : (
        <ul className="divide-y divide-gp-border rounded-2xl border border-gp-border bg-gp-surface">
          {data.map((i) => (
            <IncidentItem key={i.id} incident={i} />
          ))}
        </ul>
      )}
    </>
  );
}

/** /operator/probleme: report a charger failure, power cut, battery anomaly or payment error, and see the station's reports. */
export function IncidentPage() {
  const { t } = useI18n();
  return <WorkShell title={t.work.incident.title}>{({ station }) => <IncidentView key={station.id} station={station} />}</WorkShell>;
}
