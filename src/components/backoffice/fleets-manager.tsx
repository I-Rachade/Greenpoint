"use client";

import { useState } from "react";
import { useApp } from "@/components/app-provider";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { useI18n } from "@/components/i18n-provider";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import type { AdminFleet, FleetStatus } from "@shared/fleet";
import { card, Loading, Pill, StaleNotice, useDateTime } from "./shared";

const button = "min-h-11 rounded-full bg-gp-green-dark px-4 text-sm text-white disabled:opacity-30";
const outline = "min-h-11 rounded-full border border-black/15 px-4 text-sm disabled:opacity-30 dark:border-white/20";

const STATUS_TONE: Record<FleetStatus, "amber" | "green" | "red"> = { pending: "amber", approved: "green", rejected: "red" };

function FleetCard({ fleet, onChanged, onMessage }: { fleet: AdminFleet; onChanged: () => void; onMessage: (text: string, ok: boolean) => void }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const dateTime = useDateTime();
  const [busy, setBusy] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      onMessage(t.fleet.admin.saved, true);
      onChanged();
    } catch (err) {
      onMessage(errorMessage(err), false);
    } finally {
      setBusy(false);
      setConfirmReject(false);
    }
  }

  const pendingInvites = fleet.invites.filter((i) => i.status === "pending");

  return (
    <div className={`${card} space-y-3`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{fleet.name}</h2>
        <Pill tone={STATUS_TONE[fleet.status]}>{t.fleet.admin.status[fleet.status]}</Pill>
        <Pill tone={fleet.tier === "unlocked" ? "blue" : "gray"}>{t.fleet.tier[fleet.tier]}</Pill>
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {[fleet.contact, format(t.fleet.admin.since, { date: dateTime(fleet.createdAt) })].filter(Boolean).join(" · ")}
      </p>
      <p className="text-sm">
        {fleet.driverLimit === null
          ? format(t.fleet.noLimit, { used: fleet.used })
          : format(t.fleet.limitCounter, { used: fleet.used, limit: fleet.driverLimit })}
      </p>

      {fleet.drivers.length > 0 && (
        <div className="space-y-1 text-sm">
          <h3 className="font-medium">{t.fleet.admin.drivers}</h3>
          <ul className="divide-y divide-black/5 dark:divide-white/10">
            {fleet.drivers.map((d) => (
              <li key={d.userId} className="flex items-center gap-2 py-1.5">
                <span className="flex-1">{d.fullName}</span>
                <Pill tone={d.status === "active" ? "green" : d.status === "pending" ? "amber" : "red"}>{t.fleet.driverStatus[d.status]}</Pill>
              </li>
            ))}
          </ul>
        </div>
      )}

      {pendingInvites.length > 0 && (
        <div className="space-y-1 text-sm">
          <h3 className="font-medium">{t.fleet.admin.invites}</h3>
          <ul className="divide-y divide-black/5 dark:divide-white/10">
            {pendingInvites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="flex-1">{i.phone}</span>
                <span className="text-xs text-zinc-500">{format(t.fleet.expiresOn, { date: dateTime(i.expiresAt) })}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {fleet.status === "pending" && (
          <>
            <button type="button" className={button} disabled={busy} onClick={() => act(() => backend.reviewFleet(fleet.managerId, "approve"))}>
              {t.fleet.admin.approve}
            </button>
            <button type="button" className={outline} disabled={busy} onClick={() => setConfirmReject(true)}>
              {t.fleet.admin.reject}
            </button>
          </>
        )}
        {fleet.status === "rejected" && (
          <button type="button" className={button} disabled={busy} onClick={() => act(() => backend.reviewFleet(fleet.managerId, "approve"))}>
            {t.fleet.admin.approve}
          </button>
        )}
        <button
          type="button"
          className={outline}
          disabled={busy}
          onClick={() => act(() => backend.setFleetTier(fleet.managerId, fleet.tier === "unlocked" ? "standard" : "unlocked"))}
        >
          {fleet.tier === "unlocked" ? t.fleet.admin.relock : t.fleet.admin.unlock}
        </button>
      </div>

      <ConfirmSheet
        open={confirmReject}
        title={format(t.fleet.admin.rejectTitle, { name: fleet.name })}
        confirmLabel={t.fleet.admin.reject}
        danger
        busy={busy}
        onConfirm={() => act(() => backend.reviewFleet(fleet.managerId, "reject"))}
        onCancel={() => setConfirmReject(false)}
      />
    </div>
  );
}

/** Backoffice: fleets (self-registered fleet managers), approval and tier. */
export function FleetsManager() {
  const { t } = useI18n();
  const { backend } = useApp();
  const { data, error, reload } = useLiveQuery(() => backend.adminFleets());
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  if (!data) return <Loading error={error} onRetry={reload} />;
  const onMessage = (text: string, ok: boolean) => setMessage({ text, ok });

  return (
    <div className="space-y-6">
      <StaleNotice error={error} onRetry={reload} />
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t.fleet.admin.title}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.fleet.admin.intro}</p>
      </div>
      {message && (
        <p role="status" className={`text-sm ${message.ok ? "text-gp-green-dark dark:text-gp-green" : "text-red-600"}`}>
          {message.text}
        </p>
      )}
      {data.length === 0 ? (
        <p className="text-sm text-zinc-500">{t.fleet.admin.none}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.map((f) => (
            <FleetCard key={f.managerId} fleet={f} onChanged={reload} onMessage={onMessage} />
          ))}
        </div>
      )}
    </div>
  );
}
