"use client";

import dynamic from "next/dynamic";
import { useState, type FormEvent } from "react";
import { useDateTime } from "@/components/backoffice/shared";
import {
  fareFor,
  inServiceArea,
  vehicleFits,
  OPEN_JOB_STATUSES,
  type DeliveryJob,
  type DropoffPoint,
  type HomePoint,
  type BookableVehicleType,
} from "@/lib/drivers";
import { distanceMeters, type LatLng } from "@/lib/geo";
import { useErrorMessage, useNow } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { PARCEL_SIZES, type Parcel, type ParcelInfo, type ParcelSize } from "@/lib/parcels";
import type { StationView } from "@/lib/types";
import { usePosition } from "@/lib/use-position";
import { useApp } from "../app-provider";
import { useI18n } from "../i18n-provider";
import { input, JobStatusPill, Notice, primary, secondary, small, useFcfa, useJobRoute } from "./shared";

const HomePicker = dynamic(() => import("./home-picker").then((m) => m.HomePicker), { ssr: false });

/** Map pin, "my position", directions and phone: where the driver should go. */
function HomeFields({ value, onChange, title }: { value: HomePoint; onChange: (h: HomePoint) => void; title?: string }) {
  const { t } = useI18n();
  const { profile } = useApp();
  const { position } = usePosition();
  const [flyTo, setFlyTo] = useState(0);
  const pinned = value.lat !== 0 || value.lng !== 0;
  const outside = pinned && !inServiceArea(value);
  const label = "space-y-1 text-sm";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="flex-1 font-medium">{title ?? t.drivers.customer.where}</span>
        <button
          type="button"
          className={small}
          disabled={!position}
          onClick={() => {
            if (!position) return;
            onChange({ ...value, ...position });
            setFlyTo((n) => n + 1);
          }}
        >
          📍 {t.drivers.customer.myPosition}
        </button>
      </div>
      <HomePicker value={pinned ? value : null} onChange={(p: LatLng) => onChange({ ...value, ...p })} flyTo={flyTo} />
      <p className={`text-xs ${outside ? "text-red-600" : "text-zinc-500"}`}>{outside ? t.drivers.customer.outsideArea : t.drivers.customer.mapHint}</p>
      <label className={label}>
        <span>{t.drivers.customer.note}</span>
        <input className={input} required maxLength={300} value={value.note} onChange={(e) => onChange({ ...value, note: e.target.value })} />
      </label>
      <label className={label}>
        <span>{t.drivers.customer.phone}</span>
        <input
          className={input}
          type="tel"
          required
          value={value.phone}
          placeholder={profile?.phone ?? "90 12 34 56"}
          onChange={(e) => onChange({ ...value, phone: e.target.value })}
        />
      </label>
    </div>
  );
}

function useEmptyHome(): HomePoint {
  const { profile } = useApp();
  return { lat: 0, lng: 0, note: "", phone: profile?.phone ?? "" };
}

/** One button per parcel size (S, M, L, XL) with its weight; the chosen size's dimensions underneath. */
function SizePicker({ info, sizes, value, onChange }: { info: ParcelInfo; sizes: readonly ParcelSize[]; value: ParcelSize; onChange: (s: ParcelSize) => void }) {
  const { t } = useI18n();
  const chosen = info.sizes.find((x) => x.size === value);
  return (
    <div className="space-y-1 text-sm">
      <span>{t.drivers.customer.size}</span>
      <div role="radiogroup" aria-label={t.drivers.customer.size} className="grid grid-cols-4 gap-2">
        {sizes.map((size) => {
          const s = info.sizes.find((x) => x.size === size);
          const on = size === value;
          return (
            <button
              key={size}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange(size)}
              className={`flex flex-col items-center rounded-xl border py-2 ${
                on ? "border-gp-green-dark bg-gp-green-dark text-white" : "border-black/15 dark:border-white/20"
              }`}
            >
              <span className="text-lg font-bold leading-tight">{size}</span>
              {s && <span className={`text-xs ${on ? "text-white/80" : "text-zinc-500"}`}>≤ {s.maxWeightKg} kg</span>}
            </button>
          );
        })}
      </div>
      {chosen && (
        <p className="text-xs text-zinc-500">{value} : {format(t.parcels.upTo, { dims: `${chosen.maxLengthCm}×${chosen.maxWidthCm}×${chosen.maxHeightCm}`, kg: chosen.maxWeightKg })}</p>
      )}
    </div>
  );
}

