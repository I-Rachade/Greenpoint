"use client";

import { useState, type ComponentType, type SVGProps } from "react";
import type { DeliveryJob, JobStatus } from "@/lib/drivers";
import { useLiveQuery, useNow } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import type { CheckoutBy, MerchantActivity, MerchantBookingsQuery, MerchantCheckin, MerchantJob, MerchantPayMode, MerchantView } from "@/lib/merchants";
import { useApp } from "../app-provider";
import { ConfirmSheet } from "../confirm-sheet";
import { JobStatusPill, useFcfa, useJobRoute } from "../drivers/shared";
import { useI18n } from "../i18n-provider";
import { CheckCircleIcon, ClockIcon, ScooterIcon, TicketIcon, UsersIcon, WalletIcon, XCircleIcon } from "../icons";
import { Loaded, ResponsiveRows } from "../owner/shared";
import { Button, EmptyState } from "../ui";
import { useDateTime } from "../backoffice/shared";
import { BookedByLine } from "./merchant-book";
import { Block, field, JOB_STATUSES, useAction, useClock, useDuration } from "./shared";
import { JobDetails } from "../drivers/customer-jobs";

type Icon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

const TONE = {
  green: "bg-gp-green/15 text-gp-green-dark dark:text-gp-green",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  red: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
  gray: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
} as const;

function Counter({ icon: Icon, tone, value, label }: { icon: Icon; tone: keyof typeof TONE; value: number; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-gp-border bg-gp-surface p-3 sm:p-4">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${TONE[tone]}`}>
        <Icon size={20} />
      </span>
      <div className="min-w-0">
        <div className="font-heading text-2xl font-semibold leading-none tabular-nums">{value}</div>
        <div className="mt-1 text-xs leading-tight text-gp-muted">{label}</div>
      </div>
    </div>
  );
}

/** Overview: today's trips of the shop, and what waits for the merchant. */
export function MerchantOverview({ view }: { view: MerchantView }) {
  const { t } = useI18n();
  const o = t.merchant.overview;
  const pendingInvites = view.invites.filter((i) => i.status === "pending").length;
  const pendingDrivers = view.drivers.filter((d) => d.status === "pending").length;
  return (
    <div className="space-y-4">
      <h2 className="text-sm font-semibold text-gp-muted">{o.today}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <Counter icon={TicketIcon} tone="blue" value={view.today.booked} label={o.booked} />
        <Counter icon={ScooterIcon} tone="amber" value={view.today.running} label={o.running} />
        <Counter icon={CheckCircleIcon} tone="green" value={view.today.done} label={o.done} />
        <Counter icon={XCircleIcon} tone="red" value={view.today.failed} label={o.failed} />
        <Counter icon={XCircleIcon} tone="gray" value={view.today.cancelled} label={o.cancelled} />
      </div>
      <h2 className="text-sm font-semibold text-gp-muted">{o.now}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Counter icon={ClockIcon} tone="green" value={view.checkins.length} label={o.checkedIn} />
        <Counter icon={UsersIcon} tone="amber" value={pendingInvites} label={o.openInvites} />
        <Counter icon={ScooterIcon} tone="amber" value={pendingDrivers} label={o.pendingDrivers} />
        <Counter icon={WalletIcon} tone="blue" value={view.unpaid.length} label={o.unpaid} />
      </div>
    </div>
  );
}

/** Live: trips running now and drivers checked in at the shop, with check-out. */
export function MerchantLive({ view }: { view: MerchantView }) {
  const { t } = useI18n();
  const l = t.merchant.live;
  const { backend } = useApp();
  const { data: stations } = useLiveQuery(() => backend.listStations());
  return (
    <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
      <Block title={l.trips}>
        {view.live.length === 0 ? (
          <p className="text-sm text-gp-muted">{l.noTrips}</p>
        ) : (
          <ul className="space-y-2">
            {view.live.map((j) => (
              <li key={j.id} className="space-y-1 rounded-xl border border-black/10 p-3 text-sm dark:border-white/10">
                <JobDetails job={j} stations={stations ?? []} />
                <BookedByLine job={j} />
              </li>
            ))}
          </ul>
        )}
      </Block>
      <Block title={l.checkins}>
        {view.checkins.length === 0 ? (
          <p className="text-sm text-gp-muted">{l.noCheckins}</p>
        ) : (
          <ul className="space-y-2">
            {view.checkins.map((c) => (
              <CheckinRow key={c.id} checkin={c} />
            ))}
          </ul>
        )}
      </Block>
    </div>
  );
}

function usePayLabel() {
  const { t } = useI18n();
  const fcfa = useFcfa();
  return (mode: MerchantPayMode | null, rate: number | null) =>
    mode === "hourly" && rate ? format(t.merchant.drivers.hourlyValue, { rate: fcfa(rate) }) : mode ? t.merchant.drivers.pay[mode] : "";
}

