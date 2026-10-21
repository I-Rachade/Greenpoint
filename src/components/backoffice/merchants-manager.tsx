"use client";

import { useState } from "react";
import { useApp } from "@/components/app-provider";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { AssignmentRequestList, useClock, usePayLabel } from "@/components/drivers/driver-shops";
import { useI18n } from "@/components/i18n-provider";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import type { AdminMerchant, MerchantDecision, MerchantDriverStatus, MerchantMember, MerchantStatus } from "@/lib/merchants";
import { card, field, Loading, Pill, StaleNotice, useDateTime } from "./shared";

const button = "min-h-11 rounded-full bg-gp-green-dark px-4 text-sm text-white disabled:opacity-30";
const outline = "min-h-11 rounded-full border border-black/15 px-4 text-sm disabled:opacity-30 dark:border-white/20";

const STATUS_TONE: Record<MerchantStatus, "amber" | "green" | "red" | "gray"> = { pending: "amber", approved: "green", rejected: "red", suspended: "gray" };
const DRIVER_TONE: Record<MerchantDriverStatus, "amber" | "green" | "red" | "gray"> = { pending: "amber", active: "green", declined: "red", ended: "gray" };

function memberName(m: MerchantMember) {
  return m.fullName ?? m.phone ?? m.email ?? "?";
}

type Confirm = { kind: "decision"; action: MerchantDecision } | { kind: "remove"; member: MerchantMember } | null;