/**
 * The customer books a driver to fetch a parcel at home and bring it to a station.
 * `open` shows the form directly instead of behind a fold.
 */
export function BookPickup({ info, stations, open }: { info: ParcelInfo; stations: StationView[]; open?: boolean }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const [home, setHome] = useState(useEmptyHome());
  const [form, setForm] = useState({ toStationId: "", recipientPhone: "", content: "", size: "S" as ParcelSize });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const destinations = info.depots.map((d) => stations.find((s) => s.id === d.stationId)).filter((s): s is StationView => !!s);
  const to = destinations.find((s) => s.id === form.toStationId);
  const pinned = home.lat !== 0 || home.lng !== 0;
  const fare = to && pinned ? fareFor(distanceMeters(home, to), false, info.driverSettings) : null;
  const tier = info.sizes.find((s) => s.size === form.size);
  const label = "space-y-1 text-sm";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await backend.bookPickup({
        home,
        toStationId: form.toStationId,
        recipientPhone: form.recipientPhone,
        content: form.content,
        size: form.size,
        declaredValue: null,
      });
      setNotice(t.drivers.customer.booked);
      setForm((f) => ({ ...f, recipientPhone: "", content: "" }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const formBody = (
    <form onSubmit={submit} className="mt-3 space-y-3">
      <p className="text-zinc-600 dark:text-zinc-400">{t.drivers.customer.pickupIntro}</p>
      <HomeFields value={home} onChange={setHome} />
      <label className={label}>
        <span>{t.drivers.customer.destination}</span>
        <select className={input} required value={form.toStationId} onChange={set("toStationId")}>
          <option value="">{t.drivers.customer.chooseDestination}</option>
          {destinations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        <span>{t.drivers.customer.recipientPhone}</span>
        <input className={input} type="tel" required value={form.recipientPhone} onChange={set("recipientPhone")} placeholder="90 12 34 56" />
      </label>
      <label className={label}>
        <span>{t.drivers.customer.content}</span>
        <input className={input} required maxLength={300} value={form.content} onChange={set("content")} />
      </label>
      <SizePicker info={info} sizes={PARCEL_SIZES} value={form.size} onChange={(size) => setForm((f) => ({ ...f, size }))} />
      {fare !== null && tier && <p className="font-semibold">{format(t.drivers.customer.estimate, { parcel: tier.priceFcfa, fare })}</p>}
      <p className="text-xs text-zinc-500">{t.drivers.customer.giveRight}</p>
      <button type="submit" className={primary} disabled={busy || !pinned || !inServiceArea(home)}>
        {t.drivers.customer.book}
      </button>
      <Notice error={error} notice={notice} />
    </form>
  );

  if (open) {
    return (
      <section className="rounded-xl border border-black/10 p-4 text-sm dark:border-white/10">
        <h2 className="font-semibold">{t.drivers.customer.pickupTitle}</h2>
        {formBody}
      </section>
    );
  }
  return (
    <details className="rounded-xl border border-black/10 p-4 text-sm dark:border-white/10">
      <summary className="cursor-pointer font-semibold">🛵 {t.drivers.customer.pickupTitle}</summary>
      {formBody}
    </details>
  );
}

/** Where a ride or courier ends: a pin on the map and directions. */
function DropoffFields({ value, onChange, title, hint, noteLabel }: { value: DropoffPoint; onChange: (d: DropoffPoint) => void; title: string; hint: string; noteLabel: string }) {
  const { t } = useI18n();
  const pinned = value.lat !== 0 || value.lng !== 0;
  const outside = pinned && !inServiceArea(value);
  return (
    <div className="space-y-3">
      <span className="block font-medium">{title}</span>
      <HomePicker value={pinned ? value : null} onChange={(p: LatLng) => onChange({ ...value, ...p })} flyTo={0} />
      <p className={`text-xs ${outside ? "text-red-600" : "text-zinc-500"}`}>{outside ? t.drivers.customer.outsideArea : hint}</p>
      <label className="space-y-1 text-sm">
        <span>{noteLabel}</span>
        <input className={input} required maxLength={300} value={value.note} onChange={(e) => onChange({ ...value, note: e.target.value })} />
      </label>
    </div>
  );
}

const pinned = (p: { lat: number; lng: number }) => p.lat !== 0 || p.lng !== 0;

/**
 * A driver takes a parcel at one place and brings it straight to its destination.
 * Without `vehicle`: "Envoi express" on the Colis tab, any vehicle that fits.
 * With `vehicle`: the "Courses" tab, only that kind of vehicle and the sizes it carries.
 */
export function BookCourier({ info, vehicle }: { info: ParcelInfo; vehicle?: BookableVehicleType }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const [pickup, setPickup] = useState(useEmptyHome());
  const [dropoff, setDropoff] = useState<DropoffPoint>({ lat: 0, lng: 0, note: "" });
  const [form, setForm] = useState({ recipientPhone: "", content: "", size: "S" as ParcelSize });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const ready = pinned(pickup) && pinned(dropoff) && inServiceArea(pickup) && inServiceArea(dropoff);
  const fare = pinned(pickup) && pinned(dropoff) ? fareFor(distanceMeters(pickup, dropoff), false, info.driverSettings) : null;
  const sizes = PARCEL_SIZES.filter((size) => {
    const tier = info.sizes.find((x) => x.size === size);
    return !vehicle || (tier && vehicleFits(vehicle, size, tier.maxWeightKg, info.driverSettings));
  });
  const label = "space-y-1 text-sm";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await backend.bookCourier({
        vehicleType: vehicle,
        pickup,
        dropoff,
        recipientPhone: form.recipientPhone,
        content: form.content,
        size: form.size,
      });
      setNotice(t.drivers.customer.courierBooked);
      setForm((f) => ({ ...f, recipientPhone: "", content: "" }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-black/10 p-4 text-sm dark:border-white/10">
      <h2 className="font-semibold">{vehicle ? t.drivers.customer.orderTitle : t.drivers.customer.courierTitle}</h2>
      <form onSubmit={submit} className="mt-3 space-y-3">
        <p className="text-zinc-600 dark:text-zinc-400">{vehicle ? t.drivers.customer.orderIntro : t.drivers.customer.courierIntro}</p>
        {vehicle && <p className="font-medium">{format(t.drivers.customer.orderVehicle, { v: t.ui.trips[vehicle] })}</p>}
        <HomeFields value={pickup} onChange={setPickup} title={t.drivers.customer.courierFrom} />
        <DropoffFields
          value={dropoff}
          onChange={setDropoff}
          title={t.drivers.customer.courierTo}
          hint={t.drivers.customer.courierToHint}
          noteLabel={t.drivers.customer.courierToNote}
        />
        <label className={label}>
          <span>{t.drivers.customer.recipientPhone}</span>
          <input className={input} type="tel" required value={form.recipientPhone} onChange={set("recipientPhone")} placeholder="90 12 34 56" />
        </label>
        <label className={label}>
          <span>{t.drivers.customer.content}</span>
          <input className={input} required maxLength={300} value={form.content} onChange={set("content")} />
        </label>
        <SizePicker info={info} sizes={sizes} value={form.size} onChange={(size) => setForm((f) => ({ ...f, size }))} />
        {fare !== null && <p className="font-semibold">{format(t.drivers.customer.courierEstimate, { fare })}</p>}
        <button type="submit" className={primary} disabled={busy || !ready}>
          {t.drivers.customer.courierBook}
        </button>
        <Notice error={error} notice={notice} />
      </form>
    </section>
  );
}

/** The recipient of a waiting parcel has it brought home. */
export function BookDelivery({ parcel, station, info }: { parcel: Parcel; station: StationView | undefined; info: ParcelInfo }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const [open, setOpen] = useState(false);
  const [home, setHome] = useState(useEmptyHome());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pinned = home.lat !== 0 || home.lng !== 0;
  const fare = station && pinned ? fareFor(distanceMeters(station, home), false, info.driverSettings) : null;

  if (!open) {
    return (
      <button type="button" className={secondary} onClick={() => setOpen(true)}>
        🛵 {t.drivers.customer.deliverTitle}
      </button>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await backend.bookDelivery(parcel.id, home);
      setOpen(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-lg border border-black/10 p-3 text-sm dark:border-white/10">
      <h3 className="font-semibold">{t.drivers.customer.deliverTitle}</h3>
      <p className="text-zinc-600 dark:text-zinc-400">{t.drivers.customer.deliverIntro}</p>
      <HomeFields value={home} onChange={setHome} />
      {fare !== null && <p className="font-semibold">{format(t.drivers.customer.deliverFare, { n: fare })}</p>}
      <p className="text-xs text-zinc-500">{t.drivers.customer.deliverHint}</p>
      <div className="flex flex-wrap gap-2">
        <button type="submit" className={primary} disabled={busy || !pinned || !inServiceArea(home)}>
          {t.drivers.customer.deliverBook}
        </button>
        <button type="button" className={secondary} onClick={() => setOpen(false)}>
          {t.drivers.customer.close}
        </button>
      </div>
      <Notice error={error} notice="" />
    </form>
  );
}

/** Trips the customer booked: status, driver and a way to cancel. */
export function MyJobs({ jobs, stations, title }: { jobs: DeliveryJob[]; stations: StationView[]; title?: string }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const when = useDateTime();
  const fcfa = useFcfa();
  const route = useJobRoute();
  const now = useNow(60_000);
  const [error, setError] = useState("");
  const name = (id: string | null) => stations.find((s) => s.id === id)?.name ?? "?";
  const shown = jobs.filter((j) => OPEN_JOB_STATUSES.includes(j.status) || now.getTime() - new Date(j.createdAt).getTime() < 7 * 86_400_000);
  if (shown.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="font-semibold">{title ?? t.drivers.customer.jobsTitle}</h2>
      <Notice error={error} notice="" />
      <ul className="space-y-2">
        {shown.map((j) => (
          <li key={j.id} className="space-y-1 rounded-xl border border-black/10 p-3 text-sm dark:border-white/10">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{t.drivers.kind[j.kind]}</span>
              <JobStatusPill status={j.status} kind={j.kind} />
              {j.trackingNo && <span className="font-mono text-xs">{j.trackingNo}</span>}
              <span className="ml-auto text-xs text-zinc-500">{when(j.createdAt)}</span>
            </div>
            <div className="text-zinc-700 dark:text-zinc-300">{route(j, name)}</div>
            {j.driver && (
              <div>
                {format(t.drivers.customer.driverLine, {
                  name: j.driver.name,
                  vehicle: j.driver.vehicleType ? t.drivers.vehicle[j.driver.vehicleType] : "",
                  plate: j.driver.plate ?? "",
                })}
                {j.driver.phone && OPEN_JOB_STATUSES.includes(j.status) && (
                  <a href={`tel:${j.driver.phone}`} className="ml-2 text-gp-green-dark underline dark:text-gp-green">
                    {j.driver.phone}
                  </a>
                )}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {j.collectFcfa > 0 && <span className="font-semibold">{fcfa(j.collectFcfa)}</span>}
              <span className="flex-1" />
              {["open", "assigned", "accepted"].includes(j.status) && (
                <button
                  type="button"
                  className={small}
                  onClick={() => {
                    if (!window.confirm(t.drivers.customer.confirmCancel)) return;
                    setError("");
                    backend.cancelJob(j.id).catch((err) => setError(errorMessage(err)));
                  }}
                >
                  {t.drivers.customer.cancel}
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
