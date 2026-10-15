"use client";

import { useState, type ReactNode } from "react";
import { useDateTime } from "@/components/backoffice/shared";
import { DEFAULT_PHONE_COUNTRY, PHONE_COUNTRIES, phoneWithCountry } from "@/lib/countries";
import { BUSY_JOB_STATUSES, jobFits, type DeliveryJob, type DriverStatus } from "@/lib/drivers";
import { statsUnlocked, type FleetDriver, type FleetDriverStats, type FleetInfo, type FleetInvite, type FleetInviteStatus, type FleetView } from "@/lib/fleet";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import type { StationView } from "@/lib/types";
import { useApp } from "../app-provider";
import { ConfirmSheet } from "../confirm-sheet";
import { CountryPicker } from "../country-picker";
import { useI18n } from "../i18n-provider";
import { Badge, Button, Input, useToast, type BadgeTone } from "../ui";
import { input, JobStatusPill, Notice, primary, secondary, useFcfa, useJobRoute } from "./shared";

function Section({ title, hint, action, children }: { title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-black/10 p-4 dark:border-white/10">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex-1 font-semibold">{title}</h2>
        {action}
      </div>
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
      {children}
    </section>
  );
}

const DRIVER_TONE: Record<DriverStatus, BadgeTone> = { pending: "amber", active: "green", rejected: "neutral", suspended: "red" };
const INVITE_TONE: Record<FleetInviteStatus, BadgeTone> = { pending: "amber", accepted: "green", declined: "neutral", revoked: "neutral", expired: "neutral" };

function DriverCard({ d, stations, canRemove }: { d: FleetDriver; stations: StationView[]; canRemove: boolean }) {
  const { t } = useI18n();
  const f = t.fleet;
  const { backend } = useApp();
  const fcfa = useFcfa();
  const route = useJobRoute();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const name = (id: string | null) => stations.find((s) => s.id === id)?.name ?? "?";
  const where = d.queue ? format(f.inQueue, { station: name(d.queue.stationId), pos: d.queue.position }) : f.notQueued;

  async function remove() {
    setBusy(true);
    try {
      const { released } = await backend.removeFleetDriver(d.userId);
      toast(released ? f.removedReleased : f.removedKept, { tone: "success" });
      setConfirm(false);
    } catch (err) {
      toast(errorMessage(err), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="space-y-1 rounded-lg bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{d.fullName}</span>
        <Badge tone={DRIVER_TONE[d.status]}>{f.driverStatus[d.status]}</Badge>
        {d.phone && (
          <a href={`tel:${d.phone}`} className="text-gp-green-dark underline">
            {d.phone}
          </a>
        )}
        <span className="flex-1" />
        <span className="text-xs text-zinc-500">
          {d.vehicle ? `${t.drivers.vehicle[d.vehicle.type]} · ${d.vehicle.plate}` : f.noVehicle}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
        {d.status === "active" && !d.job && <span>{`${f.free} · ${where}`}</span>}
        {d.balanceFcfa !== 0 && (
          <span>{d.balanceFcfa > 0 ? format(f.owes, { n: d.balanceFcfa.toLocaleString("fr-FR") }) : format(f.owed, { n: (-d.balanceFcfa).toLocaleString("fr-FR") })}</span>
        )}
        <span className="flex-1" />
        {canRemove && !d.job && (
          <Button variant="ghost" size="md" onClick={() => setConfirm(true)}>
            {f.remove}
          </Button>
        )}
      </div>
      {d.job && (
        <div className="flex flex-wrap items-center gap-2">
          <JobStatusPill status={d.job.status} kind={d.job.kind} />
          <span>
            {d.job.trackingNo ? `${d.job.trackingNo} · ` : ""}
            {route(d.job, name)}
          </span>
          <span className="text-xs text-zinc-500">{fcfa(d.job.fareFcfa)}</span>
        </div>
      )}
      <ConfirmSheet
        open={confirm}
        title={format(f.removeTitle, { name: d.fullName })}
        confirmLabel={f.remove}
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirm(false)}
      >
        <p>{f.removeText}</p>
      </ConfirmSheet>
    </li>
  );
}

/** The sheet to invite a driver by phone number, with the country picker of the login. */
function InviteSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const f = t.fleet;
  const { backend } = useApp();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [country, setCountry] = useState(DEFAULT_PHONE_COUNTRY);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    const full = phoneWithCountry(country, phone);
    if (!full) {
      setError(t.login.invalidPhone);
      return;
    }
    setError("");
    setBusy(true);
    try {
      const invite = await backend.inviteFleetDriver(full);
      toast(format(f.invited, { code: invite.token }), { tone: "success", duration: 6000 });
      setPhone("");
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmSheet
      open={open}
      title={f.invite}
      confirmLabel={f.inviteSend}
      busy={busy}
      onConfirm={() => void send()}
      onCancel={() => {
        setError("");
        onClose();
      }}
    >
      <p className="text-sm">{f.inviteText}</p>
      <label htmlFor="invite-phone" className="block text-sm font-medium">
        {f.invitePhone}
      </label>
      <div className="flex gap-2">
        <CountryPicker countries={PHONE_COUNTRIES} value={country} onChange={setCountry} />
        <Input
          id="invite-phone"
          className="min-w-0 flex-1"
          type="tel"
          inputMode="tel"
          autoComplete="off"
          placeholder={country.example}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void send();
            }
          }}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-300">
          {error}
        </p>
      )}
    </ConfirmSheet>
  );
}

