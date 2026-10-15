"use client";

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useDateTime } from "@/components/backoffice/shared";
import {
  ABANDON_REASONS,
  DRIVER_DOCUMENTS,
  driverBadgePayload,
  driverEarning,
  FLEET_VEHICLE_TYPES,
  type AbandonReason,
  type DeliveryJob,
  type Driver,
  type DriverHome,
  type DriverPass,
  type FleetVehicleType,
  type FormerAccount,
} from "@/lib/drivers";
import { directionsUrl, distanceMeters, formatDistance, type LatLng } from "@/lib/geo";
import { useErrorMessage, useLiveQuery, useNow } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { measuresOf, type ParcelInfo, type ParcelSize } from "@/lib/parcels";
import { SizePicker } from "../parcels/size-picker";
import type { StationView } from "@/lib/types";
import { usePosition } from "@/lib/use-position";
import { useApp } from "../app-provider";
import { ConfirmSheet } from "../confirm-sheet";
import { useI18n } from "../i18n-provider";
import { QrImage } from "../parcels/qr-image";
import { Button, Countdown, Input } from "../ui";
import { PIN_LENGTH } from "@/lib/pin";
import { FleetInvitesCard } from "./fleet-invites";
import { input, JobStatusPill, Notice, PhotoButton, primary, secondary, shrinkImage, useFcfa, useJobRoute } from "./shared";

function Card({ title, children, className = "" }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`space-y-3 rounded-xl border border-black/10 p-4 dark:border-white/10 ${className}`}>
      {title && <h2 className="font-semibold">{title}</h2>}
      {children}
    </section>
  );
}

/** Runs a backend action and reports the outcome. */
function useAction() {
  const errorMessage = useErrorMessage();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<unknown>, success = ""): Promise<boolean> {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await action();
      setNotice(success);
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, error, notice, status: <Notice error={error} notice={notice} /> };
}

function ApplyForm({ driver }: { driver: Driver | null }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const { run, busy, status } = useAction();
  const [form, setForm] = useState({
    fullName: driver?.fullName ?? "",
    idNumber: driver?.idNumber ?? "",
    licenseNumber: driver?.licenseNumber ?? "",
    wantedType: (driver?.wantedType ?? "moto") as FleetVehicleType,
  });
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const label = "space-y-1 text-sm";

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(() => backend.applyDriver(form), t.drivers.page.applied);
  }

  return (
    <Card title={t.drivers.page.applyTitle}>
      <form onSubmit={submit} className="grid gap-3">
        <label className={label}>
          <span>{t.drivers.page.fullName}</span>
          <input className={input} required minLength={2} maxLength={80} value={form.fullName} onChange={set("fullName")} />
        </label>
        <label className={label}>
          <span>{t.drivers.page.idNumber}</span>
          <input className={input} required minLength={3} maxLength={40} value={form.idNumber} onChange={set("idNumber")} />
        </label>
        <label className={label}>
          <span>{t.drivers.page.licenseNumber}</span>
          <input className={input} required minLength={3} maxLength={40} value={form.licenseNumber} onChange={set("licenseNumber")} />
        </label>
        <label className={label}>
          <span>{t.drivers.page.wantedType}</span>
          <select className={input} value={form.wantedType} onChange={set("wantedType")}>
            {FLEET_VEHICLE_TYPES.map((type) => (
              <option key={type} value={type}>
                {t.drivers.vehicle[type]}
              </option>
            ))}
          </select>
        </label>
        <div>
          <button type="submit" className={primary} disabled={busy}>
            {driver ? t.drivers.page.update : t.drivers.page.apply}
          </button>
        </div>
      </form>
      {status}
    </Card>
  );
}

