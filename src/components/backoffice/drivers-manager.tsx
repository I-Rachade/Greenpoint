"use client";

import { useState } from "react";
import { useApp } from "@/components/app-provider";
import { JobStatusPill, useJobRoute } from "@/components/drivers/shared";
import { useI18n } from "@/components/i18n-provider";
import {
  DRIVER_DOCUMENTS,
  FLEET_VEHICLE_TYPES,
  OPEN_JOB_STATUSES,
  type DeliveryJob,
  type Driver,
  type DriverDecision,
  type DriverSettings,
  type DriverStatus,
  type FleetVehicle,
  type FleetVehicleType,
} from "@/lib/drivers";
import { formatDistance } from "@/lib/geo";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { PARCEL_SIZES, type ParcelSize } from "@/lib/parcels";
import { card, field, Loading, Pill, Table, td, th, useDateTime } from "./shared";

type Report = (msg: string, ok: boolean) => void;
const smallBtn = "rounded-full border border-black/15 px-2 py-0.5 text-xs disabled:opacity-30 dark:border-white/20";
const saveBtn = "rounded-full bg-gp-green-dark px-3 py-1 text-xs text-white disabled:opacity-30";
const STATUS_TONE: Record<DriverStatus, "green" | "amber" | "red" | "gray"> = { pending: "amber", active: "green", rejected: "gray", suspended: "red" };

function useRun(onReport: Report) {
  const { t } = useI18n();
  const errorMessage = useErrorMessage();
  return async (action: () => Promise<unknown>) => {
    try {
      await action();
      onReport(t.drivers.admin.saved, true);
    } catch (err) {
      onReport(errorMessage(err), false);
    }
  };
}

function DocLink({ fileKey, label }: { fileKey: string; label: string }) {
  const { backend } = useApp();
  return (
    <button
      type="button"
      className="text-xs text-gp-green-dark underline dark:text-gp-green"
      onClick={() => {
        // Opened first, filled once the private photo has loaded (pop-up blockers allow only direct opens).
        const tab = window.open("", "_blank");
        backend.driverFileUrl(fileKey).then(
          (url) => {
            if (tab) tab.location.href = url;
          },
          () => tab?.close(),
        );
      }}
    >
      {label}
    </button>
  );
}

/** Who manages the driver (src/lib/fleet.ts): linked by the manager's phone or e-mail. */
function ManagerCell({ driver, onReport }: { driver: Driver; onReport: Report }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const run = useRun(onReport);
  const [contact, setContact] = useState("");
  if (driver.status !== "active" && driver.status !== "suspended") return null;
  const a = t.drivers.admin;
  if (driver.manager) {
    const manager = driver.manager;
    return (
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <span>{manager.label}</span>
        <button
          type="button"
          className={smallBtn}
          onClick={() =>
            window.confirm(format(a.confirmRemoveManager, { driver: driver.fullName, manager: manager.label })) &&
            void run(() => backend.setDriverManager(driver.userId, null))
          }
        >
          {a.removeManager}
        </button>
      </div>
    );
  }
  return (
    <form
      className="flex flex-wrap items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => backend.setDriverManager(driver.userId, contact));
      }}
    >
      <input
        className={`${field} w-40`}
        value={contact}
        onChange={(e) => setContact(e.target.value)}
        placeholder={a.managerContact}
        aria-label={a.managerContact}
        required
      />
      <button type="submit" className={saveBtn}>
        {a.setManager}
      </button>
    </form>
  );
}

