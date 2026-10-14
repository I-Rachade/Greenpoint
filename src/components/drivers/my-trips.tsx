"use client";

import { useState, type ComponentType } from "react";
import { useLiveQuery } from "@/lib/hooks";
import { useApp } from "../app-provider";
import { BoxIcon, ScooterIcon } from "../icons";
import { useI18n } from "../i18n-provider";
import { BookPickup, MyJobs } from "./customer-jobs";

type Choice = "ride" | "order";

/** A big tile that picks what the customer wants a driver for. */
function ChoiceTile({
  icon: Icon,
  label,
  hint,
  selected,
  onClick,
}: {
  icon: ComponentType<{ size?: number }>;
  label: string;
  hint: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`flex min-h-32 flex-col items-center justify-center gap-1.5 rounded-2xl p-3 text-center shadow-sm active:scale-[0.99] ${
        selected ? "bg-gp-forest text-white ring-2 ring-gp-green ring-offset-2 dark:ring-offset-zinc-900" : "bg-gp-forest/90 text-white"
      }`}
    >
      <Icon size={36} />
      <span className="text-base font-semibold leading-tight">{label}</span>
      <span className="text-xs text-white/75">{hint}</span>
    </button>
  );
}

/** "Courses" tab: take a ride (people, coming soon) or order a parcel trip, and follow your trips. */
export function MyTrips() {
  const { t } = useI18n();
  const { backend } = useApp();
  const [choice, setChoice] = useState<Choice | null>(null);
  const { data } = useLiveQuery(() => Promise.all([backend.myJobs(), backend.listStations(), backend.parcelInfo()]));

  if (!data) return <p className="p-6 text-sm text-zinc-500">{t.loading}</p>;
  const [jobs, stations, info] = data;
  const toggle = (c: Choice) => setChoice((current) => (current === c ? null : c));

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 overflow-y-auto p-6">
      <h1 className="text-2xl font-semibold">{t.ui.trips.title}</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.ui.trips.intro}</p>
      <div className="grid grid-cols-2 gap-3">
        <ChoiceTile icon={ScooterIcon} label={t.ui.trips.ride} hint={t.ui.trips.rideHint} selected={choice === "ride"} onClick={() => toggle("ride")} />
        <ChoiceTile icon={BoxIcon} label={t.ui.trips.order} hint={t.ui.trips.orderHint} selected={choice === "order"} onClick={() => toggle("order")} />
      </div>
      {choice === "ride" && <p className="rounded-xl bg-gp-green/10 p-4 text-sm">{t.ui.trips.rideSoon}</p>}
      {choice === "order" && <BookPickup info={info} stations={stations} open />}
      <MyJobs jobs={jobs} stations={stations} />
    </div>
  );
}