function Documents({ driver }: { driver: Driver }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const { run, status } = useAction();
  return (
    <Card title={t.drivers.page.documents}>
      <ul className="space-y-2">
        {DRIVER_DOCUMENTS.map((kind) => (
          <li key={kind} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="flex-1">{t.drivers.page.doc[kind]}</span>
            <span className={driver.documents[kind] ? "text-gp-green-dark dark:text-gp-green" : "text-amber-700 dark:text-amber-300"}>
              {driver.documents[kind] ? `✓ ${t.drivers.page.docUploaded}` : t.drivers.page.docMissing}
            </span>
            <PhotoButton label={t.drivers.page.choosePhoto} onPhoto={(file) => run(async () => backend.uploadDriverDocument(kind, await shrinkImage(file)))} />
          </li>
        ))}
      </ul>
      {status}
    </Card>
  );
}

/** Ask for a new pass this long before the current one runs out. */
const PASS_RENEW_MS = 60_000;

/**
 * The signed, expiring driver pass (R10), renewed before it runs out. Offline, the plain
 * code still works for parcels and cash, but not for the fleet's battery swaps.
 */
function useDriverPass(): { pass: DriverPass | null; failed: boolean } {
  const { backend } = useApp();
  const [pass, setPass] = useState<DriverPass | null>(null);
  const [failed, setFailed] = useState(false);
  const [round, setRound] = useState(0);
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    backend.driverPass().then(
      (p) => {
        if (!alive) return;
        setPass(p);
        setFailed(false);
        const wait = Math.max(5_000, new Date(p.expiresAt).getTime() - Date.now() - PASS_RENEW_MS);
        timer = window.setTimeout(() => setRound((r) => r + 1), wait);
      },
      () => {
        if (!alive) return;
        setFailed(true);
        timer = window.setTimeout(() => setRound((r) => r + 1), 30_000);
      },
    );
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [backend, round]);
  // A pass that ran out (phone asleep) is not shown as valid.
  const now = useNow(5_000);
  const valid = pass && new Date(pass.expiresAt) > now ? pass : null;
  return { pass: valid, failed: failed || (!!pass && !valid) };
}

function Badge({ driver }: { driver: Driver }) {
  const { t } = useI18n();
  const { pass, failed } = useDriverPass();
  if (!driver.code) return null;
  return (
    <Card title={t.drivers.page.badgeTitle}>
      <div className="flex flex-wrap items-center gap-4">
        <QrImage text={pass?.payload ?? driverBadgePayload(driver.code)} label={t.drivers.page.badgeTitle} size={160} />
        <div className="space-y-1">
          <div className="font-mono text-2xl font-bold tracking-widest">{driver.code}</div>
          {pass && (
            <p className="text-sm">
              {t.drivers.page.passUntil} <Countdown expiresAt={pass.expiresAt} />
            </p>
          )}
          {!pass && failed && <p className="text-xs text-amber-700 dark:text-amber-300">{t.drivers.page.passOffline}</p>}
          {driver.vehicle && (
            <div className="text-sm">
              {t.drivers.vehicle[driver.vehicle.type]} · <span className="font-mono">{driver.vehicle.plate}</span>
            </div>
          )}
          <p className="text-xs text-zinc-500">{t.drivers.page.badgeHint}</p>
        </div>
      </div>
    </Card>
  );
}

