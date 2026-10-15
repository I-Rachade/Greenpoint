"use client";

import { useEffect, useState } from "react";
import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { Button } from "@/components/ui";
import { effectiveReservationStatus } from "@/lib/admin/insights";
import { ADMIN_HISTORY_DAYS, ADMIN_PAGE_SIZE } from "@/lib/admin/types";
import { isHolding } from "@/lib/availability";
import { useErrorMessage, useLiveQuery, useNow } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import type { Reservation, ReservationStatus } from "@/lib/types";
import { field, indexSnapshot, Loading, Pill, StaleNotice, Table, td, th, useAdminSnapshot, useDateTime } from "./shared";

const STATUSES: ReservationStatus[] = ["active", "completed", "cancelled", "expired"];
const TONE = { active: "blue", completed: "green", cancelled: "gray", expired: "red" } as const;

/**
 * Reservations of the last ADMIN_HISTORY_DAYS days, filtered and paged on the server
 * (GET /api/admin/reservations, plan phase 8): a page of ADMIN_PAGE_SIZE and the total.
 * Cards on phones, a table from md up.
 */
export function ReservationsTable() {
  const { t } = useI18n();
  const formatDateTime = useDateTime();
  const { backend } = useApp();
  const now = useNow(15_000);
  const errorMessage = useErrorMessage();
  const { data: snap, error: snapError, reload: reloadSnap } = useAdminSnapshot();
  const [status, setStatus] = useState<ReservationStatus | "">("");
  const [stationId, setStationId] = useState("");
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Reservation | null>(null);
  const [busy, setBusy] = useState(false);

  // Searches once typing pauses, from the first page.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(typed.trim());
      setOffset(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [typed]);

  const query = { status: status || null, stationId: stationId || null, search: search || null, offset, limit: ADMIN_PAGE_SIZE };
  const { data: page, error, reload } = useLiveQuery(() => backend.adminReservations(query), JSON.stringify(query));

  if (!snap) return <Loading error={snapError} onRetry={reloadSnap} />;

  const b = t.backoffice.reservations;
  const idx = indexSnapshot(snap);
  const rows = page?.rows ?? [];
  const total = page?.total ?? 0;

  async function cancel() {
    if (!cancelling) return;
    setBusy(true);
    try {
      await backend.cancelReservation(cancelling.id);
      setMessage(null);
      setCancelling(null);
      reload();
    } catch (err) {
      setMessage(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const customer = (r: Reservation) => r.customer ?? r.userId.slice(0, 8);
  const cancelButton = (r: Reservation) =>
    isHolding(r, now) && (
      <Button variant="ghost" size="sm" className="min-h-11 text-red-600" onClick={() => setCancelling(r)}>
        {b.cancel}
      </Button>
    );

  return (
    <div className="space-y-4">
      <StaleNotice error={error ?? snapError} onRetry={reload} />
      <h1 className="text-2xl font-semibold">{format(b.title, { days: ADMIN_HISTORY_DAYS })}</h1>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className={`${field} min-h-11 text-base`}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as ReservationStatus | "");
            setOffset(0);
          }}
          aria-label={b.status}
        >
          <option value="">{b.all}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t.reservations.status[s]}
            </option>
          ))}
        </select>
        <select
          className={`${field} min-h-11 text-base`}
          value={stationId}
          onChange={(e) => {
            setStationId(e.target.value);
            setOffset(0);
          }}
          aria-label={b.station}
        >
          <option value="">{b.allStations}</option>
          {snap.stations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input className={`${field} min-h-11 text-base`} type="search" placeholder={b.search} aria-label={b.search} value={typed} onChange={(e) => setTyped(e.target.value)} />
        <span className="text-xs text-zinc-500" aria-live="polite">
          {format(b.count, { n: total })}
        </span>
      </div>
      {message && (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      )}
      {!page ? (
        <Loading error={error} onRetry={reload} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-zinc-500">{b.empty}</p>
      ) : (
        <>
          <ul className="space-y-2 md:hidden">
            {rows.map((r) => {
              const st = effectiveReservationStatus(r, now);
              return (
                <li key={r.id} className="space-y-1 rounded-xl border border-black/10 bg-white p-3 text-sm dark:border-white/10 dark:bg-zinc-900">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{customer(r)}</span>
                    <Pill tone={TONE[st]}>{t.reservations.status[st]}</Pill>
                  </div>
                  <div className="text-zinc-600 dark:text-zinc-400">
                    {idx.stationName(r.stationId)} · {r.type === "battery" ? t.reservations.battery : t.reservations.slot}
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs tabular-nums text-zinc-500">
                    <span>
                      {b.created} {formatDateTime(r.createdAt)} · {b.expires} {formatDateTime(r.expiresAt)}
                    </span>
                    {cancelButton(r)}
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="hidden md:block">
            <Table
              head={
                <>
                  <th className={th}>{b.created}</th>
                  <th className={th}>{b.user}</th>
                  <th className={th}>{b.station}</th>
                  <th className={th}>{b.type}</th>
                  <th className={th}>{b.status}</th>
                  <th className={th}>{b.expires}</th>
                  <th className={th} />
                </>
              }
            >
              {rows.map((r) => {
                const st = effectiveReservationStatus(r, now);
                return (
                  <tr key={r.id}>
                    <td className={`${td} whitespace-nowrap tabular-nums`}>{formatDateTime(r.createdAt)}</td>
                    <td className={td}>{customer(r)}</td>
                    <td className={td}>{idx.stationName(r.stationId)}</td>
                    <td className={td}>{r.type === "battery" ? t.reservations.battery : t.reservations.slot}</td>
                    <td className={td}>
                      <Pill tone={TONE[st]}>{t.reservations.status[st]}</Pill>
                    </td>
                    <td className={`${td} whitespace-nowrap tabular-nums`}>{formatDateTime(r.expiresAt)}</td>
                    <td className={`${td} text-right`}>{cancelButton(r)}</td>
                  </tr>
                );
              })}
            </Table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
              {format(b.range, { from: offset + 1, to: offset + rows.length, total })}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - ADMIN_PAGE_SIZE))}>
                {b.previous}
              </Button>
              <Button variant="secondary" disabled={offset + rows.length >= total} onClick={() => setOffset(offset + ADMIN_PAGE_SIZE)}>
                {b.next}
              </Button>
            </div>
          </div>
        </>
      )}
      <ConfirmSheet open={!!cancelling} title={b.confirmCancel} confirmLabel={b.cancel} cancelLabel={t.reservations.keep} danger busy={busy} onConfirm={cancel} onCancel={() => setCancelling(null)} />
    </div>
  );
}
