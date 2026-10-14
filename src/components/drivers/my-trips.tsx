"use client";

import { useLiveQuery } from "@/lib/hooks";
import { useApp } from "../app-provider";
import { useI18n } from "../i18n-provider";
import { BookPickup, MyJobs } from "./customer-jobs";

/** "Courses" tab: book a home pickup by a driver and follow your trips. */
export function MyTrips() {
  const { t } = useI18n();
  const { backend } = useApp();
  const { data } = useLiveQuery(() => Promise.all([backend.myJobs(), backend.listStations(), backend.parcelInfo()]));

  if (!data) return <p className="p-6 text-sm text-zinc-500">{t.loading}</p>;
  const [jobs, stations, info] = data;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 overflow-y-auto p-6">
      <h1 className="text-2xl font-semibold">{t.ui.trips.title}</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.ui.trips.intro}</p>
      <MyJobs jobs={jobs} stations={stations} />
      <BookPickup info={info} stations={stations} />
    </div>
  );
}