function CheckinRow({ checkin: c }: { checkin: MerchantCheckin }) {
  const { t } = useI18n();
  const l = t.merchant.live;
  const { backend } = useApp();
  const clock = useClock();
  const duration = useDuration();
  const now = useNow(60_000);
  const payLabel = usePayLabel();
  const { busy, run } = useAction();
  const [confirm, setConfirm] = useState(false);
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-xl border border-black/10 p-3 text-sm dark:border-white/10">
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{c.driverName}</p>
        <p className="text-xs text-gp-muted">
          {format(l.since, { time: clock(c.inAt), duration: duration(c.inAt, now.toISOString()) })} · {payLabel(c.payMode, c.ratePerHourFcfa)}
        </p>
      </div>
      <Button variant="secondary" size="md" onClick={() => setConfirm(true)}>
        {l.checkout}
      </Button>
      <ConfirmSheet
        open={confirm}
        title={format(l.checkoutTitle, { name: c.driverName })}
        confirmLabel={l.checkout}
        busy={busy}
        onCancel={() => setConfirm(false)}
        onConfirm={() =>
          void run(() => backend.merchantCheckout(c.driverId), l.checkedOut).then((ok) => {
            if (ok) setConfirm(false);
          })
        }
      >
        <p className="text-sm">{l.checkoutText}</p>
      </ConfirmSheet>
    </li>
  );
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** The shop's bookings in a period, filtered by status and employee. */
export function MerchantBookings({ view }: { view: MerchantView }) {
  const { t } = useI18n();
  const b = t.merchant.bookings;
  const { backend } = useApp();
  const [query, setQuery] = useState<MerchantBookingsQuery>(() => {
    const to = new Date();
    const from = new Date(to.getTime() - 6 * 86_400_000);
    return { from: isoDay(from), to: isoDay(to), status: "", bookedBy: "" };
  });
  const { data, error, reload } = useLiveQuery(
    () => Promise.all([backend.merchantBookings(query), backend.listStations()]),
    JSON.stringify(query),
  );
  const set = (key: keyof MerchantBookingsQuery) => (e: { target: { value: string } }) => {
    const value = e.target.value;
    if ((key === "from" || key === "to") && !value) return;
    setQuery((q) => ({ ...q, [key]: value }));
  };
  const label = "space-y-1 text-sm";

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className={label}>
          <span className="block">{b.from}</span>
          <input type="date" className={field} value={query.from} max={query.to} onChange={set("from")} />
        </label>
        <label className={label}>
          <span className="block">{b.to}</span>
          <input type="date" className={field} value={query.to} min={query.from} onChange={set("to")} />
        </label>
        <label className={label}>
          <span className="block">{b.status}</span>
          <select className={field} value={query.status ?? ""} onChange={set("status")}>
            <option value="">{b.allStatuses}</option>
            {JOB_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t.drivers.status[s]}
              </option>
            ))}
          </select>
        </label>
        <label className={label}>
          <span className="block">{b.employee}</span>
          <select className={field} value={query.bookedBy ?? ""} onChange={set("bookedBy")}>
            <option value="">{b.allEmployees}</option>
            {view.members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.fullName ?? m.phone ?? m.email ?? "?"}
              </option>
            ))}
          </select>
        </label>
      </div>
      <Loaded data={data} error={error} reload={reload}>
        {([jobs, stations]) => <BookingsTable jobs={jobs} stationName={(id) => stations.find((s) => s.id === id)?.name ?? "?"} />}
      </Loaded>
    </div>
  );
}

/** Paid: the shop pays the driver at the start, so a trip is paid once the driver has the parcel or the passenger. */
function isPaid(j: DeliveryJob): boolean {
  return !!j.pickedUpAt && j.status !== "cancelled";
}

function BookingsTable({ jobs, stationName }: { jobs: MerchantJob[]; stationName: (id: string | null) => string }) {
  const { t } = useI18n();
  const b = t.merchant.bookings;
  const when = useDateTime();
  const route = useJobRoute();
  const fcfa = useFcfa();
  if (jobs.length === 0) return <EmptyState text={b.none} />;
  const total = jobs.filter(isPaid).reduce((n, j) => n + j.fareFcfa, 0);
  const status = (j: MerchantJob) => <JobStatusPill status={j.status as JobStatus} kind={j.kind} noDriver={j.noDriver} />;
  const driver = (j: MerchantJob) => (j.driver ? `${j.driver.name}${j.driver.plate ? ` · ${j.driver.plate}` : ""}` : "–");
  return (
    <div className="space-y-3">
      <p className="text-sm text-gp-muted">{format(b.total, { n: jobs.length, amount: fcfa(total) })}</p>
      <ResponsiveRows
        rows={jobs}
        rowKey={(j) => j.id}
        columns={[
          { label: b.date, cell: (j) => when(j.createdAt), className: "whitespace-nowrap" },
          { label: b.bookedBy, cell: (j) => j.bookedBy?.name ?? "–" },
          { label: b.kind, cell: (j) => t.drivers.kind[j.kind] },
          { label: b.route, cell: (j) => route(j, stationName) },
          { label: b.driver, cell: driver },
          { label: b.status, cell: status },
          { label: b.price, cell: (j) => fcfa(j.fareFcfa), className: "whitespace-nowrap text-right" },
          { label: b.paid, cell: (j) => (isPaid(j) ? b.yes : "–") },
        ]}
        card={(j) => (
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{t.drivers.kind[j.kind]}</span>
              {status(j)}
              <span className="ml-auto text-xs text-gp-muted">{when(j.createdAt)}</span>
            </div>
            <p>{route(j, stationName)}</p>
            <p className="text-xs text-gp-muted">
              {format(b.cardLine, { by: j.bookedBy?.name ?? "–", driver: driver(j), price: fcfa(j.fareFcfa) })}
              {isPaid(j) ? ` · ${b.paid}` : ""}
            </p>
          </div>
        )}
      />
    </div>
  );
}

