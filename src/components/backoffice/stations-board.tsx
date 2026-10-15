"use client";

import { useState } from "react";
import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import { isDeviceSilent, statusAgeHours, STALE_STATUS_HOURS } from "@/lib/admin/insights";
import { offersCharging, offersSwap } from "@/lib/availability";
import { useErrorMessage, useNow, useRelativeTime } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { card, indexSnapshot, Loading, Pill, StaleNotice, Table, td, th, useAdminSnapshot, userLabel } from "./shared";
import { SolarBadge } from "../solar-badge";

/** Live status of every station (including deactivated ones), staff and connected sockets. */
export function StationsBoard() {
  const { t } = useI18n();
  const { backend } = useApp();
  const now = useNow(30_000);
  const relativeTime = useRelativeTime();
  const errorMessage = useErrorMessage();
  const { data: snap, error, reload } = useAdminSnapshot();
  const [message, setMessage] = useState<string | null>(null);
  if (!snap) return <Loading error={error} onRetry={reload} />;

  const b = t.backoffice.stations;
  const idx = indexSnapshot(snap);

  async function toggle(id: string, name: string, active: boolean) {
    if (!active && !window.confirm(format(b.confirmDeactivate, { station: name }))) return;
    try {
      await backend.setStationActive(id, active);
      setMessage(null);
      reload();
    } catch (err) {
      setMessage(errorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <StaleNotice error={error} onRetry={reload} />
      <h1 className="text-2xl font-semibold">{b.title}</h1>
      {message && (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      )}
      <Table
        head={
          <>
            <th className={th}>{b.station}</th>
            <th className={th}>{b.status}</th>
            <th className={th}>{b.slots}</th>
            <th className={th}>{b.batteries}</th>
            <th className={th}>{b.held}</th>
            <th className={th}>{b.updated}</th>
            <th className={th}>{b.staff}</th>
            <th className={th} />
          </>
        }
      >
        {snap.stations.map((s) => {
          const stale = s.isActive && s.kind !== "parcel" && s.status.isOpen && statusAgeHours(s, now) >= STALE_STATUS_HOURS;
          const staff = snap.staff.filter((a) => a.stationId === s.id);
          return (
            <tr key={s.id} className={s.isActive ? "" : "opacity-60"}>
              <td className={td}>
                <div className="flex items-center gap-1 font-medium">
                  {s.name}
                  {s.isSolar && <SolarBadge compact />}
                </div>
                <div className="text-xs text-zinc-500">{s.operatorName}</div>
              </td>
              <td className={td}>
                {!s.isActive ? (
                  <Pill tone="gray">{b.inactive}</Pill>
                ) : s.status.isOpen ? (
                  <Pill tone="green">{t.operator.open}</Pill>
                ) : (
                  <Pill tone="red">{t.operator.closed}</Pill>
                )}
              </td>
              <td className={`${td} tabular-nums`}>
                {offersCharging(s.kind) ? `${s.status.freeSlots} / ${s.chargingSlots}` : "–"}
              </td>
              <td className={`${td} tabular-nums`}>
                {offersSwap(s.kind) ? `${s.status.fullBatteries} / ${s.batteryCapacity}` : "–"}
              </td>
              <td className={`${td} tabular-nums`}>{s.reservedSlots + s.reservedBatteries}</td>
              <td className={td}>
                <span className={stale ? "font-medium text-amber-600" : ""}>{relativeTime(s.status.updatedAt, now)}</span>
              </td>
              <td className={`${td} text-xs`}>
                {staff.length === 0 ? "–" : staff.map((a) => userLabel(idx.user(a.userId), a.userId.slice(0, 8))).join(", ")}
              </td>
              <td className={`${td} text-right`}>
                <button
                  type="button"
                  onClick={() => toggle(s.id, s.name, !s.isActive)}
                  className="whitespace-nowrap text-sm text-gp-green-dark hover:underline"
                >
                  {s.isActive ? b.deactivate : b.activate}
                </button>
              </td>
            </tr>
          );
        })}
      </Table>

      <section className={card}>
        <h2 className="mb-2 text-sm font-semibold">{b.points}</h2>
        {snap.chargingPoints.filter((p) => p.deviceId).length === 0 ? (
          <p className="text-sm text-zinc-500">{b.noPoints}</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {snap.chargingPoints
              .filter((p) => p.deviceId)
              .map((p) => {
                const silent = isDeviceSilent(p, now);
                return (
                  <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg border border-black/10 px-3 py-2 text-sm dark:border-white/10">
                    <div className="min-w-0">
                      <div className="font-medium">
                        {idx.stationName(p.stationId)} · {p.label}
                      </div>
                      <div className="text-xs text-zinc-500">
                        {b.lastSeen}: {p.lastSeenAt ? relativeTime(p.lastSeenAt, now) : b.never}
                      </div>
                    </div>
                    {silent ? (
                      <Pill tone="red">{b.silent}</Pill>
                    ) : (
                      <Pill tone={p.status === "fault" ? "red" : p.status === "free" ? "green" : "blue"}>{p.status}</Pill>
                    )}
                  </li>
                );
              })}
          </ul>
        )}
      </section>
    </div>
  );
}
