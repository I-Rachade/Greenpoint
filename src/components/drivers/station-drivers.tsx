"use client";

import { useState, type ComponentType, type ReactNode } from "react";
import { useDateTime } from "@/components/backoffice/shared";
import type { DeliveryJob, DriverAtStation, JobDriver } from "@/lib/drivers";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import type { DriverPart } from "@/lib/parcel-sections";
import type { StationView } from "@/lib/types";
import { BoxInIcon, BoxOutIcon, QrIcon, QueueIcon } from "../icons";
import { MenuTile } from "../parcels/menu-tile";
import { useApp } from "../app-provider";
import { useI18n } from "../i18n-provider";
import { canScanQr, QrScanner } from "../parcels/qr-scanner";
import { JobStatusPill, Notice, primary, secondary, useFcfa, useJobRoute } from "./shared";

function Section({
  icon: Icon,
  title,
  hint,
  children,
}: {
  icon?: ComponentType<{ size?: number }>;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2 rounded-xl border border-black/10 p-4 dark:border-white/10">
      <h2 className="flex items-center gap-2 font-semibold">
        {Icon && <Icon size={22} />}
        {title}
      </h2>
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
      {children}
    </section>
  );
}

function driverText(d: JobDriver | null, t: ReturnType<typeof useI18n>["t"]): string {
  if (!d) return t.drivers.staff.waitingDriver;
  return [d.name, d.vehicleType ? t.drivers.vehicle[d.vehicleType] : null, d.plate].filter(Boolean).join(" · ");
}

