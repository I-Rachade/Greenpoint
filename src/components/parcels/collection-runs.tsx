"use client";

import { useState, type ReactNode } from "react";
import { useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import type { Parcel, ParcelRun } from "@/lib/parcels";
import type { StationView } from "@/lib/types";
import { useApp } from "../app-provider";
import { ConfirmSheet } from "../confirm-sheet";
import { useI18n } from "../i18n-provider";
import { Badge, Button, Input } from "../ui";
import { canScanQr, QrScanner } from "./qr-scanner";

/** Runs an action, shows its error or notice (made from the result) and reloads the parcels; false when it failed. */
export type RunAction = <T>(action: () => Promise<T>, success?: string | ((result: T) => string)) => Promise<boolean>;

/** A text field for a parcel number, slip QR or driver code, with the camera next to it. */
export function ScanField({
  label,
  submitLabel,
  placeholder,
  onSubmit,
  busy = false,
}: {
  label: string;
  submitLabel: string;
  placeholder?: string;
  /** Resolves true when the value was taken, which clears the field. */
  onSubmit: (value: string) => Promise<boolean>;
  busy?: boolean;
}) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [scanning, setScanning] = useState(false);

  async function send(text: string) {
    if (!text.trim()) return;
    if (await onSubmit(text.trim())) setValue("");
  }

  return (
    <div className="space-y-2">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(value);
        }}
      >
        <Input
          autoCapitalize="characters"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          aria-label={label}
          className="min-w-0 flex-1 basis-48 font-mono"
        />
        <Button type="submit" busy={busy} disabled={!value.trim()}>
          {submitLabel}
        </Button>
        {canScanQr() && !scanning && (
          <Button type="button" variant="secondary" onClick={() => setScanning(true)}>
            {t.runs.scanCamera}
          </Button>
        )}
      </form>
      {scanning && (
        <QrScanner
          onClose={() => setScanning(false)}
          onResult={(text) => {
            setScanning(false);
            void send(text);
          }}
        />
      )}
    </div>
  );
}

function Row({ children }: { children: ReactNode }) {
  return <li className="flex min-h-11 flex-wrap items-center gap-2 rounded-lg bg-zinc-100 px-3 py-2 text-sm dark:bg-zinc-900">{children}</li>;
}