/** What a converted driver left as a customer (migration 0031), and how to claim it. */
function FormerAccountCard({ former }: { former: FormerAccount }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const { run, busy, status } = useAction();
  const [contact, setContact] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const label = "space-y-1 text-sm";

  async function send(e: FormEvent) {
    e.preventDefault();
    const to = contact.trim();
    if (await run(() => backend.sendFormerAccountCode(to), format(t.drivers.page.formerSent, { contact: to }))) setSentTo(to);
  }

  function claim(e: FormEvent) {
    e.preventDefault();
    void run(() => backend.claimFormerAccount(sentTo, code.trim(), pin), t.drivers.page.formerClaimed);
  }

  return (
    <Card title={t.drivers.page.formerTitle}>
      {former.claimable && (
        <p className="text-sm">{format(t.drivers.page.formerIntro, { balance: former.balanceXof.toLocaleString("fr-FR"), points: former.points })}</p>
      )}
      {former.cancelledReservations > 0 && <p className="text-sm">{format(t.drivers.page.formerReservations, { n: former.cancelledReservations })}</p>}
      {former.claimed && <p className="rounded-lg bg-gp-green/10 p-3 text-sm">{t.drivers.page.formerClaimed}</p>}
      {former.claimable && !former.claimed && (
        <>
          <p className="text-xs text-zinc-500">{t.drivers.page.formerHow}</p>
          <form onSubmit={send} className="grid gap-3">
            <label className={label}>
              <span>{t.drivers.page.formerContact}</span>
              <Input required autoComplete="off" value={contact} onChange={(e) => setContact(e.target.value)} />
            </label>
            <div>
              <Button type="submit" variant={sentTo ? "secondary" : "primary"} busy={busy && !sentTo}>
                {t.drivers.page.formerSend}
              </Button>
            </div>
          </form>
          {sentTo && (
            <form onSubmit={claim} className="grid gap-3">
              <label className={label}>
                <span>{t.login.code}</span>
                <Input required inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
              </label>
              <label className={label}>
                <span>{t.login.newPin}</span>
                <Input
                  required
                  type="password"
                  inputMode="numeric"
                  autoComplete="new-password"
                  maxLength={PIN_LENGTH}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                />
              </label>
              <p className="text-xs text-zinc-500">{t.login.pinHint}</p>
              <div>
                <Button type="submit" busy={busy} disabled={pin.length !== PIN_LENGTH}>
                  {t.drivers.page.formerClaim}
                </Button>
              </div>
            </form>
          )}
        </>
      )}
      {status}
    </Card>
  );
}

