"use client";

import { useState } from "react";
import { Pill, useDateTime } from "@/components/backoffice/shared";
import type { DeliveryJob } from "@/lib/drivers";
import { useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { pickupQrPayload, type Parcel, type ParcelInfo, type ParcelStatus } from "@/lib/parcels";
import type { StationView } from "@/lib/types";
import { useApp } from "../app-provider";
import { BookCourier, BookDelivery, BookPickup, JobDetails, MyJobs, scrollIntoViewOnce, useFocusedJob } from "../drivers/customer-jobs";
import { BackTo, ChoiceTile, HowToList, InfoLink } from "../drivers/my-trips";
import { BoxFastIcon, StoreIcon } from "../icons";
import { useI18n } from "../i18n-provider";
import { QrImage } from "./qr-image";
import { ParcelStatusPill } from "./status";
import { SlipDialog } from "./slip-dialog";
import { parcelTracking, splitJobs } from "./tracking";

/**
 * Déposé → En route → Arrivé → Retiré / Livré, with the time of each step reached,
 * and below it every recorded scan (handed to the driver, scanned in at the station, …).
 */
function ParcelTimeline({ parcel, stations }: { parcel: Parcel; stations: StationView[] }) {
  const { t } = useI18n();
  const when = useDateTime();
  const tracking = parcelTracking(parcel);
  if (!tracking) return null;
  const stationName = (id: string | null) => (id ? stations.find((s) => s.id === id)?.name : undefined);
  const label = (kind: string) => (kind in t.runs.history ? t.runs.history[kind as keyof typeof t.runs.history] : t.parcels.status[kind as ParcelStatus]);
  return (
    <div className="space-y-2">
      <ol className="grid grid-cols-4" aria-label={t.phase1b.parcels.tracking}>
        {tracking.steps.map((step, i) => {
          const reached = i <= tracking.current;
          const current = i === tracking.current;
          return (
            <li key={step.key} aria-current={current ? "step" : undefined} className="relative flex flex-col items-center px-0.5 text-center">
              {i > 0 && (
                // The line from the previous step, filling in once this step is reached.
                <span aria-hidden className="absolute top-2 right-1/2 h-0.5 w-full -translate-y-1/2 bg-gp-border">
                  <span className="block h-full bg-gp-green transition-[width] duration-500 ease-gp-out" style={{ width: reached ? "100%" : "0%" }} />
                </span>
              )}
              <span
                aria-hidden
                className={`relative h-4 w-4 rounded-full border-2 transition-colors duration-240 ${
                  reached ? "border-gp-green bg-gp-green" : "border-gp-border bg-gp-surface"
                } ${current ? "ring-4 ring-gp-green/25" : ""}`}
              />
              <span className={`mt-1 text-xs leading-tight ${current ? "font-semibold" : "text-gp-muted"}`}>
                {t.phase1b.parcels.steps[step.key]}
                {!reached && <span className="sr-only"> ({t.phase1b.parcels.notYet})</span>}
              </span>
              {reached && step.at && <span className="text-[11px] text-gp-muted tabular-nums">{when(step.at)}</span>}
            </li>
          );
        })}
      </ol>
      {tracking.events.length > 0 && (
        <details className="text-sm">
          <summary className="flex min-h-11 cursor-pointer items-center text-gp-green-dark dark:text-gp-green">{t.runs.historyTitle}</summary>
          <ol className="space-y-1 border-l-2 border-gp-border pl-3">
            {tracking.events.map((e, i) => (
              <li key={`${e.kind}-${e.at}-${i}`} className="flex flex-wrap gap-x-2">
                <span className="font-medium">{label(e.kind)}</span>
                {stationName(e.stationId) && <span className="text-gp-muted">{stationName(e.stationId)}</span>}
                <span className="ml-auto text-xs text-gp-muted tabular-nums">{when(e.at)}</span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}

function ParcelCard({
  parcel: p,
  stations,
  info,
  job,
  focused,
  onSlip,
}: {
  parcel: Parcel;
  stations: StationView[];
  info: ParcelInfo;
  /** The driver trip still running for this parcel, shown here instead of as a second card. */
  job: DeliveryJob | undefined;
  focused: boolean;
  onSlip: () => void;
}) {
  const { t } = useI18n();
  const { features } = useApp();
  const when = useDateTime();
  const station = (id: string) => stations.find((s) => s.id === id);
  const to = station(p.toStationId);
  const received = p.direction === "received";
  const other = received ? p.sender : p.recipient;
  return (
    <li
      id={job ? `job-${job.id}` : undefined}
      ref={focused ? scrollIntoViewOnce : undefined}
      className={`space-y-3 rounded-xl border p-4 ${focused ? "border-gp-green ring-2 ring-gp-green/30" : "border-black/10 dark:border-white/10"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-semibold">{p.trackingNo}</span>
        <ParcelStatusPill status={p.status} />
        {p.express && <Pill tone="blue">{t.drivers.staff.expressBadge}</Pill>}
        {p.deliveryStatus && <Pill tone={p.deliveryStatus === "failed" ? "red" : "blue"}>{t.drivers.delivery[p.deliveryStatus]}</Pill>}
        <span className="ml-auto text-xs text-gp-muted">{received ? t.parcels.received : t.parcels.sent}</span>
      </div>
      <ParcelTimeline parcel={p} stations={stations} />
      <div className="text-sm text-zinc-700 dark:text-zinc-300">
        {station(p.fromStationId)?.name ?? "?"} → {to?.name ?? "?"}
        <br />
        {received ? t.parcels.sender : t.parcels.recipient} : {other.name ? `${other.name} · ` : ""}
        {other.phone}
        <br />
        {t.parcels.content} : {p.content} · {t.parcels.size} {p.size}
      </div>
      {received && p.status === "arrived" && p.pickupCode && (
        // Pops in when the parcel arrives: this is what the recipient has been waiting for.
        <div className="animate-gp-pop flex flex-wrap items-center gap-4 rounded-lg bg-gp-green/10 p-3">
          <QrImage text={pickupQrPayload(p.trackingNo, p.pickupCode)} label={t.parcels.pickupCode} size={180} />
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wide text-gp-muted">{t.parcels.pickupCode}</div>
            <div className="font-mono text-3xl font-bold tracking-widest">{p.pickupCode}</div>
            <div className="text-sm">{[to?.name, to?.address].filter(Boolean).join(", ")}</div>
            {to?.openingHours && <div className="text-xs text-gp-muted">{to.openingHours}</div>}
            {p.pickupDeadline && <div className="text-sm font-medium">{format(t.parcels.deadline, { date: when(p.pickupDeadline) })}</div>}
            <div className="text-xs text-gp-muted">{t.parcels.showCode}</div>
          </div>
        </div>
      )}
      {received && p.status === "arrived" && (!p.deliveryStatus || p.deliveryStatus === "failed") &&
        (features.drivers ? (
          <BookDelivery parcel={p} station={to} info={info} />
        ) : (
          <p className="text-xs text-gp-muted">{t.drivers.customer.deliverySoon}</p>
        ))}
      {job && (
        <div className="rounded-lg border border-black/10 p-3 text-sm dark:border-white/10">
          <JobDetails job={job} stations={stations} showRoute={false} />
        </div>
      )}
      {!received && (
        <button type="button" onClick={onSlip} className="text-sm text-gp-green-dark underline dark:text-gp-green">
          {t.parcels.slip}
        </button>
      )}
    </li>
  );
}

/** How to send at a station: steps, stations with a depot, prices and terms. */
function SendInfo({ info, stations }: { info: ParcelInfo; stations: StationView[] }) {
  const { t } = useI18n();
  const depots = info.depots.map((d) => ({ ...d, station: stations.find((s) => s.id === d.stationId) })).filter((d) => d.station);
  return (
    <div className="space-y-4 text-sm">
      <HowToList steps={t.parcels.howToList} />
      <div>
        <h2 className="font-semibold">{t.parcels.depots}</h2>
        {depots.length === 0 ? (
          <p className="text-gp-muted">{t.parcels.noDepots}</p>
        ) : (
          <ul className="list-disc pl-5">
            {depots.map((d) => (
              <li key={d.stationId}>
                {d.station!.name}
                {d.note ? ` (${d.note})` : ""} · {d.station!.openingHours}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h2 className="font-semibold">{t.parcels.prices}</h2>
        <ul>
          {info.sizes.map((s) => (
            <li key={s.size}>
              <span className="font-medium">{s.size}</span> :{" "}
              {format(t.parcels.upTo, { dims: `${s.maxLengthCm}×${s.maxWidthCm}×${s.maxHeightCm}`, kg: s.maxWeightKg })} ·{" "}
              <span className="font-medium">{s.priceFcfa} FCFA</span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <h2 className="font-semibold">{t.parcels.rulesTitle}</h2>
        <ul className="list-disc pl-5 text-gp-muted">
          {t.parcels.rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** "Comment envoyer un colis", opened from the regular sending page. */
export function HowToSend() {
  const { t } = useI18n();
  const { backend } = useApp();
  const { data } = useLiveQuery(() => Promise.all([backend.listStations(), backend.parcelInfo()]));
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 overflow-y-auto p-6">
      <BackTo href="/colis/regulier" />
      <h1 className="text-2xl font-semibold">{t.parcels.howTo}</h1>
      {data ? <SendInfo info={data[1]} stations={data[0]} /> : <p className="text-sm text-gp-muted">{t.loading}</p>}
    </div>
  );
}

/** The two ways to send a parcel; on the "Colis" page and on the parcels-and-trips page (src/components/deliveries.tsx). */
export function ParcelTiles() {
  const { t } = useI18n();
  const { features } = useApp();
  return (
    <div className="grid grid-cols-2 gap-3">
      <ChoiceTile href="/colis/regulier" icon={StoreIcon} label={t.parcels.regular} hint={t.parcels.regularHint} />
      <ChoiceTile
        href="/colis/express"
        icon={BoxFastIcon}
        label={t.parcels.express}
        hint={t.parcels.expressHint}
        soon={features.drivers ? undefined : t.ui.trips.soon}
      />
    </div>
  );
}

/** "Colis" tab: two ways to send (at a station, or express door to door), then your parcels and their trips. */
export function MyParcels() {
  const { t } = useI18n();
  const { backend } = useApp();
  const { data } = useLiveQuery(() => Promise.all([backend.myParcels(), backend.listStations(), backend.parcelInfo(), backend.myJobs()]));
  const [slip, setSlip] = useState<Parcel | null>(null);
  const focus = useFocusedJob();

  const tiles = <ParcelTiles />;
  if (!data) {
    return (
      <div className="mx-auto w-full max-w-2xl space-y-4 overflow-y-auto p-6">
        <h1 className="text-2xl font-semibold">{t.parcels.title}</h1>
        {tiles}
        <p className="text-sm text-gp-muted">{t.loading}</p>
      </div>
    );
  }
  const [parcels, stations, info, jobs] = data;
  // One card per shipment: a trip that belongs to a listed parcel is shown on that parcel's card.
  const { alone, byParcel } = splitJobs(
    jobs.filter((j) => j.kind !== "ride"),
    parcels,
  );
  // Parcels to pick up first.
  const sorted = [...parcels].sort(
    (a, b) => Number(b.status === "arrived" && b.direction === "received") - Number(a.status === "arrived" && a.direction === "received"),
  );

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 overflow-y-auto p-6">
      <h1 className="text-2xl font-semibold">{t.parcels.title}</h1>
      <p className="text-sm text-gp-muted">{t.parcels.intro}</p>
      {tiles}
      <MyJobs jobs={alone} stations={stations} />
      <h2 className="font-semibold">{t.parcels.mine}</h2>
      {sorted.length === 0 ? (
        <p className="text-sm text-gp-muted">{t.parcels.empty}</p>
      ) : (
        <ul className="space-y-3">
          {sorted.map((p) => (
            <ParcelCard
              key={p.id}
              parcel={p}
              stations={stations}
              info={info}
              job={byParcel.get(p.id)}
              focused={!!focus && (byParcel.get(p.id)?.id === focus || p.jobId === focus)}
              onSlip={() => setSlip(p)}
            />
          ))}
        </ul>
      )}
      {slip && <SlipDialog parcel={slip} stations={stations} onClose={() => setSlip(null)} />}
    </div>
  );
}

/** Standard sending: hand the parcel in at a station (or have a driver bring it there); the recipient collects it at a station. */
export function RegularSend() {
  const { t } = useI18n();
  const { backend, features } = useApp();
  const { data } = useLiveQuery(() => Promise.all([backend.listStations(), backend.parcelInfo()]));
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 overflow-y-auto p-6">
      <BackTo href="/colis" />
      <h1 className="text-2xl font-semibold">{t.parcels.regular}</h1>
      <p className="text-sm text-gp-muted">{t.parcels.regularIntro}</p>
      {data ? (
        <>
          <InfoLink href="/colis/regulier/comment" label={t.parcels.howTo} />
          {features.drivers ? (
            <BookPickup info={data[1]} stations={data[0]} />
          ) : (
            <p className="rounded-xl border border-black/10 p-4 text-sm dark:border-white/10">{t.drivers.customer.pickupSoon}</p>
          )}
        </>
      ) : (
        <p className="text-sm text-gp-muted">{t.loading}</p>
      )}
    </div>
  );
}

/** Express sending: a driver takes the parcel at the sender's door straight to the recipient's door. */
export function ExpressSend() {
  const { t } = useI18n();
  const { backend, features } = useApp();
  const { data: info } = useLiveQuery(() => backend.parcelInfo());
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 overflow-y-auto p-6">
      <BackTo href="/colis" />
      <h1 className="text-2xl font-semibold">{t.parcels.express}</h1>
      <InfoLink href="/colis/express/comment" label={t.parcels.expressHowTo} />
      {!features.drivers ? (
        <p className="rounded-xl border border-black/10 p-4 text-sm dark:border-white/10">{t.errors.drivers_soon}</p>
      ) : info ? (
        <BookCourier info={info} />
      ) : (
        <p className="text-sm text-gp-muted">{t.loading}</p>
      )}
    </div>
  );
}

/** "Comment fonctionne l'envoi express", opened from the express sending page. */
export function ExpressHowTo() {
  const { t } = useI18n();
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 overflow-y-auto p-6">
      <BackTo href="/colis/express" />
      <h1 className="text-2xl font-semibold">{t.parcels.expressHowTo}</h1>
      <HowToList steps={t.parcels.expressHowToList} />
      <h2 className="text-sm font-semibold">{t.parcels.rulesTitle}</h2>
      <ul className="list-disc pl-5 text-sm text-gp-muted">
        {t.parcels.rules.map((rule) => (
          <li key={rule}>{rule}</li>
        ))}
      </ul>
    </div>
  );
}
