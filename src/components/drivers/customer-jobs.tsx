"use client";

import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
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
  type TripPayment,
} from "@shared/drivers";
import { distanceMeters, type LatLng } from "@shared/geo";
import { useErrorMessage, useNow } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { PARCEL_SIZES, type Parcel, type ParcelInfo, type ParcelSize } from "@shared/parcels";
import type { StationView } from "@shared/types";
import { usePosition } from "@/lib/use-position";
import { useApp } from "../app-provider";
import { SizePicker } from "../parcels/size-picker";
import { useI18n } from "../i18n-provider";
import { Button, CountUp, formatRemaining, useReducedMotion, useToast } from "../ui";
import { DriverTracking } from "./driver-tracking";
import { input, JobStatusPill, Notice, primary, secondary, small, useFcfa, useJobRoute } from "./shared";

const HomePicker = dynamic(() => import("./home-picker").then((m) => m.HomePicker), { ssr: false });

/** Map pin, "my position", directions and phone: where the driver should go. */
export function HomeFields({ value, onChange, title }: { value: HomePoint; onChange: (h: HomePoint) => void; title?: string }) {
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
      <p className={`text-xs ${outside ? "text-red-600" : "text-gp-muted"}`}>{outside ? t.drivers.customer.outsideArea : t.drivers.customer.mapHint}</p>
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

/**
 * The customer books a driver to fetch a parcel at home and bring it to a station. How it works is on its own page.
 * A shop (planung/marchand.md) passes its address as `start` and stays on its page with `onBooked`.
 */
export function BookPickup({
  info,
  stations,
  start,
  onBooked,
}: {
  info: ParcelInfo;
  stations: StationView[];
  start?: HomePoint;
  onBooked?: (job: DeliveryJob) => void;
}) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const toast = useToast();
  const blankHome = useEmptyHome();
  const emptyHome = start ?? blankHome;
  const [home, setHome] = useState(emptyHome);
  const emptyForm = { toStationId: "", recipientPhone: "", content: "", size: "S" as ParcelSize };
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const destinations = info.depots.map((d) => stations.find((s) => s.id === d.stationId)).filter((s): s is StationView => !!s);
  const to = destinations.find((s) => s.id === form.toStationId);
  const pinned = home.lat !== 0 || home.lng !== 0;
  const fare = to && pinned ? fareFor(distanceMeters(home, to), false, info.driverSettings) : null;
  const tier = info.sizes.find((s) => s.size === form.size);
  const label = "space-y-1 text-sm";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError("");
    setBusy(true);
    try {
      const job = await backend.bookPickup({
        home,
        toStationId: form.toStationId,
        recipientPhone: form.recipientPhone,
        content: form.content,
        size: form.size,
        declaredValue: null,
      });
      // Straight to the tracking, with an empty form behind: no second booking by accident.
      setForm(emptyForm);
      setHome(emptyHome);
      toast(t.drivers.customer.booked);
      if (onBooked) {
        setBusy(false);
        onBooked(job);
      } else router.push(`/colis${jobAnchor(job.id)}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const formBody = (
    <form onSubmit={submit} className="mt-3 space-y-3">
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
      <SizePicker tiers={info.sizes} value={form.size} onChange={(size) => setForm((f) => ({ ...f, size }))} label={t.drivers.customer.size} />
      {fare !== null && tier && <p className="font-semibold">{format(t.drivers.customer.estimate, { parcel: tier.priceFcfa, fare })}</p>}
      <p className="text-xs text-gp-muted">{t.drivers.customer.giveRight}</p>
      <Button type="submit" busy={busy} disabled={!pinned || !inServiceArea(home)}>
        {t.drivers.customer.book}
      </Button>
      <Notice error={error} notice="" />
    </form>
  );

  return (
    <section className="rounded-xl border border-black/10 p-4 text-sm dark:border-white/10">
      <h2 className="font-semibold">{t.drivers.customer.pickupTitle}</h2>
      {formBody}
    </section>
  );
}

/** Where a ride or courier ends: a pin on the map and directions. */
export function DropoffFields({ value, onChange, title, hint, noteLabel }: { value: DropoffPoint; onChange: (d: DropoffPoint) => void; title: string; hint: string; noteLabel: string }) {
  const { t } = useI18n();
  const pinned = value.lat !== 0 || value.lng !== 0;
  const outside = pinned && !inServiceArea(value);
  return (
    <div className="space-y-3">
      <span className="block font-medium">{title}</span>
      <HomePicker value={pinned ? value : null} onChange={(p: LatLng) => onChange({ ...value, ...p })} flyTo={0} />
      <p className={`text-xs ${outside ? "text-red-600" : "text-gp-muted"}`}>{outside ? t.drivers.customer.outsideArea : hint}</p>
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
 * A shop (planung/marchand.md) passes its address as `start` and stays on its page with `onBooked`.
 */
export function BookCourier({
  info,
  vehicle,
  start,
  onBooked,
}: {
  info: ParcelInfo;
  vehicle?: BookableVehicleType;
  start?: HomePoint;
  onBooked?: (job: DeliveryJob) => void;
}) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const router = useRouter();
  const toast = useToast();
  const fcfa = useFcfa();
  const reduced = useReducedMotion();
  const blankHome = useEmptyHome();
  const emptyHome = start ?? blankHome;
  const emptyDropoff: DropoffPoint = { lat: 0, lng: 0, note: "" };
  const emptyForm = { recipientPhone: "", content: "", size: "S" as ParcelSize };
  const [pickup, setPickup] = useState(emptyHome);
  const [dropoff, setDropoff] = useState<DropoffPoint>(emptyDropoff);
  const [form, setForm] = useState(emptyForm);
  // Green Credit pays energy only (0047): trips are paid in cash to the driver.
  const payWith: TripPayment = "cash";
  // Three steps: where to collect, where to deliver, then the parcel and the price.
  const [step, setStep] = useState(0);
  // +1 going forward, -1 going back: which side the next step slides in from.
  const [direction, setDirection] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const pickupReady = pinned(pickup) && inServiceArea(pickup) && !!pickup.note.trim() && !!pickup.phone.trim();
  const dropoffReady = pinned(dropoff) && inServiceArea(dropoff) && !!dropoff.note.trim();
  const ready = pickupReady && dropoffReady;
  const fare = pinned(pickup) && pinned(dropoff) ? fareFor(distanceMeters(pickup, dropoff), false, info.driverSettings) : null;
  const sizes = PARCEL_SIZES.filter((size) => {
    const tier = info.sizes.find((x) => x.size === size);
    return !vehicle || (tier && vehicleFits(vehicle, size, tier.maxWeightKg, info.driverSettings));
  });
  const label = "space-y-1 text-sm";
  const steps = [t.phase1b.courier.stepPickup, t.phase1b.courier.stepDropoff, t.phase1b.courier.stepParcel];
  const canGoOn = step === 0 ? pickupReady : step === 1 ? dropoffReady : ready;

  function go(next: number) {
    setDirection(next > step ? 1 : -1);
    setStep(next);
    setError("");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (step < 2) {
      if (canGoOn) go(step + 1);
      return;
    }
    if (busy || !ready) return;
    setError("");
    setBusy(true);
    try {
      const job = await backend.bookCourier({
        vehicleType: vehicle,
        pickup,
        dropoff,
        recipientPhone: form.recipientPhone,
        content: form.content,
        size: form.size,
        payWith,
      });
      // Straight to the tracking, with an empty form behind: no second booking by accident.
      setPickup(emptyHome);
      setDropoff(emptyDropoff);
      setForm(emptyForm);
      setStep(0);
      toast(t.drivers.customer.courierBooked);
      if (onBooked) {
        setBusy(false);
        onBooked(job);
      } else router.push(`${vehicle ? "/courses" : "/colis"}${jobAnchor(job.id)}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  // The new step slides in from the side it comes from; with reduced motion it simply appears.
  const slide = reduced
    ? ""
    : `transition-[translate,opacity] duration-240 ease-gp-out starting:opacity-0 ${direction > 0 ? "starting:translate-x-6" : "starting:-translate-x-6"}`;

  return (
    <section className="rounded-xl border border-black/10 text-sm dark:border-white/10">
      <form onSubmit={submit}>
        <ol className="flex gap-2 border-b border-black/10 p-3 dark:border-white/10" aria-label={t.phase1b.courier.stepsLabel}>
          {steps.map((name, i) => (
            <li key={name} aria-current={i === step ? "step" : undefined} className="flex min-w-0 flex-1 flex-col gap-1">
              <span className={`h-1 rounded-full transition-colors duration-240 ${i <= step ? "bg-gp-green" : "bg-gp-border"}`} aria-hidden />
              <span className={`truncate text-xs ${i === step ? "font-semibold" : "text-gp-muted"}`}>
                {i + 1}. {name}
              </span>
            </li>
          ))}
        </ol>
        <div key={step} className={`space-y-3 p-4 ${slide}`}>
          {step === 0 && <HomeFields value={pickup} onChange={setPickup} title={t.drivers.customer.courierFrom} />}
          {step === 1 && (
            <DropoffFields
              value={dropoff}
              onChange={setDropoff}
              title={t.drivers.customer.courierTo}
              hint={t.drivers.customer.courierToHint}
              noteLabel={t.drivers.customer.courierToNote}
            />
          )}
          {step === 2 && (
            <>
              <label className={label}>
                <span>{t.drivers.customer.recipientPhone}</span>
                <input className={input} type="tel" required value={form.recipientPhone} onChange={set("recipientPhone")} placeholder="90 12 34 56" />
              </label>
              <label className={label}>
                <span>{t.drivers.customer.content}</span>
                <input className={input} required maxLength={300} value={form.content} onChange={set("content")} />
              </label>
              <SizePicker
                tiers={info.sizes.filter((tier) => sizes.includes(tier.size))}
                value={form.size}
                onChange={(size) => setForm((f) => ({ ...f, size }))}
                label={t.drivers.customer.size}
                hidePrice
              />
              {payWith === "cash" && <p className="text-xs text-gp-muted">{t.phase1b.courier.priceHint}</p>}
            </>
          )}
          <Notice error={error} notice="" />
        </div>
        {/* The price stays in sight while the pins move; it is the exact fare the driver collects. */}
        <div className="sticky bottom-0 space-y-2 rounded-b-xl border-t border-black/10 bg-gp-surface/95 p-3 backdrop-blur dark:border-white/10">
          <div className="flex items-baseline justify-between gap-3" aria-live="polite">
            <span className="text-sm text-gp-muted">{t.phase1b.courier.price}</span>
            {fare !== null ? (
              <CountUp value={fare} format={fcfa} className="whitespace-nowrap text-lg font-semibold" />
            ) : (
              <span className="text-xs text-gp-muted">{t.phase1b.courier.pricePending}</span>
            )}
          </div>
          <div className="flex gap-3">
            {step > 0 && (
              <Button variant="secondary" disabled={busy} onClick={() => go(step - 1)}>
                {t.phase1b.courier.back}
              </Button>
            )}
            <Button type="submit" busy={busy} disabled={!canGoOn} className="flex-1">
              {step < 2 ? t.phase1b.courier.next : t.drivers.customer.courierBook}
            </Button>
          </div>
        </div>
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
  // Green Credit pays energy only (0047): trips are paid in cash to the driver.
  const payWith: TripPayment = "cash";
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
      await backend.bookDelivery(parcel.id, home, payWith);
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
      <p className="text-gp-muted">{t.drivers.customer.deliverIntro}</p>
      <HomeFields value={home} onChange={setHome} />
      {fare !== null && <p className="font-semibold">{format(t.drivers.customer.deliverFare, { n: fare })}</p>}
      <p className="text-xs text-gp-muted">{t.drivers.customer.deliverHint}</p>
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

/** "#job-<id>": the anchor a new booking sends the person to, so the list can point at it. */
export function jobAnchor(id: string): string {
  return `#job-${id}`;
}

/** The trip the page was opened for (after booking), read once from the address. */
export function useFocusedJob(): string | null {
  const [focus] = useState(() => (typeof window === "undefined" ? null : window.location.hash.startsWith("#job-") ? window.location.hash.slice(5) : null));
  return focus;
}

/** Scrolls the focused card into view once it is on screen. */
export function scrollIntoViewOnce(el: HTMLElement | null) {
  if (el && !el.dataset.scrolled) {
    el.dataset.scrolled = "1";
    el.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

/** "Recherche d'un chauffeur… 2:35": a booked trip nobody has taken yet, and for how long. */
function Searching({ since }: { since: string }) {
  const { t } = useI18n();
  const now = useNow(1_000);
  const elapsed = Math.max(0, now.getTime() - new Date(since).getTime());
  return (
    <div role="status" className="flex items-center gap-2 text-gp-muted">
      <span aria-hidden className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none" />
      <span>{t.phase1b.jobs.searching}</span>
      <span className="tabular-nums">{formatRemaining(elapsed)}</span>
    </div>
  );
}

/** Where a trip stands: status, the search for a driver, the driver, the price and a way to cancel. */
export function JobDetails({ job: j, stations, showRoute = true }: { job: DeliveryJob; stations: StationView[]; showRoute?: boolean }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const when = useDateTime();
  const fcfa = useFcfa();
  const route = useJobRoute();
  const [error, setError] = useState("");
  const name = (id: string | null) => stations.find((s) => s.id === id)?.name ?? "?";
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{t.drivers.kind[j.kind]}</span>
        <JobStatusPill status={j.status} kind={j.kind} noDriver={j.noDriver} forShop={j.forShop} />
        {j.trackingNo && <span className="font-mono text-xs">{j.trackingNo}</span>}
        <span className="ml-auto text-xs text-gp-muted">{when(j.createdAt)}</span>
      </div>
      {showRoute && <div className="text-zinc-700 dark:text-zinc-300">{route(j, name)}</div>}
      {(j.status === "open" || j.status === "assigned") && <Searching since={j.createdAt} />}
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
      <DriverTracking job={j} stations={stations} />
      {j.handoverCode && (
        <div className="rounded-lg bg-gp-green/10 p-3">
          <p className="font-mono text-lg font-semibold tracking-widest">{format(t.runs.handoverCode, { code: j.handoverCode })}</p>
          <p className="text-xs text-gp-muted">{t.runs.handoverCodeHint}</p>
        </div>
      )}
      {j.proofReview === "pending" && (
        // Handed over with a photo instead of the recipient's code: the sender confirms it arrived.
        <div className="space-y-2 rounded-lg bg-amber-100 p-3 dark:bg-amber-900/30">
          <p>{t.drivers.customer.proofPending}</p>
          <button
            type="button"
            className={small}
            onClick={() => {
              setError("");
              backend.confirmCourierReceipt(j.id).catch((err) => setError(errorMessage(err)));
            }}
          >
            {t.drivers.customer.confirmReceipt}
          </button>
        </div>
      )}
      {j.proofReview === "rejected" && (
        <p className="rounded-lg bg-red-100 p-3 text-red-900 dark:bg-red-900/30 dark:text-red-100">
          {format(t.drivers.customer.proofRejected, { reason: j.proofRejectReason ?? "" })}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {j.collectFcfa > 0 && <span className="font-semibold">{fcfa(j.collectFcfa)}</span>}
        {!!j.prepaidFcfa && (
          <span className="rounded-full bg-gp-green/10 px-2 py-0.5 text-xs font-medium text-gp-green-dark dark:text-gp-green">
            {fcfa(j.prepaidFcfa)} · {j.refunded ? t.drivers.pay.refunded : t.drivers.pay.paidOnline}
          </span>
        )}
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
      <Notice error={error} notice="" />
    </div>
  );
}

/** Trips the customer booked: status, driver and a way to cancel. */
export function MyJobs({ jobs, stations, title }: { jobs: DeliveryJob[]; stations: StationView[]; title?: string }) {
  const { t } = useI18n();
  const now = useNow(60_000);
  const focus = useFocusedJob();
  const shown = jobs.filter((j) => OPEN_JOB_STATUSES.includes(j.status) || now.getTime() - new Date(j.createdAt).getTime() < 7 * 86_400_000);
  if (shown.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="font-semibold">{title ?? t.drivers.customer.jobsTitle}</h2>
      <ul className="space-y-2">
        {shown.map((j) => (
          <li
            key={j.id}
            id={`job-${j.id}`}
            ref={j.id === focus ? scrollIntoViewOnce : undefined}
            className={`rounded-xl border p-3 text-sm ${j.id === focus ? "animate-gp-fade-in border-gp-green ring-2 ring-gp-green/30" : "border-black/10 dark:border-white/10"}`}
          >
            <JobDetails job={j} stations={stations} />
          </li>
        ))}
      </ul>
    </section>
  );
}
