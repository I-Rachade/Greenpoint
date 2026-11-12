"use client";

import { useMemo, useState } from "react";
import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import { effectiveReservationStatus } from "@/lib/admin/insights";
import { ADMIN_PAGE_SIZE, type AdminUser } from "@shared/admin/types";
import { Button } from "@/components/ui";
import { useErrorMessage, useNow, useRelativeTime } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import type { UserRole } from "@shared/types";
import { field, indexSnapshot, Loading, StaleNotice, Table, td, th, useAdminSnapshot, useDateTime, userContact, userLabel } from "./shared";

const ROLES: UserRole[] = ["customer", "operator", "fleet_manager", "admin"];
/** Driver accounts come and go through the driver backoffice (approve, release), not this list. */
const FILTER_ROLES: UserRole[] = [...ROLES, "driver", "merchant"];

/** Users with their role, assigned stations, last login and reservation behaviour. */
export function UsersTable() {
  const { t } = useI18n();
  const formatDateTime = useDateTime();
  const { backend, profile } = useApp();
  const now = useNow(60_000);
  const relativeTime = useRelativeTime();
  const errorMessage = useErrorMessage();
  const { data: snap, error, reload } = useAdminSnapshot();
  const [role, setRole] = useState<UserRole | "">("");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  // Stations and reservations by person, counted once instead of once per row.
  const byUser = useMemo(() => {
    const staff = new Map<string, Set<string>>();
    const reservations = new Map<string, NonNullable<typeof snap>["reservations"]>();
    for (const a of snap?.staff ?? []) staff.set(a.userId, (staff.get(a.userId) ?? new Set()).add(a.stationId));
    for (const r of snap?.reservations ?? []) reservations.set(r.userId, [...(reservations.get(r.userId) ?? []), r]);
    return { staff, reservations };
  }, [snap]);
  if (!snap) return <Loading error={error} onRetry={reload} />;

  const b = t.backoffice.users;
  const idx = indexSnapshot(snap);
  const needle = search.trim().toLowerCase();
  const users = snap.users.filter(
    (u) => (!role || u.role === role) && (!needle || userLabel(u).toLowerCase().includes(needle)),
  );
  // One page of ADMIN_PAGE_SIZE rows on screen: a long list stays quick on a small laptop.
  const from = offset < users.length ? offset : 0;
  const page = users.slice(from, from + ADMIN_PAGE_SIZE);

  /** A new filter starts again from the first page. */
  function filter(change: () => void) {
    change();
    setOffset(0);
  }

  async function run(action: () => Promise<void>) {
    try {
      await action();
      setMessage(null);
      reload();
    } catch (err) {
      setMessage(errorMessage(err));
    }
  }

  function changeRole(user: AdminUser, next: UserRole) {
    if (next === user.role) return;
    if (!window.confirm(format(b.confirmRole, { user: userLabel(user), role: t.roles[next] }))) return;
    void run(() => backend.setUserRole(user.id, next));
  }

  return (
    <div className="space-y-4">
      <StaleNotice error={error} onRetry={reload} />
      <h1 className="text-2xl font-semibold">{b.title}</h1>
      <div className="flex flex-wrap items-center gap-2">
        <select className={field} value={role} onChange={(e) => filter(() => setRole(e.target.value as UserRole | ""))} aria-label={b.role}>
          <option value="">{b.allRoles}</option>
          {FILTER_ROLES.map((r) => (
            <option key={r} value={r}>
              {t.roles[r]}
            </option>
          ))}
        </select>
        <input className={field} type="search" placeholder={b.search} aria-label={b.search} value={search} onChange={(e) => filter(() => setSearch(e.target.value))} />
        <span className="text-xs text-zinc-500">{format(b.count, { n: users.length })}</span>
      </div>
      {message && (
        <p role="alert" className="text-sm text-red-600">
          {message}
        </p>
      )}
      <Table
        head={
          <>
            <th className={th}>{b.phone}</th>
            <th className={th}>{b.role}</th>
            <th className={th}>{b.stations}</th>
            <th className={th}>{b.reservations}</th>
            <th className={th}>{b.noShows}</th>
            <th className={th}>{b.lastLogin}</th>
            <th className={th}>{b.created}</th>
          </>
        }
      >
        {page.map((u) => {
          const isSelf = u.id === profile?.id;
          const mine = byUser.staff.get(u.id);
          const assigned = snap.staff.filter((a) => a.userId === u.id && mine?.has(a.stationId));
          const unassigned = snap.stations.filter((s) => !mine?.has(s.id));
          const reservations = byUser.reservations.get(u.id) ?? [];
          const noShows = reservations.filter((r) => effectiveReservationStatus(r, now) === "expired").length;
          return (
            <tr key={u.id}>
              <td className={td}>
                <div className="font-medium tabular-nums break-all">{userContact(u)}</div>
                <div className="text-xs text-zinc-500">
                  {u.fullName}
                  {isSelf && ` (${b.self})`}
                </div>
              </td>
              <td className={td}>
                <select
                  className={field}
                  value={u.role}
                  disabled={isSelf || u.role === "driver"}
                  aria-label={`${b.role} ${userContact(u)}`}
                  onChange={(e) => changeRole(u, e.target.value as UserRole)}
                >
                  {(u.role === "driver" ? FILTER_ROLES : ROLES).map((r) => (
                    <option key={r} value={r}>
                      {t.roles[r]}
                    </option>
                  ))}
                </select>
              </td>
              <td className={td}>
                <div className="flex flex-wrap items-center gap-1">
                  {assigned.map((a) => (
                    <span key={a.stationId} className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs dark:bg-zinc-800">
                      {idx.stationName(a.stationId)}
                      <button
                        type="button"
                        aria-label={format(b.unassign, { station: idx.stationName(a.stationId) })}
                        title={format(b.unassign, { station: idx.stationName(a.stationId) })}
                        onClick={() => run(() => backend.unassignStaff(a.stationId, u.id))}
                        className="text-zinc-500 hover:text-red-600"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  {unassigned.length > 0 && (
                    <select
                      className="rounded-lg border border-dashed border-black/20 bg-transparent px-2 py-0.5 text-xs dark:border-white/20"
                      value=""
                      aria-label={`${b.assign} ${userContact(u)}`}
                      onChange={(e) => e.target.value && run(() => backend.assignStaff(e.target.value, u.id))}
                    >
                      <option value="">{b.assign}</option>
                      {unassigned.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </td>
              <td className={`${td} tabular-nums`}>{reservations.length}</td>
              <td className={`${td} tabular-nums ${noShows >= 2 ? "font-medium text-amber-600" : ""}`}>{noShows}</td>
              <td className={`${td} whitespace-nowrap`}>{u.lastSignInAt ? relativeTime(u.lastSignInAt, now) : b.never}</td>
              <td className={`${td} whitespace-nowrap tabular-nums`}>{formatDateTime(u.createdAt)}</td>
            </tr>
          );
        })}
      </Table>
      {users.length > ADMIN_PAGE_SIZE && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
            {format(b.range, { from: from + 1, to: from + page.length, total: users.length })}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={from === 0} onClick={() => setOffset(Math.max(0, from - ADMIN_PAGE_SIZE))}>
              {b.previous}
            </Button>
            <Button variant="secondary" disabled={from + page.length >= users.length} onClick={() => setOffset(from + ADMIN_PAGE_SIZE)}>
              {b.next}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