function DriverRow({ driver, vehicles, drivers, onReport }: { driver: Driver; vehicles: FleetVehicle[]; drivers: Driver[]; onReport: Report }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const when = useDateTime();
  const run = useRun(onReport);
  const [vehicleId, setVehicleId] = useState(driver.vehicle?.id ?? "");
  const taken = new Set(drivers.filter((d) => d.userId !== driver.userId && d.vehicle).map((d) => d.vehicle!.id));
  const free = vehicles.filter((v) => v.isActive && !taken.has(v.id));
  const review = (decision: DriverDecision) => run(() => backend.reviewDriver(driver.userId, decision));

  return (
    <tr>
      <td className={td}>
        <div className="font-medium">{driver.fullName}</div>
        <div className="text-xs text-zinc-500">{driver.phone}</div>
        <div className="text-xs text-zinc-500">{when(driver.createdAt)}</div>
      </td>
      <td className={td}>
        <Pill tone={STATUS_TONE[driver.status]}>{t.drivers.admin.statusLabel[driver.status]}</Pill>
        <div className="mt-1 text-xs">{format(t.drivers.admin.wants, { type: t.drivers.vehicle[driver.wantedType] })}</div>
      </td>
      <td className={td}>
        <div className="text-xs">
          ID {driver.idNumber}
          <br />
          {t.drivers.page.doc.license} {driver.licenseNumber}
        </div>
        <div className="mt-1 flex flex-wrap gap-2">
          {DRIVER_DOCUMENTS.map((kind) =>
            driver.documents[kind] ? (
              <DocLink key={kind} fileKey={driver.documents[kind]!} label={t.drivers.page.doc[kind]} />
            ) : (
              <span key={kind} className="text-xs text-amber-700 dark:text-amber-300">
                {t.drivers.page.doc[kind]} ✗
              </span>
            ),
          )}
        </div>
      </td>
      <td className={td}>
        <select className={field} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} aria-label={t.drivers.admin.chooseVehicle}>
          <option value="">{t.drivers.admin.chooseVehicle}</option>
          {free.map((v) => (
            <option key={v.id} value={v.id}>
              {t.drivers.vehicle[v.type]} · {v.plate}
            </option>
          ))}
        </select>
        {driver.status === "active" && vehicleId !== (driver.vehicle?.id ?? "") && (
          <button type="button" className={`${saveBtn} ml-1`} onClick={() => void review({ action: "vehicle", vehicleId: vehicleId || null })}>
            {t.drivers.admin.save}
          </button>
        )}
      </td>
      <td className={`${td} font-mono`}>{driver.balanceFcfa}</td>
      <td className={td}>
        <ManagerCell driver={driver} onReport={onReport} />
      </td>
      <td className={td}>
        <div className="flex flex-wrap gap-1">
          {(driver.status === "pending" || driver.status === "rejected") && (
            <button type="button" className={saveBtn} disabled={!vehicleId} onClick={() => void review({ action: "approve", vehicleId })}>
              {t.drivers.admin.approve}
            </button>
          )}
          {driver.status === "pending" && (
            <button type="button" className={smallBtn} onClick={() => window.confirm(t.drivers.admin.confirmReject) && void review({ action: "reject" })}>
              {t.drivers.admin.reject}
            </button>
          )}
          {driver.status === "active" && (
            <button type="button" className={smallBtn} onClick={() => window.confirm(t.drivers.admin.confirmSuspend) && void review({ action: "suspend" })}>
              {t.drivers.admin.suspend}
            </button>
          )}
          {driver.status === "suspended" && (
            <button type="button" className={smallBtn} onClick={() => void review({ action: "reactivate" })}>
              {t.drivers.admin.reactivate}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function VehicleRow({ vehicle, driver, onReport }: { vehicle: FleetVehicle | null; driver: Driver | undefined; onReport: Report }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const run = useRun(onReport);
  const [type, setType] = useState<FleetVehicleType>(vehicle?.type ?? "moto");
  const [plate, setPlate] = useState(vehicle?.plate ?? "");
  const [isActive, setActive] = useState(vehicle?.isActive ?? true);
  const dirty = !vehicle ? plate.trim().length >= 2 : type !== vehicle.type || plate !== vehicle.plate || isActive !== vehicle.isActive;
  return (
    <tr>
      <td className={td}>
        <select className={field} value={type} onChange={(e) => setType(e.target.value as FleetVehicleType)} aria-label={t.drivers.admin.type}>
          {FLEET_VEHICLE_TYPES.map((v) => (
            <option key={v} value={v}>
              {t.drivers.vehicle[v]}
            </option>
          ))}
        </select>
      </td>
      <td className={td}>
        <input className={`${field} w-32 font-mono uppercase`} value={plate} maxLength={20} onChange={(e) => setPlate(e.target.value.toUpperCase())} aria-label={t.drivers.admin.plate} />
      </td>
      <td className={td}>
        <input type="checkbox" checked={isActive} onChange={(e) => setActive(e.target.checked)} aria-label={t.drivers.admin.active} />
      </td>
      <td className={td}>{driver?.fullName ?? ""}</td>
      <td className={td}>
        <button
          type="button"
          className={saveBtn}
          disabled={!dirty}
          onClick={() => void run(() => backend.saveFleetVehicle(vehicle?.id ?? null, { type, plate: plate.trim(), isActive }))}
        >
          {vehicle ? t.drivers.admin.save : t.drivers.admin.add}
        </button>
      </td>
    </tr>
  );
}

function SettingsForm({ settings, onReport }: { settings: DriverSettings; onReport: Report }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const run = useRun(onReport);
  const [s, setS] = useState(settings);
  const keys = ["baseFcfa", "perKmFcfa", "expressFcfa", "driverSharePct", "cashLimitFcfa", "waitMinutes", "acceptMinutes", "queueRadiusM"] as const;
  return (
    <div className={`${card} space-y-3`}>
      <div className="grid gap-3 sm:grid-cols-4">
        {keys.map((key) => (
          <label key={key} className="space-y-1 text-sm">
            <span className="block text-xs text-zinc-500">{t.drivers.admin[key]}</span>
            <input className={`${field} w-full`} inputMode="numeric" value={s[key]} onChange={(e) => setS({ ...s, [key]: Number(e.target.value.replace(/\D/g, "")) || 0 })} />
          </label>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {s.vehicles.map((v, i) => (
          <div key={v.type} className="space-y-1 text-sm">
            <div className="font-medium">{t.drivers.vehicle[v.type]}</div>
            <div className="flex gap-2">
              <select
                className={field}
                value={v.maxSize}
                aria-label={t.drivers.admin.maxSize}
                onChange={(e) => setS({ ...s, vehicles: s.vehicles.map((x, j) => (j === i ? { ...x, maxSize: e.target.value as ParcelSize } : x)) })}
              >
                {PARCEL_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {t.drivers.admin.maxSize} {size}
                  </option>
                ))}
              </select>
              <input
                className={`${field} w-20`}
                inputMode="numeric"
                value={v.maxWeightKg}
                aria-label={t.drivers.admin.maxWeight}
                onChange={(e) => setS({ ...s, vehicles: s.vehicles.map((x, j) => (j === i ? { ...x, maxWeightKg: Number(e.target.value.replace(/\D/g, "")) || 0 } : x)) })}
              />
              <span className="self-center text-xs text-zinc-500">kg</span>
            </div>
          </div>
        ))}
      </div>
      <button type="button" className={saveBtn} disabled={JSON.stringify(s) === JSON.stringify(settings)} onClick={() => void run(() => backend.saveDriverSettings(s))}>
        {t.drivers.admin.save}
      </button>
    </div>
  );
}

function JobRow({ job, drivers, stationName, onReport }: { job: DeliveryJob; drivers: Driver[]; stationName: (id: string | null) => string; onReport: Report }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const when = useDateTime();
  const route = useJobRoute();
  const run = useRun(onReport);
  const open = OPEN_JOB_STATUSES.includes(job.status);
  const canAssign = job.status === "open" || job.status === "assigned";
  return (
    <tr>
      <td className={td}>{when(job.createdAt)}</td>
      <td className={td}>
        <div>{t.drivers.kind[job.kind]}</div>
        {job.trackingNo && <div className="font-mono text-xs">{job.trackingNo}</div>}
      </td>
      <td className={td}>
        {route(job, stationName)}
        <div className="text-xs text-zinc-500">
          {job.size} · {formatDistance(job.distanceM)}
          {job.customerName ? ` · ${job.customerName}` : ""}
          {job.home?.phone ? ` · ${job.home.phone}` : ""}
        </div>
      </td>
      <td className={td}>
        {job.fareFcfa}
        {job.collectFcfa > 0 && <div className="text-xs text-zinc-500">{job.collectFcfa}</div>}
      </td>
      <td className={td}>
        <JobStatusPill status={job.status} kind={job.kind} />
        {job.driver && <div className="mt-1 text-xs">{job.driver.name}</div>}
        {job.proofKey && <DocLink fileKey={job.proofKey} label="📷" />}
      </td>
      <td className={td}>
        <div className="flex flex-col items-start gap-1">
          {canAssign && (
            <select className={field} value="" onChange={(e) => e.target.value && void run(() => backend.assignJob(job.id, e.target.value))} aria-label={t.drivers.admin.assign}>
              <option value="">{t.drivers.admin.assign}</option>
              {drivers.map((d) => (
                <option key={d.userId} value={d.userId}>
                  {d.fullName} · {d.vehicle ? `${t.drivers.vehicle[d.vehicle.type]} ${d.vehicle.plate}` : ""}
                </option>
              ))}
            </select>
          )}
          {open && ["open", "assigned", "accepted"].includes(job.status) && (
            <button type="button" className={smallBtn} onClick={() => window.confirm(t.drivers.admin.confirmCancelJob) && void run(() => backend.cancelJob(job.id))}>
              {t.drivers.admin.cancelJob}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

/** Backoffice: driver applications, our vehicles, all trips and the prices (/admin/drivers). */
/** Switches everything a driver does (courses, express, pickups and deliveries at home) on or off for customers. */
function DriversModuleSwitch() {
  const { t } = useI18n();
  const { backend, features, featuresReady } = useApp();
  const errorMessage = useErrorMessage();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const a = t.drivers.admin;
  if (!featuresReady) return null;
  const on = features.drivers;

  async function toggle() {
    if (!window.confirm(on ? a.confirmOff : a.confirmOn)) return;
    setBusy(true);
    setError("");
    try {
      await backend.setDriversEnabled(!on);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`${card} space-y-2`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs uppercase tracking-wide text-zinc-500">{a.module}</span>
        <Pill tone={on ? "green" : "amber"}>{on ? a.moduleOn : a.moduleOff}</Pill>
        <button type="button" disabled={busy} onClick={toggle} className="text-sm text-gp-green-dark underline disabled:opacity-40 dark:text-gp-green">
          {on ? a.turnOff : a.turnOn}
        </button>
      </div>
      {!on && <p className="text-sm text-amber-700 dark:text-amber-300">{a.offHint}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  );
}

export function DriversManager() {
  const { t } = useI18n();
  const { backend } = useApp();
  const { data, error, reload } = useLiveQuery(() => Promise.all([backend.adminDrivers(), backend.listStations()]));
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(true);

  if (!data) return <Loading error={error} />;
  const [admin, stations] = data;
  const onReport: Report = (text, ok) => {
    setMessage({ text, ok });
    reload();
  };
  const stationName = (id: string | null) => stations.find((s) => s.id === id)?.name ?? "?";
  const order: DriverStatus[] = ["pending", "active", "suspended", "rejected"];
  const drivers = [...admin.drivers].sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || a.fullName.localeCompare(b.fullName));
  const assignable = drivers.filter((d) => d.status === "active" && d.vehicle);
  const jobs = onlyOpen ? admin.jobs.filter((j) => OPEN_JOB_STATUSES.includes(j.status)) : admin.jobs;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t.drivers.admin.title}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.drivers.admin.intro}</p>
      </div>
      <DriversModuleSwitch />
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-gp-green-dark dark:text-gp-green" : "text-red-600"}`}>
          {message.text}
        </p>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{t.drivers.admin.drivers}</h2>
        {drivers.length === 0 ? (
          <p className="text-sm text-zinc-500">{t.drivers.admin.none}</p>
        ) : (
          <Table
            head={
              <>
                <th className={th}>{t.drivers.admin.driver}</th>
                <th className={th} />
                <th className={th}>{t.drivers.admin.documents}</th>
                <th className={th}>{t.drivers.admin.fleet}</th>
                <th className={th}>{t.drivers.admin.balance}</th>
                <th className={th}>{t.drivers.admin.manager}</th>
                <th className={th} />
              </>
            }
          >
            {drivers.map((d) => (
              <DriverRow key={`${d.userId}:${d.status}:${d.vehicle?.id}:${d.manager?.userId}`} driver={d} vehicles={admin.vehicles} drivers={admin.drivers} onReport={onReport} />
            ))}
          </Table>
        )}
      </section>

      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-semibold">{t.drivers.admin.jobs}</h2>
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} />
            {t.drivers.admin.onlyOpen}
          </label>
        </div>
        {jobs.length === 0 ? (
          <p className="text-sm text-zinc-500">{t.drivers.admin.none}</p>
        ) : (
          <Table
            head={
              <>
                <th className={th}>{t.parcels.admin.created}</th>
                <th className={th}>{t.drivers.admin.type}</th>
                <th className={th}>
                  {t.parcels.from} → {t.parcels.to}
                </th>
                <th className={th}>FCFA</th>
                <th className={th} />
                <th className={th} />
              </>
            }
          >
            {jobs.map((j) => (
              <JobRow key={`${j.id}:${j.status}`} job={j} drivers={assignable} stationName={stationName} onReport={onReport} />
            ))}
          </Table>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{t.drivers.admin.fleet}</h2>
        <Table
          head={
            <>
              <th className={th}>{t.drivers.admin.type}</th>
              <th className={th}>{t.drivers.admin.plate}</th>
              <th className={th}>{t.drivers.admin.active}</th>
              <th className={th}>{t.drivers.admin.driver}</th>
              <th className={th} />
            </>
          }
        >
          {admin.vehicles.map((v) => (
            <VehicleRow
              key={`${v.id}:${v.type}:${v.plate}:${v.isActive}`}
              vehicle={v}
              driver={admin.drivers.find((d) => d.vehicle?.id === v.id)}
              onReport={onReport}
            />
          ))}
          <VehicleRow key={`new:${admin.vehicles.length}`} vehicle={null} driver={undefined} onReport={onReport} />
        </Table>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{t.drivers.admin.settings}</h2>
        <SettingsForm key={JSON.stringify(admin.settings)} settings={admin.settings} onReport={onReport} />
      </section>
    </div>
  );
}