/** One readable line of the activity log. */
function useActivityText() {
  const { t } = useI18n();
  const a = t.merchant.activity;
  const fcfa = useFcfa();
  const payLabel = usePayLabel();
  const last = (v: unknown) => (Array.isArray(v) ? v[v.length - 1] : v);
  return (e: MerchantActivity): string => {
    const c = e.changes;
    const status = last(c.status) as string | undefined;
    switch (e.table) {
      case "merchants":
        if (c.status) return format(a.shopStatus, { status: t.merchant.status[status as keyof typeof t.merchant.status] ?? String(status) });
        if (c.tier) return format(a.shopTier, { tier: t.merchant.tier[last(c.tier) as keyof typeof t.merchant.tier] ?? String(last(c.tier)) });
        if (c.owner_id) return a.ownerChanged;
        return a.shopChanged;
      case "merchant_invites":
        if (e.action === "insert") return format(a.inviteSent, { phone: String(c.phone ?? "") });
        if (status === "revoked") return a.inviteRevoked;
        if (status === "accepted") return a.inviteAccepted;
        if (status === "declined") return a.inviteDeclined;
        return a.inviteChanged;
      case "merchant_members":
        return e.action === "delete" ? a.memberRemoved : a.memberJoined;
      case "merchant_drivers":
        if (e.action === "insert") {
          return c.kind === "favorite"
            ? a.favoriteAdded
            : format(a.assignedAdded, { pay: payLabel(c.pay_mode as MerchantPayMode | null, (c.rate_per_hour_fcfa as number | null) ?? null) });
        }
        if (Array.isArray(c.pay_mode)) {
          return format(a.payChanged, { pay: payLabel(last(c.pay_mode) as MerchantPayMode, (last(c.rate_per_hour_fcfa) as number | null) ?? null) });
        }
        if (status === "active") return a.assignmentApproved;
        if (status === "declined") return a.assignmentDeclined;
        if (status === "ended") return a.driverEnded;
        return a.driverChanged;
      case "merchant_checkins":
        if (e.action === "insert") return a.checkin;
        if ("received" in c) return format(a.hoursReceived, { amount: fcfa(Number(c.received ?? 0)) });
        if (c.out_by) {
          const amount = typeof c.amount_fcfa === "number" ? ` · ${fcfa(c.amount_fcfa)}` : "";
          return `${format(a.checkout, { by: a.outBy[c.out_by as CheckoutBy] ?? String(c.out_by) })}${amount}`;
        }
        return a.checkinChanged;
      case "delivery_jobs":
        if (e.action === "insert") {
          const kind = c.kind as keyof typeof t.drivers.kind | undefined;
          const fare = typeof c.fare_fcfa === "number" ? ` · ${fcfa(c.fare_fcfa)}` : "";
          return `${format(a.booked, { kind: kind ? t.drivers.kind[kind] : "" })}${fare}`;
        }
        if (status && status in t.drivers.status) return format(a.jobStatus, { status: t.drivers.status[status as JobStatus] });
        return a.jobChanged;
      default:
        return `${e.table} · ${e.action}`;
    }
  };
}

/** The shop's activity log: team, drivers, check-ins, payments, bookings and cancellations. */
export function MerchantActivityLog() {
  const { t } = useI18n();
  const a = t.merchant.activity;
  const { backend } = useApp();
  const when = useDateTime();
  const text = useActivityText();
  const { data, error, reload } = useLiveQuery(() => backend.merchantActivity());
  return (
    <Loaded data={data} error={error} reload={reload}>
      {(rows) =>
        rows.length === 0 ? (
          <EmptyState text={a.empty} />
        ) : (
          <ResponsiveRows
            rows={rows}
            rowKey={(r) => String(r.id)}
            columns={[
              { label: a.when, cell: (r) => when(r.at), className: "whitespace-nowrap" },
              { label: a.who, cell: (r) => r.actorName ?? a.system },
              { label: a.what, cell: (r) => text(r) },
            ]}
            card={(r) => (
              <div className="space-y-0.5">
                <p className="font-medium">{text(r)}</p>
                <p className="text-xs text-gp-muted">
                  {when(r.at)} · {r.actorName ?? a.system}
                </p>
              </div>
            )}
          />
        )
      }
    </Loaded>
  );
}