/** One collection run: scan each parcel into the driver's hands, then send it off. */
function RunCard({ run, stations, act }: { run: ParcelRun; stations: StationView[]; act: RunAction }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const [busy, setBusy] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const r = t.runs;
  const name = (id: string) => stations.find((s) => s.id === id)?.name ?? "?";
  const scanned = run.parcels.filter((p) => p.scanned).length;
  const all = run.parcels.length > 0 && scanned === run.parcels.length;
  const loading = run.status === "loading";
  const driver = [run.driver.name, run.driver.plate].filter(Boolean).join(" · ");

  async function step<T>(action: () => Promise<T>, success: string | ((result: T) => string)): Promise<boolean> {
    setBusy(true);
    try {
      return await act(action, success);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="space-y-3 rounded-xl border border-black/10 p-3 dark:border-white/10">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-semibold">{format(r.driver, { name: driver || run.driver.phone || "?" })}</span>
        <Badge tone={loading ? "amber" : "blue"}>{r.status[run.status]}</Badge>
        <span className="ml-auto text-xs text-zinc-500">
          {loading ? format(r.progress, { n: scanned, total: run.parcels.length }) : format(r.progress, { n: run.parcels.filter((p) => p.received).length, total: run.parcels.length })}
        </span>
      </div>
      {loading && (
        <ScanField
          label={r.scanInput}
          submitLabel={r.scanSubmit}
          placeholder="GP-…"
          busy={busy}
          onSubmit={(code) =>
            step(
              () => backend.scanRunParcel(run.stationId, run.id, code),
              (next) => {
                // The parcel this scan marked; a repeat scan of the same parcel changes nothing.
                const item = next.parcels.find((p) => p.scanned && !run.parcels.find((q) => q.id === p.id)?.scanned);
                return item ? format(r.scannedOne, { no: item.trackingNo }) : "";
              },
            )
          }
        />
      )}
      <ul className="space-y-1">
        {run.parcels.map((p) => (
          <Row key={p.id}>
            <span className="font-mono">{p.trackingNo}</span>
            <span>
              {p.size} → {name(p.toStationId)}
            </span>
            <span className="flex-1" />
            {loading ? (
              <Badge tone={p.scanned ? "green" : "neutral"}>{p.scanned ? r.scanned : r.toScan}</Badge>
            ) : (
              p.received && <Badge tone="green">{r.received}</Badge>
            )}
            {loading && (
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11"
                disabled={busy}
                aria-label={format(r.removeLabel, { no: p.trackingNo })}
                onClick={() => void step(() => backend.removeRunParcel(run.stationId, run.id, p.id), "")}
              >
                {r.remove}
              </Button>
            )}
          </Row>
        ))}
      </ul>
      {loading && (
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!all} busy={busy} onClick={() => void step(() => backend.departRun(run.stationId, run.id), format(r.departed, { n: run.parcels.length }))}>
            {r.depart}
          </Button>
          <Button variant="secondary" disabled={busy} onClick={() => setConfirmCancel(true)}>
            {r.cancelRun}
          </Button>
          {!all && <p className="w-full text-xs text-zinc-500">{r.departBlocked}</p>}
        </div>
      )}
      <ConfirmSheet
        open={confirmCancel}
        title={r.cancelRunTitle}
        confirmLabel={r.cancelRun}
        cancelLabel={r.keep}
        danger
        busy={busy}
        onCancel={() => setConfirmCancel(false)}
        onConfirm={() => {
          setConfirmCancel(false);
          void step(() => backend.cancelRun(run.stationId, run.id), r.cancelled);
        }}
      >
        <p>{r.cancelRunBody}</p>
      </ConfirmSheet>
    </li>
  );
}

/**
 * "À expédier": staff choose the parcels a driver takes and record the driver (QR or
 * typed code); then each parcel is scanned into the driver's hands, and the run can only
 * leave once every parcel was scanned (plan phase 7).
 */
