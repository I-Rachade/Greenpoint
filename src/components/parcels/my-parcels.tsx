"use client";

import { useState } from "react";
import { useDateTime } from "@/components/backoffice/shared";
import { useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { pickupQrPayload, type Parcel, type ParcelInfo } from "@/lib/parcels";
import type { StationView } from "@/lib/types";
import { useApp } from "../app-provider";
import { useI18n } from "../i18n-provider";
import { QrImage } from "./qr-image";
import { ParcelStatusPill } from "./status";
import { SlipDialog } from "./slip-dialog";

function ParcelCard({ parcel: p, stations, onSlip }: { parcel: Parcel; stations: StationView[]; onSlip: () => void }) {
  const { t } = useI18n();
  const when = useDateTime();
  const station = (id: string) => stations.find((s) => s.id === id);
  const to = station(p.toStationId);
  const received = p.direction === "received";
  const other = received ? p.sender : p.recipient;
  return (
    <li className="space-y-3 rounded-xl border border-black/10 p-4 dark:border-white/10">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-semibold">{p.trackingNo}</span>
        <ParcelStatusPill status={p.status} />
        <span className="ml-auto text-xs text-zinc-500">{received ? t.parcels.received : t.parcels.sent}</span>
      </div>
      <div className="text-sm text-zinc-700 dark:text-zinc-300">
        {station(p.fromStationId)?.name ?? "?"} → {to?.name ?? "?"}
        <br />
        {received ? t.parcels.sender : t.parcels.recipient} : {other.name ? `${other.name} · ` : ""}
        {other.phone}
        <br />
        {t.parcels.content} : {p.content} · {t.parcels.size} {p.size}
      </div>
      {received && p.status === "arrived" && p.pickupCode && (
        <div className="flex flex-wrap items-center gap-4 rounded-lg bg-gp-green/10 p-3">
          <QrImage text={pickupQrPayload(p.trackingNo, p.pickupCode)} label={t.parcels.pickupCode} size={180} />
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wide text-zinc-500">{t.parcels.pickupCode}</div>
            <div className="font-mono text-3xl font-bold tracking-widest">{p.pickupCode}</div>
            <div className="text-sm">{[to?.name, to?.address].filter(Boolean).join(", ")}</div>
            {to?.openingHours && <div className="text-xs text-zinc-500">{to.openingHours}</div>}
            {p.pickupDeadline && <div className="text-sm font-medium">{format(t.parcels.deadline, { date: when(p.pickupDeadline) })}</div>}
            <div className="text-xs text-zinc-500">{t.parcels.showCode}</div>
          </div>
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

/** How to send: stations with a depot, prices and terms. */
function SendInfo({ info, stations }: { info: ParcelInfo; stations: StationView[] }) {
  const { t } = useI18n();
  const depots = info.depots.map((d) => ({ ...d, station: stations.find((s) => s.id === d.stationId) })).filter((d) => d.station);
  return (
    <details className="rounded-xl border border-black/10 p-4 text-sm dark:border-white/10">
      <summary className="cursor-pointer font-semibold">{t.parcels.howTo}</summary>
      <div className="mt-3 space-y-3">
        <p>{t.parcels.howToSteps}</p>
        <div>
          <h3 className="font-semibold">{t.parcels.depots}</h3>
          {depots.length === 0 ? (
            <p className="text-zinc-500">{t.parcels.noDepots}</p>
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
          <h3 className="font-semibold">{t.parcels.prices}</h3>
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
          <h3 className="font-semibold">{t.parcels.rulesTitle}</h3>
          <ul className="list-disc pl-5 text-zinc-600 dark:text-zinc-400">
            {t.parcels.rules.map((rule) => (
              <li key={rule}>{rule}</li>
            ))}
          </ul>
        </div>
      </div>
    </details>
  );
}

export function MyParcels() {
  const { t } = useI18n();
  const { backend } = useApp();
  const { data } = useLiveQuery(() => Promise.all([backend.myParcels(), backend.listStations(), backend.parcelInfo()]));
  const [slip, setSlip] = useState<Parcel | null>(null);

  if (!data) return <p className="p-6 text-sm text-zinc-500">{t.loading}</p>;
  const [parcels, stations, info] = data;
  // Parcels to pick up first.
  const sorted = [...parcels].sort(
    (a, b) => Number(b.status === "arrived" && b.direction === "received") - Number(a.status === "arrived" && a.direction === "received"),
  );

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 overflow-y-auto p-6">
      <h1 className="text-2xl font-semibold">{t.parcels.title}</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.parcels.intro}</p>
      <SendInfo info={info} stations={stations} />
      {sorted.length === 0 ? (
        <p className="text-sm text-zinc-500">{t.parcels.empty}</p>
      ) : (
        <ul className="space-y-3">
          {sorted.map((p) => (
            <ParcelCard key={p.id} parcel={p} stations={stations} onSlip={() => setSlip(p)} />
          ))}
        </ul>
      )}
      {slip && <SlipDialog parcel={slip} stations={stations} onClose={() => setSlip(null)} />}
    </div>
  );
}
