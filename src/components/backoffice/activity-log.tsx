"use client";

import { useState } from "react";
import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import { AUDIT_TABLES, type AuditEntry, type AuditFilter, type AuditTable } from "@/lib/admin/types";
import { useLiveQuery } from "@/lib/hooks";
import { field, indexSnapshot, Loading, Pill, Table, td, th, useAdminSnapshot, userLabel, useDateTime } from "./shared";

const PAGE = 100;
const TONE = { insert: "green", update: "blue", delete: "red" } as const;

function show(value: unknown): string {
  if (value === null || value === undefined) return "∅";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** `{column: [old, new]}` (update) or the row (insert/delete) as short lines, without ids. */
function details(entry: AuditEntry): string[] {
  return Object.entries(entry.changes)
    .filter(([key]) => key !== "id" && !key.endsWith("_id"))
    .slice(0, 8)
    .map(([key, value]) =>
      entry.action === "update" && Array.isArray(value) && value.length === 2
        ? `${key}: ${show(value[0])} → ${show(value[1])}`
        : `${key}: ${show(value)}`,
    );
}

/** Who changed what and when (the audit log written by the database). */
export function ActivityLog() {
  const { t } = useI18n();
  const formatDateTime = useDateTime();
  const { backend } = useApp();
  const { data: snap, error: snapError } = useAdminSnapshot();
  const [table, setTable] = useState<AuditTable | "">("");
  const [stationId, setStationId] = useState("");
  const [actorId, setActorId] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const filter: AuditFilter = {
    table: table || undefined,
    stationId: stationId || undefined,
    actorId: actorId || undefined,
    limit,
  };
  const { data: entries, error } = useLiveQuery(() => backend.auditLog(filter), JSON.stringify(filter));
  if (!snap || !entries) return <Loading error={snapError ?? error} />;

  const b = t.backoffice.activity;
  const idx = indexSnapshot(snap);
  const actors = snap.users.filter((u) => u.role !== "rider");
  const resetPage = () => setLimit(PAGE);

  function subject(e: AuditEntry): string {
    const station = e.stationId ? idx.stationName(e.stationId) : "";
    const user = e.userId ? userLabel(idx.user(e.userId), e.userId.slice(0, 8)) : "";
    if (e.table === "station_staff") {
      return `${user} ${e.action === "delete" ? b.staffRemoved : b.staffAdded} ${station}`;
    }
    return [station, user].filter(Boolean).join(" · ");
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{b.title}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{b.intro}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <select
          className={field}
          value={table}
          aria-label={b.what}
          onChange={(e) => {
            setTable(e.target.value as AuditTable | "");
            resetPage();
          }}
        >
          <option value="">{b.allTables}</option>
          {AUDIT_TABLES.map((tb) => (
            <option key={tb} value={tb}>
              {b.tables[tb]}
            </option>
          ))}
        </select>
        <select
          className={field}
          value={stationId}
          aria-label={t.backoffice.stations.station}
          onChange={(e) => {
            setStationId(e.target.value);
            resetPage();
          }}
        >
          <option value="">{b.allStations}</option>
          {snap.stations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select
          className={field}
          value={actorId}
          aria-label={b.who}
          onChange={(e) => {
            setActorId(e.target.value);
            resetPage();
          }}
        >
          <option value="">{b.allActors}</option>
          {actors.map((u) => (
            <option key={u.id} value={u.id}>
              {userLabel(u)} · {t.roles[u.role]}
            </option>
          ))}
        </select>
      </div>
      {entries.length === 0 ? (
        <p className="text-sm text-zinc-500">{b.empty}</p>
      ) : (
        <Table
          head={
            <>
              <th className={th}>{b.when}</th>
              <th className={th}>{b.who}</th>
              <th className={th}>{b.what}</th>
              <th className={th}>{b.details}</th>
            </>
          }
        >
          {entries.map((e) => {
            const actor = idx.user(e.actorId);
            return (
              <tr key={e.id}>
                <td className={`${td} whitespace-nowrap tabular-nums`}>{formatDateTime(e.at)}</td>
                <td className={td}>
                  {e.actorId ? (
                    <>
                      <div>{userLabel(actor, e.actorId.slice(0, 8))}</div>
                      {actor && <div className="text-xs text-zinc-500">{t.roles[actor.role]}</div>}
                    </>
                  ) : (
                    <span className="text-zinc-500">{b.system}</span>
                  )}
                </td>
                <td className={td}>
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="font-medium">{b.tables[e.table]}</span>
                    <Pill tone={TONE[e.action]}>{b.actions[e.action]}</Pill>
                  </div>
                  <div className="text-xs text-zinc-500">{subject(e)}</div>
                </td>
                <td className={`${td} font-mono text-xs`}>
                  {details(e).map((line, i) => (
                    <div key={i}>{line}</div>
                  ))}
                </td>
              </tr>
            );
          })}
        </Table>
      )}
      {entries.length >= limit && (
        <button
          type="button"
          onClick={() => setLimit(limit + PAGE)}
          className="rounded-full border border-black/15 px-4 py-2 text-sm dark:border-white/20"
        >
          {b.loadMore}
        </button>
      )}
    </div>
  );
}
