"use client";

import { useState } from "react";
import { useApp } from "@/components/app-provider";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { useI18n } from "@/components/i18n-provider";
import { format } from "@/lib/i18n/format";
import { Badge, Button, EmptyState, Input, useToast } from "@/components/ui";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import type { Incident } from "@shared/incidents";
import { IncidentItem } from "@/components/station-work/incident-page";
import type { ReportPeriod } from "@shared/owner-backoffice";
import type { BatteryEventView, SwapEditInput, SwapEntry } from "@shared/station-work";
import { SwapSheetExport } from "@/components/station-work/swap-sheet";
import { Loaded, ResponsiveRows, Section, useWhen, useXof } from "./shared";

/** Swap log and counter history of one station over the period (owners and admins only). */
export function HistoryView({
  stationId,
  stationName,
  days,
  readOnly = false,
}: {
  stationId: string | null;
  stationName: string;
  days: ReportPeriod;
  /** Read-only operator account (migration 0070): everything to read, nothing to correct. */
  readOnly?: boolean;
}) {
  const { t } = useI18n();
  if (!stationId) return <EmptyState text={t.owner.history.pickStation} />;
  return (
    <div className="space-y-4">
      <Incidents stationId={stationId} readOnly={readOnly} />
      <SwapSheetExport key={stationId} stationId={stationId} stationName={stationName} pickDates />
      <Swaps stationId={stationId} days={days} readOnly={readOnly} />
      <CounterHistory stationId={stationId} days={days} />
    </div>
  );
}

/** Problems the staff reported: open ones first, each with "Mark handled" and an optional note. */
function Incidents({ stationId, readOnly }: { stationId: string; readOnly: boolean }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const x = t.work.incident;
  const { data, error, reload } = useLiveQuery(() => backend.stationIncidents(stationId), stationId);
  return (
    <Section title={x.ownerList}>
      <Loaded data={data} error={error} reload={reload}>
        {(incidents) =>
          incidents.length === 0 ? (
            <p className="text-sm text-gp-muted">{x.none}</p>
          ) : (
            <ul className="-mx-4 divide-y divide-gp-border">
              {incidents.map((i) => (
                <IncidentItem key={i.id} incident={i} action={i.status === "open" && !readOnly ? <ResolveIncident incident={i} onDone={reload} /> : undefined} />
              ))}
            </ul>
          )
        }
      </Loaded>
    </Section>
  );
}