/** What the station does with a driver at the counter: hand over, receive, settle the cash. */
function DriverAtCounter({
  stationId,
  badge,
  found,
  onDone,
  onClose,
}: {
  stationId: string;
  badge: string;
  found: DriverAtStation;
  onDone: (msg: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const fcfa = useFcfa();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const b = found.balanceFcfa;

  async function act(action: () => Promise<unknown>, msg: string) {
    setError("");
    setBusy(true);
    try {
      await action();
      onDone(msg);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const settleText = b > 0 ? format(t.drivers.staff.settleIn, { n: b }) : format(t.drivers.staff.settleOut, { n: -b });
  return (
    <div className="space-y-3 rounded-lg bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{driverText(found.driver, t)}</span>
        {found.driver.phone && <span className="text-zinc-500">{found.driver.phone}</span>}
        <button type="button" className="ml-auto text-xs underline" onClick={onClose}>
          {t.drivers.customer.close}
        </button>
      </div>
      <div>{format(t.drivers.staff.balance, { text: b === 0 ? t.drivers.page.even : fcfa(b) })}</div>
      {!found.handOver && !found.receive && <p className="text-zinc-500">{t.drivers.staff.nothing}</p>}
      <div className="flex flex-wrap gap-2">
        {found.handOver && (
          <button
            type="button"
            className={primary}
            disabled={busy}
            onClick={() => void act(() => backend.handToDriver(stationId, badge, found.handOver!.id), t.drivers.staff.handedOver)}
          >
            {format(t.drivers.staff.handOver, { no: found.handOver.trackingNo ?? "" })}
          </button>
        )}
        {found.receive && (
          <button
            type="button"
            className={primary}
            disabled={busy}
            onClick={() => void act(() => backend.receiveFromDriver(stationId, badge, found.receive!.id), t.drivers.staff.received)}
          >
            {format(t.drivers.staff.receive, { no: found.receive.trackingNo ?? "" })}
          </button>
        )}
        {b !== 0 && (
          <button
            type="button"
            className={secondary}
            disabled={busy}
            onClick={() => window.confirm(`${settleText} ?`) && void act(() => backend.settleDriver(stationId, badge, b), t.drivers.staff.settled)}
          >
            {settleText}
          </button>
        )}
      </div>
      <Notice error={error} notice="" />
    </div>
  );
}

function JobList({ jobs, stations }: { jobs: DeliveryJob[]; stations: StationView[] }) {
  const { t } = useI18n();
  const route = useJobRoute();
  const name = (id: string | null) => stations.find((s) => s.id === id)?.name ?? "?";
  if (jobs.length === 0) return <p className="text-sm text-zinc-500">{t.parcels.staff.none}</p>;
  return (
    <ul className="space-y-1">
      {jobs.map((j) => (
        <li key={j.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-100 p-2 text-sm dark:bg-zinc-900">
          {j.trackingNo && <span className="font-mono">{j.trackingNo}</span>}
          <span>
            {j.size} · {route(j, name)}
          </span>
          <JobStatusPill status={j.status} />
          <span className="flex-1" />
          <span className="text-xs text-zinc-500">{driverText(j.driver, t)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Station staff: drivers in line, parcels they take or bring, and the counter (QR badge). */
/** Drivers at the station: with no part, a menu of big tiles; with a part, that page alone. */
export function StationDriversSection({ station, stations, part }: { station: StationView; stations: StationView[]; part?: DriverPart }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const when = useDateTime();
  const { data, reload } = useLiveQuery(() => backend.stationDrivers(station.id), station.id);
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);
  const [counter, setCounter] = useState<{ badge: string; found: DriverAtStation } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function lookUp(badge: string) {
    setError("");
    setNotice("");
    try {
      setCounter({ badge, found: await backend.driverAtStation(station.id, badge) });
    } catch (err) {
      setCounter(null);
      setError(errorMessage(err));
    }
  }

  if (!part) {
    return (
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">{t.drivers.staff.title}</h1>
        <div className="grid grid-cols-2 gap-3">
          <MenuTile href="/operator/colis/chauffeur-comptoir" icon={QrIcon} label={t.drivers.staff.scanTitle} />
          <MenuTile href="/operator/colis/chauffeur-remettre" icon={BoxOutIcon} label={t.drivers.staff.outgoing} count={data?.outgoing.length} />
          <MenuTile href="/operator/colis/chauffeur-apportes" icon={BoxInIcon} label={t.drivers.staff.incoming} count={data?.incoming.length} />
          <MenuTile href="/operator/colis/chauffeur-file" icon={QueueIcon} label={t.drivers.staff.queue} count={data?.queue.length} />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {part === "chauffeur-comptoir" && (
        <Section icon={QrIcon} title={t.drivers.staff.scanTitle} hint={t.drivers.staff.scanHint}>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void lookUp(code);
            }}
          >
            <input
              required
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ABCD2345"
              aria-label={t.drivers.page.badgeTitle}
              className="w-40 rounded-lg border border-black/20 bg-white px-3 py-2 text-center font-mono text-lg tracking-widest dark:border-white/20 dark:bg-zinc-950"
            />
            <button type="submit" className={primary}>
              {t.drivers.staff.show}
            </button>
            {canScanQr() && !scanning && (
              <button type="button" onClick={() => setScanning(true)} className={secondary}>
                {t.parcels.staff.scan}
              </button>
            )}
          </form>
          {scanning && (
            <QrScanner
              onClose={() => setScanning(false)}
              onResult={(text) => {
                setScanning(false);
                void lookUp(text);
              }}
            />
          )}
          <Notice error={error} notice={notice} />
          {counter && (
            <DriverAtCounter
              stationId={station.id}
              badge={counter.badge}
              found={counter.found}
              onClose={() => setCounter(null)}
              onDone={(msg) => {
                setNotice(msg);
                setCode("");
                setCounter(null);
                reload();
              }}
            />
          )}
        </Section>
      )}
      {part === "chauffeur-remettre" && (
        <Section icon={BoxOutIcon} title={t.drivers.staff.outgoing}>
          <JobList jobs={data?.outgoing ?? []} stations={stations} />
        </Section>
      )}
      {part === "chauffeur-apportes" && (
        <Section icon={BoxInIcon} title={t.drivers.staff.incoming}>
          <JobList jobs={data?.incoming ?? []} stations={stations} />
        </Section>
      )}
      {part === "chauffeur-file" && (
        <Section icon={QueueIcon} title={t.drivers.staff.queue}>
          {!data || data.queue.length === 0 ? (
            <p className="text-sm text-zinc-500">{t.drivers.staff.emptyQueue}</p>
          ) : (
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              {data.queue.map((q, i) => (
                <li key={i}>
                  {driverText(q.driver, t)} <span className="text-xs text-zinc-500">· {when(q.since)}</span>
                </li>
              ))}
            </ol>
          )}
        </Section>
      )}
    </div>
  );
}
