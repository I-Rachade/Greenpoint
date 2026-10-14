"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import type { RideVehicleType } from "@/lib/drivers";
import { useLiveQuery } from "@/lib/hooks";
import { useApp } from "../app-provider";
import { BackIcon, CarIcon, ScooterIcon, TricycleIcon } from "../icons";
import { useI18n } from "../i18n-provider";
import { BookRide, MyJobs } from "./customer-jobs";

/** A big tile that leads to one way of getting or sending something. */
export function ChoiceTile({ href, icon: Icon, label, hint }: { href: string; icon: ComponentType<{ size?: number }>; label: string; hint: string }) {
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

/** "Courses" tab: pick a vehicle, then book the ride on its page; your rides below. */
export function MyTrips() {
  const { t } = useI18n();
  const { backend } = useApp();
  const { data } = useLiveQuery(() => Promise.all([backend.myJobs(), backend.listStations()]));
  const rides = data?.[0].filter((j) => j.kind === "ride") ?? [];

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 overflow-y-auto p-6">
      <h1 className="text-2xl font-semibold">{t.ui.trips.title}</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.ui.trips.intro}</p>
      <div className="grid grid-cols-3 gap-3">
        <ChoiceTile href="/courses/moto" icon={ScooterIcon} label={t.ui.trips.moto} hint={t.ui.trips.motoHint} />
        <ChoiceTile href="/courses/tricycle" icon={TricycleIcon} label={t.ui.trips.tricycle} hint={t.ui.trips.tricycleHint} />
        <ChoiceTile href="/courses/vehicule" icon={CarIcon} label={t.ui.trips.car} hint={t.ui.trips.carHint} />
      </div>
      {data && <MyJobs jobs={rides} stations={data[1]} title={t.ui.trips.mine} />}
    </div>
  );
}

/** Books a ride on the vehicle picked on the "Courses" tab. */
export function RidePage({ vehicle }: { vehicle: RideVehicleType }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const { data: info } = useLiveQuery(() => backend.parcelInfo());
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 overflow-y-auto p-6">
      <BackTo href="/courses" />
      {info ? <BookRide info={info} vehicle={vehicle} /> : <p className="text-sm text-zinc-500">{t.loading}</p>}
    </div>
  );
}
