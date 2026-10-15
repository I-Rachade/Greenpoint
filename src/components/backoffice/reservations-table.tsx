"use client";

import { useState } from "react";
import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import { effectiveReservationStatus } from "@/lib/admin/insights";
import { ADMIN_HISTORY_DAYS } from "@/lib/admin/types";
import { isHolding } from "@/lib/availability";
import { useErrorMessage, useNow } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import type { ReservationStatus } from "@/lib/types";
import { field, indexSnapshot, Loading, Pill, StaleNotice, Table, td, th, useAdminSnapshot, useDateTime, userLabel } from "./shared";

const STATUSES: ReservationStatus[] = ["active", "completed", "cancelled", "expired"];
const TONE = { active: "blue", completed: "green", cancelled: "gray", expired: "red" } as const;

export function ReservationsTable() {
  const { t } = useI18n();
  const formatDateTime = useDateTime();
  const { backend } = useApp();
  const now = useNow(15_000);
  const errorMessage = useErrorMessage();
  const { data: snap, error, reload } = useAdminSnapshot();
  const [status, setStatus] = useState<ReservationStatus | "">("");
  const [stationId, setStationId] = useState("");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  if (!snap) return <Loading error={error} onRetry={reload} />;

  const b = t.backoffice.reservations;
  const idx = indexSnapshot(snap);
  const needle = search.trim().toLowerCase();
  const rows = snap.reservations.filter((r) => {
    if (status && effectiveReservationStatus(r, now) !== status) return false;
    if (stationId && r.stationId !== stationId) return false;
    if (needle && !userLabel(idx.user(r.userId), "").toLowerCase().includes(needle)) return false;
    return true;
  });

  async function cancel(id: string) {
    if (!window.confirm(b.confirmCancel)) return;
    try {
      await backend.cancelReservation(id);
      setMessage(null);
      reload();
    } catch (err) {
      setMessage(errorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <StaleNotice error={error} onRetry={reload} />
      <h1 className="text-2xl font-semibold">{format(b.title, { days: ADMIN_HISTORY_DAYS })}</h1>
      <div className="flex flex-wrap items-center gap-2">
        <select className={field} value={status} onChange={(e) => setStatus(e.target.value as ReservationStatus | "")} aria-label={b.status}>
          <option value="">{b.all}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t.reservations.status[s]}
            </option>
          ))}
        </select>
        <select className={field} value={stationId} onChange={(e) => setStationId(e.target.value)} aria-label={b.station}>
          <option value="">{b.allStations}</option>
          {snap.stations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input className={field} type="search" placeholder={b.search} aria-label={b.search} value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="text-xs text-zinc-500">{format(b.count, { n: rows.length })}</span>
      </div>
      {message && (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500">{b.empty}</p>
      ) : (
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
          {rows.slice(0, 300).map((r) => {
            const st = effectiveReservationStatus(r, now);
            return (
              <tr key={r.id}>
                <td className={`${td} whitespace-nowrap tabular-nums`}>{formatDateTime(r.createdAt)}</td>
                <td className={td}>{userLabel(idx.user(r.userId), r.userId.slice(0, 8))}</td>
                <td className={td}>{idx.stationName(r.stationId)}</td>
                <td className={td}>{r.type === "battery" ? t.reservations.battery : t.reservations.slot}</td>
                <td className={td}>
                  <Pill tone={TONE[st]}>{t.reservations.status[st]}</Pill>
                </td>
                <td className={`${td} whitespace-nowrap tabular-nums`}>{formatDateTime(r.expiresAt)}</td>
                <td className={`${td} text-right`}>
                  {isHolding(r, now) && (
                    <button type="button" onClick={() => cancel(r.id)} className="text-sm text-red-600 hover:underline">
                      {b.cancel}
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </div>
  );
}