function InviteRow({ invite }: { invite: FleetInvite }) {
  const { t } = useI18n();
  const f = t.fleet;
  const { backend } = useApp();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const when = useDateTime();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function revoke() {
    setBusy(true);
    try {
      await backend.revokeFleetInvite(invite.id);
      toast(f.revoked, { tone: "success" });
      setConfirm(false);
    } catch (err) {
      toast(errorMessage(err), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  function copyLink() {
    const link = `${window.location.origin}/chauffeur?invitation=${invite.token}`;
    const copied = navigator.clipboard?.writeText(link);
    if (!copied) {
      toast(link, { tone: "info", duration: 8000 });
      return;
    }
    copied.then(
      () => toast(f.linkCopied, { tone: "success" }),
      () => toast(link, { tone: "info", duration: 8000 }),
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
      <span className="font-medium">{invite.phone}</span>
      <Badge tone={INVITE_TONE[invite.status]}>{f.inviteStatus[invite.status]}</Badge>
      {invite.status === "pending" && (
        <>
          <span className="font-mono text-xs">{format(f.inviteCode, { code: invite.token })}</span>
          <span className="text-xs text-zinc-500">{format(f.expiresOn, { date: when(invite.expiresAt) })}</span>
          <span className="flex-1" />
          <Button variant="secondary" size="md" onClick={copyLink}>
            {f.copyLink}
          </Button>
          <Button variant="ghost" size="md" onClick={() => setConfirm(true)}>
            {f.revoke}
          </Button>
          <ConfirmSheet
            open={confirm}
            title={format(f.revokeTitle, { phone: invite.phone })}
            confirmLabel={f.revokeConfirm}
            cancelLabel={f.keep}
            danger
            busy={busy}
            onConfirm={() => void revoke()}
            onCancel={() => setConfirm(false)}
          />
        </>
      )}
    </li>
  );
}

function OpenJob({ job, view, stations, onDone }: { job: DeliveryJob; view: FleetView; stations: StationView[]; onDone: (msg: string) => void }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const fcfa = useFcfa();
  const route = useJobRoute();
  const when = useDateTime();
  const [driverId, setDriverId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const name = (id: string | null) => stations.find((s) => s.id === id)?.name ?? "?";
  // Free drivers whose vehicle fits the trip (the asked vehicle type, the seats of a ride, the parcel by size
  // until it is weighed): the same rule as dispatch, and the server checks again.
  const weight = job.weightKg ?? 0;
  const candidates = view.drivers.filter(
    (d) =>
      d.status === "active" &&
      d.vehicle?.isActive &&
      !(d.job && BUSY_JOB_STATUSES.includes(d.job.status)) &&
      jobFits({ ...job, vehicleType: job.vehicleType ?? null, passengers: job.passengers ?? null }, d.vehicle.type, weight, view.settings),
  );

  async function assign() {
    setError("");
    setBusy(true);
    try {
      await backend.fleetAssign(job.id, driverId);
      onDone(t.fleet.assigned);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="space-y-2 rounded-lg bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{t.drivers.kind[job.kind]}</span>
        <span>
          {job.size} · {route(job, name)}
        </span>
        <span className="flex-1" />
        <span>{fcfa(job.fareFcfa)}</span>
      </div>
      <div className="text-xs text-zinc-500">{format(t.fleet.since, { time: when(job.createdAt) })}</div>
      {candidates.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <select value={driverId} onChange={(e) => setDriverId(e.target.value)} className={`${input} w-auto`} aria-label={t.fleet.driver}>
            <option value="">{t.fleet.chooseDriver}</option>
            {candidates.map((d) => (
              <option key={d.userId} value={d.userId}>
                {d.fullName} · {t.drivers.vehicle[d.vehicle!.type]}
              </option>
            ))}
          </select>
          <button type="button" className={primary} disabled={!driverId || busy} onClick={() => void assign()}>
            {t.fleet.assign}
          </button>
        </div>
      )}
      <Notice error={error} notice="" />
    </li>
  );
}

function today(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** From/to days with a "Show" button; the period applies only when sent. */
function usePeriod() {
  const { t } = useI18n();
  const f = t.fleet;
  const [from, setFrom] = useState(() => `${today().slice(0, 8)}01`);
  const [to, setTo] = useState(() => today());
  const [period, setPeriod] = useState({ from, to });
  const form = (
    <form
      className="flex flex-wrap items-end gap-2 text-sm"
      onSubmit={(e) => {
        e.preventDefault();
        setPeriod({ from, to });
      }}
    >
      <label className="space-y-1">
        <span className="block text-xs text-zinc-500">{f.from}</span>
        <input type="date" required value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={`${input} min-h-11 text-base`} />
      </label>
      <label className="space-y-1">
        <span className="block text-xs text-zinc-500">{f.to}</span>
        <input type="date" required value={to} min={from} onChange={(e) => setTo(e.target.value)} className={`${input} min-h-11 text-base`} />
      </label>
      <button type="submit" className={`${secondary} min-h-11`}>
        {f.show}
      </button>
    </form>
  );
  return { period, form };
}

function DataTable({ heads, rows, foot }: { heads: string[]; rows: { key: string; cells: ReactNode[] }[]; foot?: ReactNode[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-zinc-500">
          <tr>
            {heads.map((h) => (
              <th key={h} className="whitespace-nowrap px-2 py-1 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-t border-black/5 dark:border-white/10">
              {r.cells.map((c, i) => (
                <td key={i} className="whitespace-nowrap px-2 py-1">
                  {c}
                </td>
              ))}
            </tr>
          ))}
          {foot && (
            <tr className="border-t border-black/20 font-semibold dark:border-white/20">
              {foot.map((c, i) => (
                <td key={i} className="whitespace-nowrap px-2 py-1">
                  {c}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Battery swaps billed to the fleet, with their amounts (every approved fleet, whatever the tier). */
function Statement() {
  const { t } = useI18n();
  const f = t.fleet;
  const { backend } = useApp();
  const fcfa = useFcfa();
  const when = useDateTime();
  const { period, form } = usePeriod();
  const { data, error } = useLiveQuery(() => backend.fleetStatement(period.from, period.to), `${period.from}:${period.to}`);
  return (
    <Section title={f.statement} hint={f.statementHint}>
      {form}
      {error ? (
        <p className="text-sm text-red-600">{t.errors.unknown}</p>
      ) : !data ? (
        <p className="text-sm text-zinc-500">{t.loading}</p>
      ) : data.swaps.length === 0 ? (
        <p className="text-sm text-zinc-500">{f.statementEmpty}</p>
      ) : (
        <>
          <p className="text-sm font-semibold">{format(f.statementTotal, { count: data.swaps.length, amount: fcfa(data.totalXof) })}</p>
          <DataTable
            heads={[f.date, f.station, f.driver, f.amount]}
            rows={data.swaps.map((s) => ({ key: s.id, cells: [when(s.at), s.stationName, s.driverName ?? "?", fcfa(s.amountXof)] }))}
          />
        </>
      )}
    </Section>
  );
}

/** Standard tier: what the statistics hold and how to unlock them (outside the app). */
function LockedStats() {
  const { t } = useI18n();
  const f = t.fleet;
  return (
    <Section title={f.statsLockedTitle} action={<Badge tone="neutral">{f.tier.standard}</Badge>}>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{f.statsLockedText}</p>
      <div>
        <Button variant="secondary" href="/contact">
          {f.statsLockedCta}
        </Button>
      </div>
    </Section>
  );
}

const ZERO: Omit<FleetDriverStats, "userId"> = {
  tripsDone: 0,
  tripsFailed: 0,
  fareFcfa: 0,
  earningFcfa: 0,
  collectedFcfa: 0,
  settledFcfa: 0,
  batterySwaps: 0,
  chargingSlots: 0,
  chargingPaidFcfa: 0,
  fleetSwaps: 0,
  fleetSwapsXof: 0,
  distanceKm: 0,
  co2Grams: 0,
};

function Stats({ drivers }: { drivers: FleetDriver[] }) {
  const { t } = useI18n();
  const f = t.fleet;
  const { backend } = useApp();
  const fcfa = useFcfa();
  const { period, form } = usePeriod();
  const { data, error } = useLiveQuery(() => backend.fleetStats(period.from, period.to), `${period.from}:${period.to}`);
  const nameOf = (id: string) => drivers.find((d) => d.userId === id)?.fullName ?? "?";
  const rows = data?.drivers ?? [];
  const total = rows.reduce<Omit<FleetDriverStats, "userId">>((s, r) => {
    const out = { ...s };
    for (const key of Object.keys(ZERO) as (keyof typeof ZERO)[]) out[key] = s[key] + r[key];
    return out;
  }, ZERO);
  const cells = (r: Omit<FleetDriverStats, "userId">) => [
    format(f.tripsValue, { done: r.tripsDone, failed: r.tripsFailed }),
    (Math.round(r.distanceKm * 10) / 10).toLocaleString("fr-FR"),
    format(f.co2Value, { kg: (Math.round(r.co2Grams / 100) / 10).toLocaleString("fr-FR") }),
    fcfa(r.fareFcfa),
    fcfa(r.earningFcfa),
    fcfa(r.collectedFcfa),
    fcfa(r.settledFcfa),
    format(f.chargingValue, { swaps: r.batterySwaps, slots: r.chargingSlots }),
    format(f.fleetSwapsValue, { n: r.fleetSwaps, amount: fcfa(r.fleetSwapsXof) }),
    fcfa(r.chargingPaidFcfa),
  ];
  const heads = [f.driver, f.trips, f.km, f.co2, f.fare, f.earning, f.collected, f.settled, f.charging, f.fleetSwaps, f.chargingPaid];

  return (
    <Section title={f.stats} hint={f.statsHint}>
      {form}
      {error ? (
        <p className="text-sm text-red-600">{t.errors.unknown}</p>
      ) : !data ? (
        <p className="text-sm text-zinc-500">{t.loading}</p>
      ) : (
        <DataTable
          heads={heads}
          rows={rows.map((r) => ({ key: r.userId, cells: [nameOf(r.userId), ...cells(r)] }))}
          foot={rows.length > 1 ? [f.total, ...cells(total)] : undefined}
        />
      )}
    </Section>
  );
}

/** Name, tier badge and the limit counter (R13). */
function FleetHeader({ fleet }: { fleet: FleetInfo }) {
  const { t } = useI18n();
  const f = t.fleet;
  const full = fleet.driverLimit !== null && fleet.used >= fleet.driverLimit;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-lg font-semibold">{fleet.name}</span>
      <Badge tone={fleet.tier === "unlocked" ? "green" : "neutral"}>{f.tier[fleet.tier]}</Badge>
      {fleet.status === "approved" && (
        <Badge tone={full ? "amber" : "blue"}>
          {fleet.driverLimit === null ? format(f.noLimit, { used: fleet.used }) : format(f.limitCounter, { used: fleet.used, limit: fleet.driverLimit })}
        </Badge>
      )}
    </div>
  );
}

/** /flotte: a fleet manager's drivers, invites, manual dispatch, the swaps billed to the fleet and figures (src/lib/fleet.ts). */
export function FleetPanel() {
  const { t } = useI18n();
  const f = t.fleet;
  const { backend, profile } = useApp();
  const errorMessage = useErrorMessage();
  const { data, error, reload } = useLiveQuery(() => Promise.all([backend.fleetView(), backend.listStations()]));
  const [notice, setNotice] = useState("");
  const [inviting, setInviting] = useState(false);

  if (error) return <p className="p-6 text-sm text-red-600">{errorMessage(error)}</p>;
  if (!data) return <p className="p-6 text-sm text-zinc-500">{t.loading}</p>;
  const [view, stations] = data;
  const fleet = view.fleet;
  const manager = profile?.role === "fleet_manager";

  // Until an admin approves the fleet, its functions are blocked (M1).
  if (fleet && fleet.status !== "approved") {
    const pending = fleet.status === "pending";
    return (
      <div className="mx-auto w-full max-w-3xl space-y-4 overflow-y-auto p-6">
        <h1 className="text-2xl font-semibold">{f.title}</h1>
        <FleetHeader fleet={fleet} />
        <div
          role="status"
          className={`space-y-1 rounded-xl p-4 text-sm ${pending ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100" : "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200"}`}
        >
          <p className="font-semibold">{pending ? f.pendingTitle : f.rejectedTitle}</p>
          <p>{pending ? f.pendingText : f.rejectedText}</p>
        </div>
      </div>
    );
  }

  const full = !!fleet && fleet.driverLimit !== null && fleet.used >= fleet.driverLimit;
  const pendingInvites = view.invites.filter((i) => i.status === "pending");
  const answered = view.invites.filter((i) => i.status !== "pending").slice(0, 10);

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 overflow-y-auto p-6">
      <h1 className="text-2xl font-semibold">{f.title}</h1>
      {fleet && <FleetHeader fleet={fleet} />}
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{f.intro}</p>
      <Section
        title={f.drivers}
        action={
          manager && (
            <Button size="md" onClick={() => setInviting(true)} disabled={full}>
              {f.invite}
            </Button>
          )
        }
      >
        {manager && full && <p className="rounded-lg bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">{f.limitReached}</p>}
        {view.drivers.length === 0 ? (
          <p className="text-sm text-zinc-500">{f.none}</p>
        ) : (
          <ul className="space-y-2">
            {view.drivers.map((d) => (
              <DriverCard key={d.userId} d={d} stations={stations} canRemove={manager} />
            ))}
          </ul>
        )}
      </Section>
      {manager && <InviteSheet open={inviting} onClose={() => setInviting(false)} />}
      {fleet && (
        <Section title={f.invites}>
          {pendingInvites.length + answered.length === 0 ? (
            <p className="text-sm text-zinc-500">{f.noInvites}</p>
          ) : (
            <ul className="space-y-2">
              {[...pendingInvites, ...answered].map((i) => (
                <InviteRow key={i.id} invite={i} />
              ))}
            </ul>
          )}
        </Section>
      )}
      <Section title={f.open} hint={f.openHint}>
        <Notice error="" notice={notice} />
        {view.openJobs.length === 0 ? (
          <p className="text-sm text-zinc-500">{f.noOpen}</p>
        ) : (
          <ul className="space-y-2">
            {view.openJobs.map((j) => (
              <OpenJob
                key={j.id}
                job={j}
                view={view}
                stations={stations}
                onDone={(msg) => {
                  setNotice(msg);
                  reload();
                }}
              />
            ))}
          </ul>
        )}
      </Section>
      <Statement />
      {statsUnlocked(profile?.role, fleet) ? view.drivers.length > 0 && <Stats drivers={view.drivers} /> : <LockedStats />}
    </div>
  );
}