export function OutgoingRuns({
  station,
  stations,
  outgoing,
  run,
  onSlip,
  onCancelParcel,
}: {
  station: StationView;
  stations: StationView[];
  /** Parcels deposited here for another station, express ones excluded. */
  outgoing: Parcel[];
  run: RunAction;
  onSlip: (p: Parcel) => void;
  onCancelParcel: (p: Parcel) => void;
}) {
  const { t } = useI18n();
  const { backend } = useApp();
  const { data: runs, reload } = useLiveQuery(() => backend.stationRuns(station.id), station.id);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [badge, setBadge] = useState("");
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const r = t.runs;
  const name = (id: string) => stations.find((s) => s.id === id)?.name ?? "?";

  const act: RunAction = async (action, success) => {
    const ok = await run(action, success);
    reload();
    return ok;
  };

  const open = (runs ?? []).filter((x) => x.status === "loading" || x.status === "under_way");
  const free = outgoing.filter((p) => !p.runId || !open.some((x) => x.id === p.runId));
  const ids = free.map((p) => p.id).filter((id) => selected.has(id));

  async function start(code: string) {
    if (!code.trim() || ids.length === 0) return;
    setBusy(true);
    const ok = await act(() => backend.startRun(station.id, code.trim(), ids), r.started);
    setBusy(false);
    if (ok) {
      setSelected(new Set());
      setBadge("");
    }
  }

  return (
    <div className="space-y-4">
      {open.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">{r.openRuns}</h3>
          <ul className="space-y-3">
            {open.map((x) => (
              <RunCard key={x.id} run={x} stations={stations} act={act} />
            ))}
          </ul>
        </div>
      )}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{r.newRun}</h3>
        <p className="text-xs text-zinc-500">{r.newRunHint}</p>
        {free.length === 0 ? (
          <p className="text-sm text-zinc-500">{r.noneToShip}</p>
        ) : (
          <>
            <label className="flex min-h-11 items-center gap-3 text-sm text-zinc-600 dark:text-zinc-400">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={ids.length === free.length}
                onChange={(e) => setSelected(new Set(e.target.checked ? free.map((p) => p.id) : []))}
              />
              {t.parcels.staff.selectAll}
            </label>
            <ul className="space-y-1">
              {free.map((p) => (
                <Row key={p.id}>
                  <label className="flex min-h-11 flex-1 items-center gap-3">
                    <input
                      type="checkbox"
                      className="h-5 w-5"
                      checked={selected.has(p.id)}
                      onChange={(e) =>
                        setSelected((s) => {
                          const next = new Set(s);
                          if (e.target.checked) next.add(p.id);
                          else next.delete(p.id);
                          return next;
                        })
                      }
                    />
                    <span className="font-mono">{p.trackingNo}</span>
                    <span>
                      {p.size} · {name(p.fromStationId)} → {name(p.toStationId)}
                    </span>
                  </label>
                  <Button variant="secondary" size="sm" className="min-h-11" onClick={() => onSlip(p)}>
                    {t.parcels.slip}
                  </Button>
                  <Button variant="ghost" size="sm" className="min-h-11" onClick={() => onCancelParcel(p)}>
                    {t.parcels.staff.cancel}
                  </Button>
                </Row>
              ))}
            </ul>
            <form
              className="flex flex-wrap items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void start(badge);
              }}
            >
              <Input
                autoCapitalize="characters"
                autoComplete="off"
                maxLength={400}
                value={badge}
                onChange={(e) => setBadge(e.target.value)}
                placeholder="ABCD1234"
                aria-label={r.driverBadge}
                className="min-w-0 flex-1 basis-48 font-mono"
              />
              <Button type="submit" busy={busy} disabled={ids.length === 0 || !badge.trim()}>
                {format(r.start, { n: ids.length })}
              </Button>
              {canScanQr() && !scanning && (
                <Button variant="secondary" disabled={ids.length === 0} onClick={() => setScanning(true)}>
                  {r.scanDriver}
                </Button>
              )}
            </form>
            {scanning && (
              <QrScanner
                onClose={() => setScanning(false)}
                onResult={(text) => {
                  setScanning(false);
                  void start(text);
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** "Arrivées": staff scan each parcel in as it arrives; the recipient is told it is ready. */
export function ReceiveParcels({ station, stations, incoming, run }: { station: StationView; stations: StationView[]; incoming: Parcel[]; run: RunAction }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const [busy, setBusy] = useState(false);
  const r = t.runs;
  const name = (id: string) => stations.find((s) => s.id === id)?.name ?? "?";

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">{r.receiveHint}</p>
      <ScanField
        label={r.scanInput}
        submitLabel={r.receiveSubmit}
        placeholder="GP-…"
        busy={busy}
        onSubmit={async (code) => {
          setBusy(true);
          const ok = await run(
            () => backend.receiveParcel(station.id, code),
            (p) => format(r.receivedOne, { no: p.trackingNo }),
          );
          setBusy(false);
          return ok;
        }}
      />
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{r.expected}</h3>
        {incoming.length === 0 ? (
          <p className="text-sm text-zinc-500">{t.parcels.staff.none}</p>
        ) : (
          <ul className="space-y-1">
            {incoming.map((p) => (
              <Row key={p.id}>
                <span className="font-mono">{p.trackingNo}</span>
                <span>
                  {p.size} · {name(p.fromStationId)} → {name(p.toStationId)}
                </span>
              </Row>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
