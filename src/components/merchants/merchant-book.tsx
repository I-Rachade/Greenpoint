"use client";

import dynamic from "next/dynamic";
import { useState, type FormEvent } from "react";
import { fareFor, inServiceArea, MAX_PASSENGERS, type DeliveryJob, type DropoffPoint, type HomePoint } from "@shared/drivers";
import { distanceMeters, type LatLng } from "@shared/geo";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import type { MerchantAddress, MerchantInfo, MerchantJob } from "@shared/merchants";
import type { ParcelInfo } from "@shared/parcels";
import { format } from "@/lib/i18n/format";
import { useApp } from "../app-provider";
import { BookCourier, BookPickup, DropoffFields, JobDetails, scrollIntoViewOnce } from "../drivers/customer-jobs";
import { input, Notice, useFcfa } from "../drivers/shared";
import { useI18n } from "../i18n-provider";
import { BoxFastIcon, BoxInIcon, CarIcon } from "../icons";
import { LoadFailed, StaleNotice } from "../load-state";
import { ConfirmSheet } from "../confirm-sheet";
import { Button, CountUp, EmptyState, SkeletonCard, useToast } from "../ui";
import { field, useAction } from "./shared";

const HomePicker = dynamic(() => import("../drivers/home-picker").then((m) => m.HomePicker), { ssr: false });

const KINDS = ["courier", "pickup", "ride"] as const;
type BookKind = (typeof KINDS)[number];
const KIND_ICON = { courier: BoxFastIcon, pickup: BoxInIcon, ride: CarIcon } as const;

/** The shop as the start of a booking: its pin, address and phone (changeable per booking). */
export function shopStart(shop: MerchantInfo | MerchantAddress): HomePoint {
  return { lat: shop.lat, lng: shop.lng, note: shop.address, phone: shop.phone };
}

/** Parcel sizes, prices and stations the booking forms need. */
function useBookingData() {
  const { backend } = useApp();
  return useLiveQuery(() => Promise.all([backend.parcelInfo(), backend.listStations()]));
}

/**
 * "Réserver": every member books for the shop. Courier (shop → customer's door) first,
 * a pickup to a station, or a ride for someone else. The shop pays at the start.
 */