function Balance({ home }: { home: DriverHome }) {
  const { t } = useI18n();
  const when = useDateTime();
  const fcfa = useFcfa();
  const driver = home.driver!;
  const b = driver.balanceFcfa;
  return (
    <Card title={t.drivers.page.balanceTitle}>
      <p className="text-sm font-medium">
        {b > 0 ? format(t.drivers.page.owes, { n: b }) : b < 0 ? format(t.drivers.page.owed, { n: -b }) : t.drivers.page.even}
      </p>
      {b >= home.settings.cashLimitFcfa && (
        <p className="rounded-lg bg-red-100 p-2 text-sm text-red-800 dark:bg-red-900/40 dark:text-red-200">
          {format(t.drivers.page.limitReached, { n: home.settings.cashLimitFcfa })}
        </p>
      )}
      {driver.lastSettledAt && <p className="text-xs text-zinc-500">{format(t.drivers.page.lastSettled, { date: when(driver.lastSettledAt) })}</p>}
      {home.ledger.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-zinc-600 dark:text-zinc-400">{t.drivers.page.ledger}</summary>
          <ul className="mt-2 space-y-1">
            {home.ledger.slice(0, 30).map((e) => (
              <li key={e.id} className="flex gap-2">
                <span className="text-xs text-zinc-500">{when(e.at)}</span>
                <span className="flex-1">{t.drivers.page.ledgerKind[e.kind]}</span>
                <span className="font-mono">{fcfa(e.amountFcfa)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}

function Queue({ driver, stations, info }: { driver: Driver; stations: StationView[]; info: ParcelInfo }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const when = useDateTime();
  const { position, state } = usePosition();
  const { run, busy, status } = useAction();
  const depots = info.depots
    .map((d) => stations.find((s) => s.id === d.stationId))
    .filter((s): s is StationView => !!s)
    .map((s) => ({ ...s, d: position ? distanceMeters(position, s) : null }))
    .sort((a, b) => (a.d ?? 0) - (b.d ?? 0) || a.name.localeCompare(b.name));
  const [stationId, setStationId] = useState("");
  const chosen = stationId || depots[0]?.id || "";

  if (driver.queue) {
    const station = stations.find((s) => s.id === driver.queue!.stationId);
    return (
      <Card title={t.drivers.page.queueTitle}>
        <p className="text-sm">
          {format(t.drivers.page.inQueue, { pos: driver.queue.position, station: station?.name ?? "?", time: when(driver.queue.since) })}
        </p>
        <button type="button" className={secondary} disabled={busy} onClick={() => void run(() => backend.leaveDriverQueue())}>
          {t.drivers.page.leave}
        </button>
        {status}
      </Card>
    );
  }
  return (
    <Card title={t.drivers.page.queueTitle}>
      <p className="text-xs text-zinc-500">{t.drivers.page.queueHint}</p>
      <select className={input} value={chosen} onChange={(e) => setStationId(e.target.value)} aria-label={t.drivers.page.chooseStation}>
        {depots.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
            {s.d !== null ? ` · ${formatDistance(s.d)}` : ""}
          </option>
        ))}
      </select>
      {state === "denied" && <p className="text-xs text-amber-700 dark:text-amber-300">{t.drivers.page.noPosition}</p>}
      <button type="button" className={primary} disabled={busy || !chosen} onClick={() => void run(() => backend.joinDriverQueue(chosen, position))}>
        {t.drivers.page.join}
      </button>
      {status}
    </Card>
  );
}

function PickupCollect({ job, info, onDone }: { job: DeliveryJob; info: ParcelInfo; onDone: (no: string) => void }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const { run, busy, status } = useAction();
  const [size, setSize] = useState<ParcelSize | null>(null);
  const [checked, setChecked] = useState(false);
  const [paid, setPaid] = useState(false);
  const tier = info.sizes.find((x) => x.size === size) ?? null;
  const total = tier ? tier.priceFcfa + job.fareFcfa : 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!tier) return;
    let no = "";
    const ok = await run(async () => {
      const updated = await backend.collectPickup(job.id, measuresOf(tier));
      no = updated.trackingNo ?? "";
    });
    if (ok) onDone(no);
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg bg-zinc-100 p-3 dark:bg-zinc-900">
      <h3 className="text-sm font-semibold">{t.drivers.page.measureTitle}</h3>
      <SizePicker tiers={info.sizes} value={size} onChange={setSize} extraFcfa={job.fareFcfa} />
      {tier && (
        <p className="text-sm font-semibold" aria-live="polite">
          {format(t.drivers.page.measured, { size: tier.size, parcel: tier.priceFcfa, fare: job.fareFcfa, total })}
        </p>
      )}
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" required checked={checked} onChange={(e) => setChecked(e.target.checked)} />
        {t.drivers.page.contentChecked}
      </label>
      {tier && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" required checked={paid} onChange={(e) => setPaid(e.target.checked)} />
          {format(t.drivers.page.cashTaken, { n: total })}
        </label>
      )}
      <button type="submit" className={primary} disabled={busy || !tier}>
        {t.drivers.page.collectButton}
      </button>
      {status}
    </form>
  );
}

function DoorActions({ job, home }: { job: DeliveryJob; home: DriverHome }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const when = useDateTime();
  const now = useNow(15_000);
  const { run, busy, status } = useAction();
  const [code, setCode] = useState("");
  const absentAt = job.atDoorAt ? new Date(new Date(job.atDoorAt).getTime() + home.settings.waitMinutes * 60_000) : null;

  if (job.status === "picked_up") {
    return (
      <div className="space-y-2">
        <button type="button" className={primary} disabled={busy} onClick={() => void run(() => backend.arriveAtDoor(job.id))}>
          {t.drivers.page.atDoor}
        </button>
        {status}
      </div>
    );
  }
  return (
    <div className="space-y-3 rounded-lg bg-zinc-100 p-3 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="flex-1">{t.drivers.page.doorPhoto}</span>
        {job.proofKey && <span className="text-gp-green-dark dark:text-gp-green">✓</span>}
        <PhotoButton
          label={t.drivers.page.choosePhoto}
          onPhoto={(file) => run(async () => backend.uploadDeliveryPhoto(job.id, await shrinkImage(file)), t.drivers.page.photoSaved)}
        />
      </div>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => backend.deliverJob(job.id, code), t.drivers.page.delivered);
        }}
      >
        <input
          inputMode="numeric"
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))}
          placeholder="000000"
          aria-label={t.drivers.page.code}
          className="w-36 rounded-lg border border-black/20 bg-white px-3 py-2 text-center font-mono text-lg tracking-widest dark:border-white/20 dark:bg-zinc-950"
        />
        <button type="submit" className={primary} disabled={busy || !job.proofKey}>
          {t.drivers.page.deliver}
        </button>
      </form>
      <div className="space-y-1">
        <button
          type="button"
          className={secondary}
          disabled={busy || !absentAt || now < absentAt}
          onClick={() => window.confirm(t.drivers.page.confirmAbsent) && void run(() => backend.failDelivery(job.id))}
        >
          {t.drivers.page.absent}
        </button>
        {absentAt && now < absentAt && <p className="text-xs text-zinc-500">{format(t.drivers.page.absentWait, { time: when(absentAt.toISOString()) })}</p>}
      </div>
      {status}
    </div>
  );
}

