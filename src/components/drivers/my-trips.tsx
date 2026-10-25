"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import { BOOKABLE_VEHICLE_TYPES, DEFAULT_DRIVER_SETTINGS, type BookableVehicleType } from "@shared/drivers";
import { format } from "@/lib/i18n/format";
import { useLiveQuery } from "@/lib/hooks";
import { useApp } from "../app-provider";
import { BackIcon, CargoTricycleIcon, ChevronIcon, InfoIcon, ScooterIcon } from "../icons";
import { useI18n } from "../i18n-provider";
import { BookCourier, MyJobs } from "./customer-jobs";

/** A big tile that leads to one way of getting or sending something; greyed out with `soon` until it is available. */
export function ChoiceTile({
  href,
  icon: Icon,
  label,
  hint,
  soon,
}: {
  href: string;
  icon: ComponentType<{ size?: number }>;
  label: string;
  hint: string;
  soon?: string;
}) {
  if (soon) {
    return (
      <div
        aria-disabled
        className="flex min-h-32 flex-col items-center justify-center gap-1.5 rounded-2xl bg-gp-forest/40 p-3 text-center text-white/80 shadow-sm dark:bg-white/10"
      >
        <Icon size={36} />
        <span className="text-base font-semibold leading-tight">{label}</span>
        <span className="text-xs">{soon}</span>
      </div>
    );
  }
  return (
    <Link
      href={href}
      className="flex min-h-32 flex-col items-center justify-center gap-1.5 rounded-2xl bg-gp-forest p-3 text-center text-white shadow-sm active:scale-[0.99]"
    >
      <Icon size={36} />
      <span className="text-base font-semibold leading-tight">{label}</span>
      <span className="text-xs text-white/75">{hint}</span>
    </Link>
  );
}

/** Back to the page with the tiles. */
export function BackTo({ href }: { href: string }) {
  const { t } = useI18n();
  return (
    <Link href={href} className="-ml-1 inline-flex items-center gap-1 text-sm text-gp-green-dark dark:text-gp-green">
      <BackIcon size={18} />
      {t.ui.back}
    </Link>
  );
}

/** A row with an info icon that opens the page explaining how something works. */
export function InfoLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border border-black/10 p-4 text-sm font-semibold text-gp-green-dark dark:border-white/10 dark:text-gp-green"
    >
      <InfoIcon size={22} />
      <span className="flex-1">{label}</span>
      <ChevronIcon size={18} />
    </Link>
  );
}

/** The numbered steps of a "how it works" page. */
export function HowToList({ steps }: { steps: readonly string[] }) {
  return (
    <ol className="list-decimal space-y-1 pl-5 text-sm">
      {steps.map((step) => (
        <li key={step}>{step}</li>
      ))}
    </ol>
  );
}

/** The vehicles a trip can be ordered with; on the "Courses" page and on the parcels-and-trips page (src/components/deliveries.tsx). */
export function TripTiles() {
  const { t } = useI18n();
  const { backend, features } = useApp();
  const { data: info } = useLiveQuery(() => backend.parcelInfo());
  const settings = info?.driverSettings ?? DEFAULT_DRIVER_SETTINGS;
  // Without drivers in service nothing can be ordered; otherwise, until we know, every vehicle shows as available.
  const soon = (type: BookableVehicleType) =>
    !features.drivers || (info && !info.bookableVehicles.includes(type)) ? t.ui.trips.soon : undefined;
  const hint = (type: BookableVehicleType) => {
    const limit = settings.vehicles.find((v) => v.type === type);
    return limit ? format(t.ui.trips.upTo, { size: limit.maxSize, kg: limit.maxWeightKg }) : "";
  };
  const tile = (type: BookableVehicleType, slug: string, icon: ComponentType<{ size?: number }>) => (
    <ChoiceTile href={`/courses/${slug}`} icon={icon} label={t.ui.trips[type]} hint={hint(type)} soon={soon(type)} />
  );
  return (
    <div className="grid grid-cols-2 gap-3">
      {tile("moto", "moto", ScooterIcon)}
      {tile("cargo_tricycle", "tricycle-bagage", CargoTricycleIcon)}
    </div>
  );
}

/** "Courses" tab: pick a vehicle, then order the delivery on its page; your deliveries below. */
export function MyTrips() {
  const { t } = useI18n();
  const { backend } = useApp();
  const { data } = useLiveQuery(() => Promise.all([backend.myJobs(), backend.listStations()]));
  const orders = data?.[0].filter((j) => j.kind === "courier") ?? [];

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 overflow-y-auto p-6">
      <h1 className="text-2xl font-semibold">{t.ui.trips.title}</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.ui.trips.intro}</p>
      <InfoLink href="/courses/comment" label={t.ui.trips.howTo} />
      <TripTiles />
      {data && <MyJobs jobs={orders} stations={data[1]} title={t.ui.trips.mine} />}
    </div>
  );
}

/** Orders a delivery with the vehicle picked on the "Courses" tab. */
export function OrderPage({ vehicle }: { vehicle: BookableVehicleType }) {
  const { t } = useI18n();
  const { backend, features } = useApp();
  const { data: info } = useLiveQuery(() => backend.parcelInfo());
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 overflow-y-auto p-6">
      <BackTo href="/courses" />
      <h1 className="text-2xl font-semibold">{t.drivers.customer.orderTitle}</h1>
      <p className="font-medium">{format(t.drivers.customer.orderVehicle, { v: t.ui.trips[vehicle] })}</p>
      <InfoLink href="/courses/comment" label={t.ui.trips.howTo} />
      {!info ? (
        <p className="text-sm text-zinc-500">{t.loading}</p>
      ) : !features.drivers ? (
        <p className="rounded-xl border border-black/10 p-4 text-sm dark:border-white/10">{t.errors.drivers_soon}</p>
      ) : info.bookableVehicles.includes(vehicle) ? (
        <BookCourier info={info} vehicle={vehicle} />
      ) : (
        <p className="rounded-xl border border-black/10 p-4 text-sm dark:border-white/10">{t.errors.vehicle_soon}</p>
      )}
    </div>
  );
}

/** "Comment commander une course", opened from the Courses tab and the order page. */
export function TripsHowTo() {
  const { t } = useI18n();
  const { backend } = useApp();
  const { data: info } = useLiveQuery(() => backend.parcelInfo());
  const settings = info?.driverSettings ?? DEFAULT_DRIVER_SETTINGS;
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 overflow-y-auto p-6">
      <BackTo href="/courses" />
      <h1 className="text-2xl font-semibold">{t.ui.trips.howTo}</h1>
      <HowToList steps={t.ui.trips.howToList} />
      <h2 className="text-sm font-semibold">{t.ui.trips.vehiclesTitle}</h2>
      <ul className="list-disc pl-5 text-sm">
        {BOOKABLE_VEHICLE_TYPES.map((type) => {
          const limit = settings.vehicles.find((v) => v.type === type);
          return (
            <li key={type}>
              {t.ui.trips[type]}
              {limit ? ` : ${format(t.ui.trips.upTo, { size: limit.maxSize, kg: limit.maxWeightKg })}` : ""}
            </li>
          );
        })}
      </ul>
      <h2 className="text-sm font-semibold">{t.parcels.rulesTitle}</h2>
      <ul className="list-disc pl-5 text-sm text-zinc-600 dark:text-zinc-400">
        {t.parcels.rules.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
    </div>
  );
}