function MerchantCard({ merchant, onChanged, onMessage }: { merchant: AdminMerchant; onChanged: () => void; onMessage: (text: string, ok: boolean) => void }) {
  const { t } = useI18n();
  const a = t.merchantDrivers.admin;
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const dateTime = useDateTime();
  const clock = useClock();
  const pay = usePayLabel();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [owner, setOwner] = useState<string | null>(null);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
      onMessage(a.saved, true);
      onChanged();
      setOwner(null);
    } catch (err) {
      onMessage(errorMessage(err), false);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  }

  const review = (action: MerchantDecision) => act(() => backend.reviewMerchant(merchant.id, action));
  const pendingInvites = merchant.invites.filter((i) => i.status === "pending");
  const drivers = merchant.drivers.filter((d) => d.status !== "ended" && d.status !== "declined");
  const others = merchant.members.filter((m) => !m.isOwner);

  return (
    <div className={`${card} space-y-3`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{merchant.name}</h2>
        <Pill tone={STATUS_TONE[merchant.status]}>{a.status[merchant.status]}</Pill>
        <Pill tone={merchant.tier === "unlocked" ? "blue" : "gray"}>{a.tier[merchant.tier]}</Pill>
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {[merchant.contact, merchant.phone, format(a.since, { date: dateTime(merchant.createdAt) })].filter(Boolean).join(" · ")}
      </p>
      <p className="text-sm">{merchant.address}</p>
      <p className="text-sm">
        {merchant.employeeLimit === null ? format(a.noLimit, { used: merchant.used }) : format(a.employees, { used: merchant.used, limit: merchant.employeeLimit })}
      </p>

      <div className="space-y-1 text-sm">
        <h3 className="font-medium">{a.team}</h3>
        <ul className="divide-y divide-black/5 dark:divide-white/10">
          {merchant.members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center gap-2 py-1.5">
              <span className="flex-1">
                {memberName(m)}
                {m.phone && m.fullName ? <span className="text-xs text-zinc-500"> · {m.phone}</span> : null}
              </span>
              {m.isOwner ? (
                <Pill tone="green">{a.owner}</Pill>
              ) : (
                <button type="button" className="text-xs text-red-600 underline disabled:opacity-30" disabled={busy} onClick={() => setConfirm({ kind: "remove", member: m })}>
                  {a.removeEmployee}
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      {pendingInvites.length > 0 && (
        <div className="space-y-1 text-sm">
          <h3 className="font-medium">{a.invites}</h3>
          <ul className="divide-y divide-black/5 dark:divide-white/10">
            {pendingInvites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="flex-1">{i.phone}</span>
                <span className="text-xs text-zinc-500">{format(a.expiresOn, { date: dateTime(i.expiresAt) })}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-1 text-sm">
        <h3 className="font-medium">{a.drivers}</h3>
        {drivers.length === 0 ? (
          <p className="text-zinc-500">{a.noDrivers}</p>
        ) : (
          <ul className="divide-y divide-black/5 dark:divide-white/10">
            {drivers.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="flex-1">
                  {d.driverName}
                  {d.driverPhone ? <span className="text-xs text-zinc-500"> · {d.driverPhone}</span> : null}
                </span>
                <Pill tone={d.kind === "assigned" ? "blue" : "gray"}>{d.kind === "assigned" ? a.assigned : a.favorite}</Pill>
                {d.kind === "assigned" && <span className="text-xs">{pay(d.payMode, d.ratePerHourFcfa)}</span>}
                <Pill tone={DRIVER_TONE[d.status]}>{a.driverStatus[d.status]}</Pill>
                {d.checkedInSince && <span className="text-xs text-gp-green-dark dark:text-gp-green">{format(a.checkedInSince, { time: clock(d.checkedInSince) })}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>

      {owner !== null && (
        <div className="space-y-2 rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-800/50">
          <label className="block space-y-1">
            <span className="font-medium">{a.newOwner}</span>
            <select className={`${field} w-full`} value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">…</option>
              {others.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {memberName(m)}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-zinc-500">{a.changeOwnerHint}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={button} disabled={busy || !owner} onClick={() => act(() => backend.setMerchantOwner(merchant.id, owner))}>
              {a.saveOwner}
            </button>
            <button type="button" className={outline} disabled={busy} onClick={() => setOwner(null)}>
              {a.cancel}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(merchant.status === "pending" || merchant.status === "rejected") && (
          <button type="button" className={button} disabled={busy} onClick={() => review("approve")}>
            {a.approve}
          </button>
        )}
        {merchant.status === "pending" && (
          <button type="button" className={outline} disabled={busy} onClick={() => setConfirm({ kind: "decision", action: "reject" })}>
            {a.reject}
          </button>
        )}
        {merchant.status === "approved" && (
          <button type="button" className={outline} disabled={busy} onClick={() => setConfirm({ kind: "decision", action: "suspend" })}>
            {a.suspend}
          </button>
        )}
        {merchant.status === "suspended" && (
          <button type="button" className={button} disabled={busy} onClick={() => review("reactivate")}>
            {a.reactivate}
          </button>
        )}
        <button
          type="button"
          className={outline}
          disabled={busy}
          onClick={() => act(() => backend.setMerchantTier(merchant.id, merchant.tier === "unlocked" ? "standard" : "unlocked"))}
        >
          {merchant.tier === "unlocked" ? a.relock : a.unlock}
        </button>
        {others.length > 0 && owner === null && (
          <button type="button" className={outline} disabled={busy} onClick={() => setOwner("")}>
            {a.changeOwner}
          </button>
        )}
      </div>

      <ConfirmSheet
        open={confirm?.kind === "decision"}
        title={format(confirm?.kind === "decision" && confirm.action === "suspend" ? a.suspendTitle : a.rejectTitle, { name: merchant.name })}
        confirmLabel={confirm?.kind === "decision" && confirm.action === "suspend" ? a.suspend : a.reject}
        danger
        busy={busy}
        onConfirm={() => confirm?.kind === "decision" && review(confirm.action)}
        onCancel={() => setConfirm(null)}
      >
        {confirm?.kind === "decision" && confirm.action === "suspend" && <p>{a.suspendHint}</p>}
      </ConfirmSheet>
      <ConfirmSheet
        open={confirm?.kind === "remove"}
        title={format(a.removeTitle, { name: confirm?.kind === "remove" ? memberName(confirm.member) : "", shop: merchant.name })}
        confirmLabel={a.removeEmployee}
        danger
        busy={busy}
        onConfirm={() => confirm?.kind === "remove" && act(() => backend.adminRemoveMerchantEmployee(merchant.id, confirm.member.userId))}
        onCancel={() => setConfirm(null)}
      >
        <p>{a.removeHint}</p>
      </ConfirmSheet>
    </div>
  );
}

/** Backoffice: shops (merchants), approval, tier, team and drivers, and shop assignments to approve. */
export function MerchantsManager() {
  const { t } = useI18n();
  const a = t.merchantDrivers.admin;
  const { backend } = useApp();
  const { data, error, reload } = useLiveQuery(() => Promise.all([backend.adminMerchants(), backend.merchantAssignmentRequests()]));
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  if (!data) return <Loading error={error} onRetry={reload} />;
  const [merchants, requests] = data;
  const onMessage = (text: string, ok: boolean) => setMessage({ text, ok });

  return (
    <div className="space-y-6">
      <StaleNotice error={error} onRetry={reload} />
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{a.title}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{a.intro}</p>
      </div>
      {message && (
        <p role="status" className={`text-sm ${message.ok ? "text-gp-green-dark dark:text-gp-green" : "text-red-600"}`}>
          {message.text}
        </p>
      )}
      <section className={`${card} space-y-3`}>
        <h2 className="text-lg font-semibold">{a.approvals}</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{a.approvalsHint}</p>
        {requests.length === 0 ? <p className="text-sm text-zinc-500">{a.noApprovals}</p> : <AssignmentRequestList requests={requests} showDriver />}
      </section>
      {merchants.length === 0 ? (
        <p className="text-sm text-zinc-500">{a.none}</p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {merchants.map((m) => (
            <MerchantCard key={m.id} merchant={m} onChanged={reload} onMessage={onMessage} />
          ))}
        </div>
      )}
    </div>
  );
}