function CurrentJob({ job, home, stations, info }: { job: DeliveryJob; home: DriverHome; stations: StationView[]; info: ParcelInfo }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const route = useJobRoute();
  const { run, busy, status } = useAction();
  const [collected, setCollected] = useState("");
  const station = (id: string | null) => stations.find((s) => s.id === id);
  const name = (id: string | null) => station(id)?.name ?? "?";

  let step = "";
  let target: LatLng | null = null;
  if (job.kind === "express") {
    step = job.status === "picked_up" ? format(t.drivers.page.stepExpressBring, { to: name(job.toStationId) }) : format(t.drivers.page.stepExpress, { from: name(job.fromStationId), to: name(job.toStationId) });
    target = (job.status === "picked_up" ? station(job.toStationId) : station(job.fromStationId)) ?? null;
  } else if (job.kind === "ride") {
    step = job.status === "picked_up" ? format(t.drivers.page.stepRideDrive, { n: job.collectFcfa }) : t.drivers.page.stepRideGo;
    target = job.status === "picked_up" ? job.dropoff : job.home;
  } else if (job.kind === "courier") {
    step = job.status === "picked_up" ? t.drivers.page.stepCourierDrive : format(t.drivers.page.stepCourierGo, { n: job.collectFcfa });
    target = job.status === "picked_up" ? job.dropoff : job.home;
  } else if (job.kind === "pickup") {
    step = job.status === "picked_up" ? format(t.drivers.page.stepPickupBring, { no: job.trackingNo ?? "", to: name(job.toStationId) }) : t.drivers.page.stepPickupGo;
    target = job.status === "picked_up" ? (station(job.toStationId) ?? null) : job.home;
  } else {
    step =
      job.status === "returning"
        ? format(t.drivers.page.stepReturn, { to: name(job.fromStationId) })
        : job.status === "picked_up" || job.status === "at_door"
          ? t.drivers.page.stepDeliveryGo
          : format(t.drivers.page.stepDeliveryFetch, { from: name(job.fromStationId) });
    target = job.status === "picked_up" || job.status === "at_door" ? job.home : (station(job.fromStationId) ?? null);
  }

  if (job.status === "assigned") {
    return (
      <Card title={t.drivers.page.offer} className="animate-gp-slide-up">
        <JobFacts job={job} route={route(job, name)} />
        <p className="text-sm font-medium">{format(t.drivers.page.earning, { n: driverEarning(job.fareFcfa, home.settings) })}</p>
        {job.assignedAt && <OfferCountdown assignedAt={job.assignedAt} minutes={home.settings.acceptMinutes} />}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primary} disabled={busy} onClick={() => void run(() => backend.acceptJob(job.id))}>
            {t.drivers.page.accept}
          </button>
          <button type="button" className={secondary} disabled={busy} onClick={() => void run(() => backend.declineJob(job.id))}>
            {t.drivers.page.decline}
          </button>
        </div>
        {status}
      </Card>
    );
  }

  return (
    <Card title={t.drivers.page.jobTitle}>
      <div className="flex flex-wrap items-center gap-2">
        <JobStatusPill status={job.status} kind={job.kind} />
        {job.trackingNo && <span className="font-mono text-sm">{job.trackingNo}</span>}
      </div>
      <JobFacts job={job} route={route(job, name)} />
      <p className="rounded-lg bg-gp-green/10 p-3 text-sm">{step}</p>
      <div className="flex flex-wrap gap-2 text-sm">
        {target && (
          <a className={secondary} href={directionsUrl(target)} target="_blank" rel="noreferrer">
            🧭 {t.drivers.page.directions}
          </a>
        )}
        {job.home?.phone && job.status !== "returning" && !(job.kind === "courier" && job.status === "picked_up") && (
          <a className={secondary} href={`tel:${job.home.phone}`}>
            📞 {t.drivers.page.call} {job.customerName ?? ""}
          </a>
        )}
        {job.kind === "courier" && job.status === "picked_up" && job.recipient && (
          <a className={secondary} href={`tel:${job.recipient.phone}`}>
            📞 {t.drivers.page.call} {job.recipient.name ?? job.recipient.phone}
          </a>
        )}
      </div>
      {job.collectFcfa > 0 && !(job.kind === "courier" && job.status === "picked_up") && <p className="text-sm font-semibold">{format(t.drivers.page.collect, { n: job.collectFcfa })}</p>}
      <p className="text-xs text-zinc-500">{format(t.drivers.page.earning, { n: driverEarning(job.fareFcfa, home.settings) })}</p>
      {job.kind === "pickup" && job.status === "accepted" && <PickupCollect job={job} info={info} onDone={(no) => setCollected(format(t.drivers.page.collected, { no }))} />}
      {job.kind === "delivery" && (job.status === "picked_up" || job.status === "at_door") && <DoorActions job={job} home={home} />}
      {job.kind === "ride" && job.status === "accepted" && (
        <button type="button" className={primary} disabled={busy} onClick={() => void run(() => backend.boardRide(job.id))}>
          {t.drivers.page.boardButton}
        </button>
      )}
      {job.kind === "ride" && job.status === "picked_up" && (
        <button type="button" className={primary} disabled={busy} onClick={() => void run(() => backend.finishRide(job.id), t.drivers.page.finished)}>
          {format(t.drivers.page.finishButton, { n: job.collectFcfa })}
        </button>
      )}
      {job.kind === "courier" && job.status === "accepted" && (
        <button type="button" className={primary} disabled={busy} onClick={() => void run(() => backend.boardRide(job.id))}>
          {format(t.drivers.page.courierPickButton, { n: job.collectFcfa })}
        </button>
      )}
      {job.kind === "courier" && job.status === "picked_up" && (
        <button type="button" className={primary} disabled={busy} onClick={() => void run(() => backend.finishRide(job.id), t.drivers.page.courierDone)}>
          {t.drivers.page.courierDoneButton}
        </button>
      )}
      {job.status === "accepted" && <AbandonButton job={job} />}
      <Notice error="" notice={collected} />
      {status}
    </Card>
  );
}