function ResolveIncident({ incident, onDone }: { incident: Incident; onDone: () => void }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const x = t.work.incident;
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  async function resolve() {
    setBusy(true);
    try {
      await backend.resolveIncident(incident.stationId, incident.id, note.trim() || null);
      toast(x.resolved, { tone: "success" });
      onDone();
    } catch (err) {
      toast(errorMessage(err), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 pt-1">
      <Input className="min-w-0 flex-1" value={note} maxLength={500} placeholder={x.resolution} aria-label={x.resolution} onChange={(e) => setNote(e.target.value)} />
      <Button variant="secondary" disabled={busy} onClick={() => void resolve()}>
        {x.resolve}
      </Button>
    </div>
  );
}

function Swaps({ stationId, days, readOnly }: { stationId: string; days: ReportPeriod; readOnly: boolean }) {
  const { t } = useI18n();
  const { backend, profile } = useApp();
  const when = useWhen();
  const xof = useXof();
  const h = t.owner.history;
  const w = t.work.swap;
  const o = t.offline;
  // Offline swaps marked "to check" (0071), whatever their day, until someone marks them checked.
  const [toCheck, setToCheck] = useState(false);
  const { data, error, reload } = useLiveQuery(() => backend.stationSwaps(stationId, { days, toCheck }), `${stationId}:${days}:${toCheck}`);
  const [editing, setEditing] = useState<SwapEntry | null>(null);
  const [deleting, setDeleting] = useState<SwapEntry | null>(null);
  // Owners and admins see this page; a swap paid from Green Credit is deleted by an admin, who refunds it.
  // The battery numbers of the swap: handed out ↑, brought back ↓.
  const numbers = (s: SwapEntry) => [s.batteryOut ? `↑ ${s.batteryOut}` : null, s.batteryIn ? `↓ ${s.batteryIn}` : null].filter(Boolean).join("  ");
  const canDelete = (s: SwapEntry) => s.payment !== "wallet" || profile?.role === "admin";
  const stillToCheck = (s: SwapEntry) => !!s.review && !s.reviewedAt;
  const flags = (s: SwapEntry) =>
    s.offline || s.review ? (
      <span className="inline-flex flex-wrap gap-1">
        {s.offline && <Badge tone="blue">{o.offlineLabel}</Badge>}
        {stillToCheck(s) && s.review && (
          <Badge tone="amber">
            {o.reviewLabel} : {o.reviews[s.review]}
          </Badge>
        )}
      </span>
    ) : null;
  async function checked(s: SwapEntry) {
    await backend.markSwapChecked(s.stationId, s.id).catch(() => undefined);
    reload();
  }
  const actions = (s: SwapEntry) => readOnly ? null : (
    <span className="-my-2 inline-flex gap-1 whitespace-nowrap">
      {stillToCheck(s) && (
        <button
          type="button"
          onClick={() => void checked(s)}
          className="min-h-9 rounded-full px-3 text-sm font-semibold text-amber-800 hover:bg-amber-50 dark:text-amber-200 dark:hover:bg-amber-950/40"
        >
          {o.markChecked}
        </button>
      )}
      <button
        type="button"
        onClick={() => setEditing(s)}
        aria-label={format(h.edit.label, { when: when(s.createdAt) })}
        className="min-h-9 rounded-full px-3 text-sm font-semibold text-gp-green-dark hover:bg-gp-green/10 dark:text-gp-green"
      >
        {h.edit.button}
      </button>
      {canDelete(s) && (
        <button
          type="button"
          onClick={() => setDeleting(s)}
          aria-label={format(h.delete.label, { when: when(s.createdAt) })}
          className="min-h-9 rounded-full px-3 text-sm font-semibold text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40"
        >
          {h.delete.button}
        </button>
      )}
    </span>
  );
  return (
    <Section
      title={h.swaps}
      aside={
        <button
          type="button"
          aria-pressed={toCheck}
          onClick={() => setToCheck(!toCheck)}
          className={`min-h-9 rounded-full border px-3 text-sm font-semibold ${toCheck ? "border-amber-500 bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100" : "border-gp-border text-gp-muted dark:border-white/10"}`}
        >
          {o.toCheckFilter}
        </button>
      }
    >
      <Loaded data={data} error={error} reload={reload}>
        {(swaps) =>
          swaps.length === 0 ? (
            <p className="text-sm text-gp-muted">{h.noSwaps}</p>
          ) : (
            <ResponsiveRows<SwapEntry>
              rows={swaps}
              rowKey={(s) => s.id}
              card={(s) => (
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{w.customerTypes[s.customerType]}</span>
                    <span className="tabular-nums">{xof(s.amountXof)}</span>
                  </div>
                  <div className="text-gp-muted">
                    {[s.customer ?? s.driver ?? s.customerName ?? s.plate, w.payments[s.payment], s.batteryTypeLabel].filter(Boolean).join(" · ")}
                  </div>
                  {(s.batteryOut || s.batteryIn) && (
                    <div className="font-mono text-xs text-gp-muted">{numbers(s)}</div>
                  )}
                  {flags(s)}
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs tabular-nums text-gp-muted">
                      {when(s.createdAt)} · {s.person}
                    </span>
                    {actions(s)}
                  </div>
                </div>
              )}
              columns={[
                {
                  label: h.when,
                  cell: (s) => (
                    <span className="flex flex-col gap-1">
                      <span className="whitespace-nowrap tabular-nums">{when(s.createdAt)}</span>
                      {flags(s)}
                    </span>
                  ),
                },
                { label: h.type, cell: (s) => w.customerTypes[s.customerType] },
                { label: h.customer, cell: (s) => s.customer ?? s.driver ?? s.customerName ?? s.plate ?? "–" },
                { label: h.payment, cell: (s) => w.payments[s.payment] },
                { label: h.amount, cell: (s) => xof(s.amountXof), className: "text-right tabular-nums whitespace-nowrap" },
                { label: h.batteries, cell: (s) => <span className="whitespace-nowrap font-mono text-xs">{numbers(s) || "–"}</span> },
                { label: h.person, cell: (s) => s.person },
                ...(readOnly ? [] : [{ label: "", cell: actions, className: "text-right" }]),
              ]}
            />
          )
        }
      </Loaded>
      {editing && <EditSwap key={editing.id} swap={editing} onClose={() => setEditing(null)} onDone={reload} />}
      {deleting && <DeleteSwap key={deleting.id} swap={deleting} onClose={() => setDeleting(null)} onDone={reload} />}
    </Section>
  );
}

/** Correcting a swap: the walk-in customer's name, the plate, the amount, the Mobile Money id. */
function EditSwap({ swap, onClose, onDone }: { swap: SwapEntry; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const when = useWhen();
  const e = t.owner.history.edit;
  const walkIn = swap.customer === null && swap.driver === null;
  const [name, setName] = useState(swap.customerName ?? "");
  const [plate, setPlate] = useState(swap.plate ?? "");
  const [amount, setAmount] = useState(String(swap.amountXof));
  const [mmRef, setMmRef] = useState(swap.mmRef ?? "");
  const [busy, setBusy] = useState(false);
  async function save() {
    // Only what changed is sent.
    const input: SwapEditInput = {};
    if (walkIn && name.trim() !== (swap.customerName ?? "")) input.customerName = name;
    if (plate.trim() !== (swap.plate ?? "")) input.plate = plate;
    if (swap.payment !== "wallet" && Number(amount) !== swap.amountXof) input.amountXof = amount.trim() === "" ? -1 : Number(amount);
    if (swap.payment === "mobile_money" && mmRef.trim() !== (swap.mmRef ?? "")) input.mmRef = mmRef;
    if (Object.keys(input).length === 0) return onClose();
    setBusy(true);
    try {
      await backend.editSwap(swap.stationId, swap.id, input);
      toast(e.done, { tone: "success" });
      onClose();
      onDone();
    } catch (err) {
      toast(errorMessage(err), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <ConfirmSheet open title={format(e.title, { when: when(swap.createdAt) })} confirmLabel={e.save} busy={busy} onConfirm={() => void save()} onCancel={onClose}>
      <div className="space-y-3 text-sm">
        {walkIn && (
          <label className="block space-y-1">
            <span>{e.customerName}</span>
            <Input value={name} maxLength={80} autoComplete="off" onChange={(ev) => setName(ev.target.value)} />
          </label>
        )}
        <label className="block space-y-1">
          <span>{e.plate}</span>
          <Input value={plate} maxLength={20} autoComplete="off" onChange={(ev) => setPlate(ev.target.value)} />
        </label>
        {swap.payment === "wallet" ? (
          <p className="text-gp-muted">{e.creditNote}</p>
        ) : (
          <label className="block space-y-1">
            <span>{e.amount}</span>
            <Input type="number" inputMode="numeric" min={0} step={1} value={amount} onChange={(ev) => setAmount(ev.target.value)} />
          </label>
        )}
        {swap.payment === "mobile_money" && (
          <label className="block space-y-1">
            <span>{e.mmRef}</span>
            <Input value={mmRef} maxLength={40} autoComplete="off" onChange={(ev) => setMmRef(ev.target.value)} />
          </label>
        )}
        <p className="text-xs text-gp-muted">{e.keepNote}</p>
      </div>
    </ConfirmSheet>
  );
}

/** Deleting a swap recorded by mistake, asked first; its full battery goes back on the counter unless unticked. */
function DeleteSwap({ swap, onClose, onDone }: { swap: SwapEntry; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const when = useWhen();
  const xof = useXof();
  const d = t.owner.history.delete;
  const [restore, setRestore] = useState(true);
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    try {
      await backend.deleteSwap(swap.stationId, swap.id, restore);
      toast(d.done, { tone: "success" });
      onClose();
      onDone();
    } catch (err) {
      toast(errorMessage(err), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <ConfirmSheet open title={format(d.title, { when: when(swap.createdAt) })} confirmLabel={d.confirm} danger busy={busy} onConfirm={() => void confirm()} onCancel={onClose}>
      <div className="space-y-3 text-sm">
        <p>{d.body}</p>
        {swap.payment === "wallet" && <p className="font-medium">{format(d.refund, { amount: xof(swap.amountXof) })}</p>}
        <label className="flex items-start gap-3">
          <input type="checkbox" className="mt-0.5 size-5 accent-gp-green-dark" checked={restore} onChange={(ev) => setRestore(ev.target.checked)} />
          <span>
            {d.restore}
            <span className="block text-xs text-gp-muted">{d.restoreHint}</span>
          </span>
        </label>
      </div>
    </ConfirmSheet>
  );
}

function CounterHistory({ stationId, days }: { stationId: string; days: ReportPeriod }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const when = useWhen();
  const h = t.owner.history;
  const events = t.work.counter.events;
  const { data, error, reload } = useLiveQuery(() => backend.stationBatteryEvents(stationId, days), `${stationId}:${days}`);
  const delta = (e: BatteryEventView) => (e.delta > 0 ? `+${e.delta}` : String(e.delta));
  return (
    <Section title={h.counter}>
      <Loaded data={data} error={error} reload={reload}>
        {(rows) =>
          rows.length === 0 ? (
            <p className="text-sm text-gp-muted">{h.noEvents}</p>
          ) : (
            <ResponsiveRows<BatteryEventView>
              rows={rows}
              rowKey={(e) => e.id}
              card={(e) => (
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{events[e.type]}</span>
                    <span className="tabular-nums">{delta(e)}</span>
                  </div>
                  {e.reason && <div className="text-gp-muted">{e.reason}</div>}
                  <div className="text-xs tabular-nums text-gp-muted">
                    {when(e.createdAt)} · {e.person} · {h.after} {e.fullAfter}
                  </div>
                </div>
              )}
              columns={[
                { label: h.when, cell: (e) => <span className="whitespace-nowrap tabular-nums">{when(e.createdAt)}</span> },
                { label: h.type, cell: (e) => events[e.type] },
                { label: h.change, cell: delta, className: "text-right tabular-nums" },
                { label: h.after, cell: (e) => e.fullAfter, className: "text-right tabular-nums" },
                { label: h.reason, cell: (e) => e.reason ?? "–" },
                { label: h.person, cell: (e) => e.person },
              ]}
            />
          )
        }
      </Loaded>
    </Section>
  );
}