export function MerchantBook({
  shop,
  addresses,
  onBooked,
}: {
  shop: MerchantInfo;
  addresses: MerchantAddress[];
  onBooked: (job: DeliveryJob) => void;
}) {
  const { t } = useI18n();
  const m = t.merchant.book;
  const { features } = useApp();
  const { data, error, reload } = useBookingData();
  const [kind, setKind] = useState<BookKind>("courier");
  // The shop, or one of its saved addresses (phase 2), as the start of the booking.
  const [from, setFrom] = useState("");
  const saved = addresses.find((a) => a.id === from);
  const start = shopStart(saved ?? shop);

  if (!features.drivers) return <EmptyState text={t.errors.drivers_soon} />;
  if (!data) {
    return error ? (
      <LoadFailed error={error} onRetry={reload} />
    ) : (
      <div className="space-y-3" aria-busy>
        <SkeletonCard />
      </div>
    );
  }
  const [info, stations] = data;
  const hints: Record<BookKind, string> = { courier: m.courierHint, pickup: m.pickupHint, ride: m.rideHint };

  return (
    <div className="space-y-4">
      <StaleNotice error={error} onRetry={reload} />
      <div role="radiogroup" aria-label={t.merchant.tabs.book} className="grid grid-cols-3 gap-2">
        {KINDS.map((k) => {
          const Icon = KIND_ICON[k];
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setKind(k)}
              className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-2xl border p-2 text-center text-sm font-semibold transition-colors ${
                kind === k
                  ? "border-gp-green-dark bg-gp-green-dark/10 text-gp-green-dark dark:border-gp-green dark:text-gp-green"
                  : "border-gp-border text-gp-muted dark:border-white/15"
              }`}
            >
              <Icon size={24} />
              {m[k]}
            </button>
          );
        })}
      </div>
      <p className="text-sm text-gp-muted">{hints[kind]}</p>
      {addresses.length > 0 && (
        <label className="block space-y-1 text-sm">
          <span className="font-medium">{m.startFrom}</span>
          <select className={field} value={saved ? saved.id : ""} onChange={(e) => setFrom(e.target.value)}>
            <option value="">{format(m.startShop, { address: shop.address })}</option>
            {addresses.map((a) => (
              <option key={a.id} value={a.id}>
                {`${a.label} (${a.address})`}
              </option>
            ))}
          </select>
        </label>
      )}
      {/* A new form per kind and start: each keeps the chosen start. */}
      {kind === "courier" && <BookCourier key={`courier-${from}`} info={info} start={start} onBooked={onBooked} />}
      {kind === "pickup" && <BookPickup key={`pickup-${from}`} info={info} stations={stations} start={start} onBooked={onBooked} />}
      {kind === "ride" && <RideForm key={`ride-${from}`} info={info} start={start} onBooked={onBooked} />}
      <p className="text-xs text-gp-muted">{m.payHint}</p>
    </div>
  );
}

const isPinned = (p: LatLng) => p.lat !== 0 || p.lng !== 0;

/** A ride for someone else: the passenger's name and phone, where they get on (the shop by default) and off. */
function RideForm({ info, start, onBooked }: { info: ParcelInfo; start: HomePoint; onBooked: (job: DeliveryJob) => void }) {
  const { t } = useI18n();
  const r = t.merchant.ride;
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const toast = useToast();
  const fcfa = useFcfa();
  const emptyDropoff: DropoffPoint = { lat: 0, lng: 0, note: "" };
  const [pickup, setPickup] = useState<HomePoint>(start);
  const [dropoff, setDropoff] = useState<DropoffPoint>(emptyDropoff);
  const [passengerName, setPassengerName] = useState("");
  const [passengers, setPassengers] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ready =
    passengerName.trim().length >= 2 &&
    !!pickup.phone.trim() &&
    !!pickup.note.trim() &&
    isPinned(pickup) &&
    inServiceArea(pickup) &&
    isPinned(dropoff) &&
    inServiceArea(dropoff) &&
    !!dropoff.note.trim();
  const fare = isPinned(pickup) && isPinned(dropoff) ? fareFor(distanceMeters(pickup, dropoff), false, info.driverSettings) : null;
  const outsideStart = isPinned(pickup) && !inServiceArea(pickup);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !ready) return;
    setError("");
    setBusy(true);
    try {
      const job = await backend.bookRide({ pickup, dropoff, passengers, passengerName: passengerName.trim() });
      setPickup(start);
      setDropoff(emptyDropoff);
      setPassengerName("");
      setPassengers(1);
      toast(r.booked);
      onBooked(job);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-black/10 text-sm dark:border-white/10">
      <form onSubmit={submit}>
        <div className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1">
              <span>{r.passengerName}</span>
              <input className={input} required minLength={2} maxLength={80} value={passengerName} onChange={(e) => setPassengerName(e.target.value)} />
            </label>
            <label className="space-y-1">
              <span>{r.passengerPhone}</span>
              <input
                className={input}
                type="tel"
                required
                placeholder="90 12 34 56"
                value={pickup.phone}
                onChange={(e) => setPickup((p) => ({ ...p, phone: e.target.value }))}
              />
            </label>
          </div>
          <p className="text-xs text-gp-muted">{r.passengerPhoneHint}</p>
          <label className="block space-y-1">
            <span>{r.passengers}</span>
            <select className={field} value={passengers} onChange={(e) => setPassengers(Number(e.target.value))}>
              {Array.from({ length: MAX_PASSENGERS }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex-1 font-medium">{r.from}</span>
              <button type="button" className="rounded-full border border-black/15 px-2 py-0.5 text-xs dark:border-white/20" onClick={() => setPickup(start)}>
                {r.atShop}
              </button>
            </div>
            <HomePicker value={isPinned(pickup) ? pickup : null} onChange={(p: LatLng) => setPickup((h) => ({ ...h, ...p }))} flyTo={0} />
            <p className={`text-xs ${outsideStart ? "text-red-600" : "text-gp-muted"}`}>{outsideStart ? t.drivers.customer.outsideArea : t.drivers.customer.mapHint}</p>
            <label className="block space-y-1">
              <span>{t.drivers.customer.note}</span>
              <input className={input} required maxLength={300} value={pickup.note} onChange={(e) => setPickup((h) => ({ ...h, note: e.target.value }))} />
            </label>
          </div>
          <DropoffFields value={dropoff} onChange={setDropoff} title={r.to} hint={r.toHint} noteLabel={r.toNote} />
          <Notice error={error} notice="" />
        </div>
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
            <Button type="submit" busy={busy} disabled={!ready} className="flex-1">
              {r.submit}
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
}

/** "Réservée par Awa · Passager : Kofi" under a shop trip. */
export function BookedByLine({ job }: { job: MerchantJob | DeliveryJob }) {
  const { t } = useI18n();
  const m = t.merchant.trips;
  const by = "bookedBy" in job ? job.bookedBy : null;
  const parts = [
    by ? format(m.bookedBy, { name: by.name ?? "?" }) : null,
    job.kind === "ride" && job.customerName ? format(m.passenger, { name: job.customerName }) : null,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return <p className="text-xs text-gp-muted">{parts.join(" · ")}</p>;
}

/**
 * A shop's courier whose recipient was absent comes back (planung/marchand.md): any member
 * confirms once the parcel is in hand, which ends the trip.
 */
export function ShopReturn({ job }: { job: DeliveryJob }) {
  const { t } = useI18n();
  const m = t.merchant.trips;
  const { backend } = useApp();
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  if (job.kind !== "courier" || job.status !== "returning") return null;
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
      <span className="min-w-0 flex-1">{m.returning}</span>
      <Button size="md" onClick={() => setOpen(true)}>
        {m.confirmReturn}
      </Button>
      <ConfirmSheet
        open={open}
        title={m.confirmReturnTitle}
        confirmLabel={m.confirmReturn}
        busy={busy}
        onCancel={() => setOpen(false)}
        onConfirm={() =>
          void run(() => backend.confirmShopReturn(job.id), m.returned).then((ok) => {
            if (ok) setOpen(false);
          })
        }
      >
        <p className="text-sm">{m.confirmReturnText}</p>
      </ConfirmSheet>
    </div>
  );
}

/** "Nos courses": the shop's trips (every member sees all of them, decision 4), with cancel. */
export function MerchantTrips({ live, focus }: { live: MerchantJob[]; focus: string | null }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const { data, error, reload } = useLiveQuery(() => Promise.all([backend.myJobs(), backend.listStations()]));
  if (!data) {
    return error ? (
      <LoadFailed error={error} onRetry={reload} />
    ) : (
      <div className="space-y-3" aria-busy>
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }
  const [jobs, stations] = data;
  // myJobs() has no "booked by"; the live list of the shop view has it for running trips.
  const byId = new Map(live.map((j) => [j.id, j]));
  return (
    <div className="space-y-3">
      <StaleNotice error={error} onRetry={reload} />
      {jobs.length === 0 ? (
        <EmptyState text={t.merchant.trips.none} />
      ) : (
        <ul className="space-y-2">
          {jobs.map((j) => (
            <li
              key={j.id}
              id={`job-${j.id}`}
              ref={j.id === focus ? scrollIntoViewOnce : undefined}
              className={`space-y-1 rounded-xl border p-3 text-sm ${j.id === focus ? "border-gp-green ring-2 ring-gp-green/30" : "border-black/10 dark:border-white/10"}`}
            >
              <JobDetails job={j} stations={stations} />
              <BookedByLine job={byId.get(j.id) ?? j} />
              <ShopReturn job={j} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