/** Time left to confirm an offer, as mm:ss and a bar that drains. */
function OfferCountdown({ assignedAt, minutes }: { assignedAt: string; minutes: number }) {
  const { t } = useI18n();
  const now = useNow(1000);
  const total = minutes * 60_000;
  const left = Math.max(0, new Date(assignedAt).getTime() + total - now.getTime());
  const seconds = Math.ceil(left / 1000);
  const mmss = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  const share = total > 0 ? left / total : 0;
  return (
    <div className="space-y-1">
      <div className="h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/10" aria-hidden>
        <div
          className={`h-full rounded-full motion-safe:transition-[width] motion-safe:duration-1000 motion-safe:ease-linear ${share < 0.25 ? "bg-amber-500" : "bg-gp-green"}`}
          style={{ width: `${share * 100}%` }}
        />
      </div>
      <p className="text-xs text-zinc-500">{format(t.drivers.page.offerHint, { left: mmss })}</p>
    </div>
  );
}

/** Gives an accepted trip back before the pickup, with the reason. */
function AbandonButton({ job }: { job: DeliveryJob }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const { run, busy, status } = useAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<AbandonReason>("customer_absent");
  return (
    <div>
      <button type="button" className={secondary} disabled={busy} onClick={() => setOpen(true)}>
        {t.drivers.page.abandon}
      </button>
      {status}
      <ConfirmSheet
        open={open}
        title={t.drivers.page.abandonTitle}
        confirmLabel={t.drivers.page.abandon}
        danger
        busy={busy}
        onCancel={() => setOpen(false)}
        onConfirm={() => void run(() => backend.abandonJob(job.id, reason), t.drivers.page.abandoned).then(() => setOpen(false))}
      >
        <p>{t.drivers.page.abandonHint}</p>
        <fieldset className="space-y-2">
          <legend className="sr-only">{t.drivers.page.abandonTitle}</legend>
          {ABANDON_REASONS.map((r) => (
            <label key={r} className="flex min-h-11 items-center gap-3 rounded-lg border border-black/10 px-3 dark:border-white/15">
              <input type="radio" name="abandon-reason" value={r} checked={reason === r} onChange={() => setReason(r)} />
              {t.drivers.page.abandonReason[r]}
            </label>
          ))}
        </fieldset>
      </ConfirmSheet>
    </div>
  );
}

