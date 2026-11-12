"use client";

import { useState } from "react";
import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { SECURITY_EVENT_KINDS, type LockedAccount, type SecurityEventKind } from "@shared/security";
import { card, Loading, Pill, StaleNotice, Table, td, th, useAdminSnapshot, useDateTime, userLabel, indexSnapshot } from "./shared";

/** How each kind of event shows in the log. */
const TONE: Record<SecurityEventKind, "red" | "amber" | "gray" | "green" | "blue"> = {
  pin_failed: "amber",
  pin_locked: "red",
  captcha_failed: "amber",
  ip_limited: "blue",
  api_limited: "blue",
  partner_limited: "blue",
  alarm: "red",
  unlocked: "green",
};

/** Locked accounts with Unlock, the figures of the last 24 hours and the security log (worker/security.ts). */
export function SecurityManager() {
  const { t } = useI18n();
  const { backend } = useApp();
  const formatDateTime = useDateTime();
  const errorMessage = useErrorMessage();
  const { data, error, reload } = useLiveQuery(() => backend.adminSecurity());
  const { data: snap } = useAdminSnapshot();
  const [message, setMessage] = useState<string | null>(null);
  if (!data) return <Loading error={error} onRetry={reload} />;

  const b = t.backoffice.security;
  const idx = snap ? indexSnapshot(snap) : null;
  const account = (userId: string | null) => (userId ? userLabel(idx?.user(userId), userId.slice(0, 8)) : "");
  const lockedLabel = (a: LockedAccount) => userLabel(a, a.userId.slice(0, 8));

  async function unlock(a: LockedAccount) {
    if (!window.confirm(format(b.confirmUnlock, { user: lockedLabel(a) }))) return;
    try {
      await backend.unlockAccount(a.userId);
      setMessage(null);
      reload();
    } catch (err) {
      setMessage(errorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <StaleNotice error={error} onRetry={reload} />
      <div>
        <h1 className="text-2xl font-semibold">{b.title}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{b.intro}</p>
      </div>
      {!data.captchaOn && <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">{b.captchaOff}</p>}
      {data.alarm && <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">{b.alarm}</p>}
      {message && (
        <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {message}
        </p>
      )}

      <section className={card}>
        <h2 className="mb-2 text-sm font-semibold">{b.last24h}</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {SECURITY_EVENT_KINDS.map((kind) => (
            <div key={kind}>
              <dt className="text-xs text-zinc-500">{b.kinds[kind]}</dt>
              <dd className="text-xl font-semibold tabular-nums">{data.last24h[kind] ?? 0}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{b.locked}</h2>
        {data.locked.length === 0 ? (
          <p className="text-sm text-zinc-500">{b.noneLocked}</p>
        ) : (
          <Table
            head={
              <>
                <th className={th}>{b.who}</th>
                <th className={th}>{b.lockedUntil}</th>
                <th className={th}>{b.lockCount}</th>
                <th className={th} />
              </>
            }
          >
            {data.locked.map((a) => (
              <tr key={a.userId}>
                <td className={td}>{lockedLabel(a)}</td>
                <td className={`${td} whitespace-nowrap tabular-nums`}>{formatDateTime(a.lockedUntil)}</td>
                <td className={`${td} tabular-nums`}>{a.lockCount}</td>
                <td className={`${td} text-right`}>
                  <button type="button" onClick={() => void unlock(a)} className="rounded-full border border-black/15 px-3 py-1 text-sm dark:border-white/20">
                    {b.unlock}
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      {data.topIps.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-semibold">{b.topIps}</h2>
          <ul className="flex flex-wrap gap-2 text-sm">
            {data.topIps.map((r) => (
              <li key={r.ip} className="rounded-full bg-zinc-100 px-3 py-1 font-mono text-xs dark:bg-zinc-800">
                {r.ip} · {r.count}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{b.events}</h2>
        {data.events.length === 0 ? (
          <p className="text-sm text-zinc-500">{b.noEvents}</p>
        ) : (
          <Table
            head={
              <>
                <th className={th}>{b.when}</th>
                <th className={th}>{b.what}</th>
                <th className={th}>{b.who}</th>
                <th className={th}>{b.ip}</th>
                <th className={th}>{b.detail}</th>
              </>
            }
          >
            {data.events.map((e) => (
              <tr key={e.id}>
                <td className={`${td} whitespace-nowrap tabular-nums`}>{formatDateTime(e.at)}</td>
                <td className={td}>
                  <Pill tone={TONE[e.kind] ?? "gray"}>{b.kinds[e.kind] ?? e.kind}</Pill>
                </td>
                <td className={td}>{account(e.userId)}</td>
                <td className={`${td} font-mono text-xs`}>{e.ip ?? ""}</td>
                <td className={`${td} font-mono text-xs`}>{e.kind === "unlocked" ? account(e.detail) : (e.detail ?? "")}</td>
              </tr>
            ))}
          </Table>
        )}
      </section>
    </div>
  );
}