/** Once per expired offer: the driver did not confirm in time and is back in line. */
function ExpiredNotice({ at }: { at: string }) {
  const { t } = useI18n();
  // Old expiries (another device, long ago) are not news any more.
  const [shown, setShown] = useState(() => Date.now() - new Date(at).getTime() < 60 * 60_000 && readStored(EXPIRED_SEEN_KEY) !== at);
  useEffect(() => {
    if (!shown) return;
    try {
      window.localStorage.setItem(EXPIRED_SEEN_KEY, at);
    } catch {
      // Without storage the notice may come back on the next visit.
    }
  }, [shown, at]);
  if (!shown) return null;
  return (
    <p role="status" className="animate-gp-slide-up flex items-start gap-2 rounded-lg bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
      <span className="flex-1">{t.drivers.page.offerExpired}</span>
      <button type="button" className="font-semibold" aria-label={t.drivers.customer.close} onClick={() => setShown(false)}>
        ✕
      </button>
    </p>
  );
}

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

const EXPIRED_SEEN_KEY = "poinderecharge-driver-expired-seen";

function JobFacts({ job, route }: { job: DeliveryJob; route: string }) {
  const { t } = useI18n();
  return (
    <div className="text-sm text-zinc-700 dark:text-zinc-300">
      <div className="font-medium">{t.drivers.kind[job.kind]}</div>
      <div>{route}</div>
      {job.kind === "ride" ? (
        <div>
          {format(t.drivers.page.passengers, { n: job.passengers ?? 1 })} · {formatDistance(job.distanceM)}
        </div>
      ) : (
        <div>
          {t.parcels.size} {job.size}
          {job.weightKg ? ` · ${job.weightKg} kg` : ""} · {formatDistance(job.distanceM)}
          {job.content ? ` · ${job.content}` : ""}
          {job.kind === "courier" && job.recipient && (
            <>
              <br />
              {t.drivers.customer.recipientPhone} : {job.recipient.name ? `${job.recipient.name} · ` : ""}
              {job.recipient.phone}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function History({ jobs, stations }: { jobs: DeliveryJob[]; stations: StationView[] }) {
  const { t } = useI18n();
  const when = useDateTime();
  const fcfa = useFcfa();
  const route = useJobRoute();
  const name = (id: string | null) => stations.find((s) => s.id === id)?.name ?? "?";
  if (jobs.length === 0) return null;
  return (
    <Card title={t.drivers.page.history}>
      <ul className="space-y-1 text-sm">
        {jobs.map((j) => (
          <li key={j.id} className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-zinc-500">{when(j.createdAt)}</span>
            <span className="flex-1">{route(j, name)}</span>
            <JobStatusPill status={j.status} kind={j.kind} />
            <span className="font-mono text-xs">{fcfa(j.fareFcfa)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** The driver page (/chauffeur): apply, then queue at a station and carry out trips. */
export function DriverPanel() {
  const { t } = useI18n();
  const { backend, features, profile } = useApp();
  const { data, error } = useLiveQuery(() => Promise.all([backend.driverHome(), backend.listStations(), backend.parcelInfo()]));

  if (error) return <p className="p-6 text-sm text-red-600">{t.errors.unknown}</p>;
  if (!data) return <p className="p-6 text-sm text-zinc-500">{t.loading}</p>;
  const [home, stations, info] = data;
  const driver = home.driver;

  const soon = <p className="rounded-xl border border-black/10 p-4 text-sm dark:border-white/10">{t.drivers.page.soon}</p>;
  let body: ReactNode;
  if (!features.drivers && !home.job) {
    // Driver module off: no applications and no queue; a driver still sees what they earned.
    body = (
      <>
        {soon}
        {driver && driver.status !== "pending" && driver.status !== "rejected" && (
          <>
            <Balance home={home} />
            <History jobs={home.history} stations={stations} />
          </>
        )}
      </>
    );
  } else if (
    profile &&
    profile.role !== "customer" &&
    !(profile.role === "driver" && driver) &&
    (!driver || driver.status === "rejected" || driver.status === "pending")
  ) {
    // Only a customer account applies (one role per account, R15). A driver account that joined
    // a fleet by invite (W6) completes its own application and documents here.
    body = <p className="rounded-xl border border-black/10 p-4 text-sm dark:border-white/10">{t.drivers.page.onlyCustomers}</p>;
  } else if (!driver || driver.status === "rejected") {
    body = (
      <>
        {driver && <p className="rounded-lg bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">{t.drivers.page.rejected}</p>}
        <ApplyForm driver={driver} />
        {driver && <Documents driver={driver} />}
      </>
    );
  } else if (driver.status === "pending") {
    body = (
      <>
        <p className="rounded-lg bg-gp-green/10 p-3 text-sm">{t.drivers.page.pending}</p>
        <Documents driver={driver} />
        <ApplyForm driver={driver} />
      </>
    );
  } else if (driver.status === "suspended") {
    body = (
      <>
        <p className="rounded-lg bg-red-100 p-3 text-sm text-red-800 dark:bg-red-900/40 dark:text-red-200">{t.drivers.page.suspended}</p>
        <Balance home={home} />
      </>
    );
  } else {
    body = (
      <>
        {!driver.vehicle && <p className="rounded-lg bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">{t.drivers.page.noVehicle}</p>}
        {home.lastExpiredAt && home.job?.status !== "assigned" && <ExpiredNotice key={home.lastExpiredAt} at={home.lastExpiredAt} />}
        {home.job ? (
          <CurrentJob key={home.job.id} job={home.job} home={home} stations={stations} info={info} />
        ) : (
          driver.vehicle && <Queue driver={driver} stations={stations} info={info} />
        )}
        <Badge driver={driver} />
        <Balance home={home} />
        <History jobs={home.history} stations={stations} />
      </>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 overflow-y-auto p-6">
      <h1 className="text-2xl font-semibold">{t.drivers.page.title}</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{format(t.drivers.page.intro, { pct: home.settings.driverSharePct })}</p>
      {home.formerAccount && <FormerAccountCard former={home.formerAccount} />}
      {features.drivers && !driver && <FleetInvitesCard />}
      {body}
    </div>
  );
}
