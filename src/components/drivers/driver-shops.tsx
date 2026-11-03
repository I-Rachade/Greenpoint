"use client";

import { useState, type ReactNode } from "react";
import { useDateTime } from "@/components/backoffice/shared";
import { BackendError } from "@/lib/backend";
import { distanceMeters, formatDistance } from "@shared/geo";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { CHECKIN_RADIUS_M, type DriverShops, type MerchantAssignmentRequest, type MerchantCheckin, type MerchantPayMode } from "@shared/merchants";
import { usePosition } from "@/lib/use-position";
import { useApp } from "../app-provider";
import { ConfirmSheet } from "../confirm-sheet";
import { useI18n } from "../i18n-provider";
import { PositionReporter } from "./position-reporter";
import { Notice, primary, secondary, useFcfa } from "./shared";

/** "HH:MM" in the app's language. */
export function useClock() {
  const { locale } = useI18n();
  const fmt = new Intl.DateTimeFormat(locale === "fr" ? "fr-TG" : "en-GB", { hour: "2-digit", minute: "2-digit" });
  return (iso: string) => fmt.format(new Date(iso));
}

/** "Per trip" or "1 500 FCFA/hour". */
export function usePayLabel() {
  const { t } = useI18n();
  return (mode: MerchantPayMode | null, rate: number | null) =>
    mode === "hourly" && rate ? format(t.merchantDrivers.hourly, { n: rate.toLocaleString("fr-FR") }) : t.merchantDrivers.perTrip;
}

/** Runs a backend action and reports the outcome (too_far gets the shop's own message). */
function useShopAction() {
  const { t } = useI18n();
  const errorMessage = useErrorMessage();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<unknown>, success = ""): Promise<boolean> {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await action();
      setNotice(success);
      return true;
    } catch (err) {
      setError(
        err instanceof BackendError && err.code === "too_far"
          ? format(t.merchantDrivers.driver.tooFar, { m: CHECKIN_RADIUS_M })
          : errorMessage(err),
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { run, busy, status: <Notice error={error} notice={notice} /> };
}

/**
 * Shop assignments waiting for approval, with approve / decline. Used by the driver
 * (their own), the fleet manager (their drivers) and the admin (all).
 */
export function AssignmentRequestList({ requests, showDriver }: { requests: MerchantAssignmentRequest[]; showDriver: boolean }) {
  const { t } = useI18n();
  const m = t.merchantDrivers;
  const { backend } = useApp();
  const when = useDateTime();
  const pay = usePayLabel();
  const { run, busy, status } = useShopAction();
  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {requests.map((r) => (
          <li key={r.id} className="space-y-2 rounded-lg bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
            <div className="font-semibold">{showDriver ? format(m.requests.line, { driver: r.driverName, shop: r.merchantName }) : r.merchantName}</div>
            <div className="text-zinc-600 dark:text-zinc-400">{r.merchantAddress}</div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{pay(r.payMode, r.ratePerHourFcfa)}</span>
              <span className="text-xs text-zinc-500">{format(m.requests.requestedOn, { date: when(r.createdAt) })}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={primary} disabled={busy} onClick={() => void run(() => backend.decideMerchantAssignment(r.id, true), m.driver.approved)}>
                {m.driver.approve}
              </button>
              <button type="button" className={secondary} disabled={busy} onClick={() => void run(() => backend.decideMerchantAssignment(r.id, false), m.driver.declined)}>
                {m.driver.decline}
              </button>
            </div>
          </li>
        ))}
      </ul>
      {status}
    </div>
  );
}

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-black/10 p-4 dark:border-white/10">
      <h2 className="font-semibold">{title}</h2>
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
      {children}
    </section>
  );
}

/** "Chez <shop> depuis HH:MM — vous ne recevez que ses courses", with "Je pars". */
function CheckedInBanner({ checkin, onTrip }: { checkin: MerchantCheckin; onTrip: boolean }) {
  const { t } = useI18n();
  const d = t.merchantDrivers.driver;
  const { backend } = useApp();
  const clock = useClock();
  const { run, busy, status } = useShopAction();
  return (
    <section role="status" className="space-y-3 rounded-xl border-2 border-gp-green bg-gp-green/10 p-4">
      <p className="font-semibold">{format(d.banner, { shop: checkin.merchantName, time: clock(checkin.inAt) })}</p>
      <button type="button" className={primary} disabled={busy || onTrip} onClick={() => void run(() => backend.checkOutOfShop(), d.left)}>
        {d.leave}
      </button>
      {onTrip && <p className="text-xs text-zinc-600 dark:text-zinc-400">{d.leaveDuringTrip}</p>}
      {status}
    </section>
  );
}

function Assignments({ shops, onTrip }: { shops: DriverShops; onTrip: boolean }) {
  const { t } = useI18n();
  const d = t.merchantDrivers.driver;
  const { backend } = useApp();
  const pay = usePayLabel();
  const { position, state } = usePosition();
  const { run, busy, status } = useShopAction();
  const [ending, setEnding] = useState<{ id: string; name: string } | null>(null);
  const active = shops.assignments.filter((a) => a.status === "active");
  if (active.length === 0) return null;
  return (
    <Card title={d.assignments} hint={format(d.checkInHint, { m: CHECKIN_RADIUS_M })}>
      <ul className="space-y-2">
        {active.map((a) => {
          const here = shops.checkin?.merchantId === a.merchantId;
          const dist = position ? distanceMeters(position, { lat: a.merchantLat, lng: a.merchantLng }) : null;
          return (
            <li key={a.id} className="space-y-2 rounded-lg bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
              <div className="font-semibold">{a.merchantName}</div>
              <div className="text-zinc-600 dark:text-zinc-400">{a.merchantAddress}</div>
              <div className="font-medium">{pay(a.payMode, a.ratePerHourFcfa)}</div>
              {here ? (
                <p className="text-gp-green-dark dark:text-gp-green">{format(d.checkedIn, { shop: a.merchantName })}</p>
              ) : (
                !shops.checkin && (
                  <>
                    {dist !== null && <p className="text-xs text-zinc-500">{format(d.distance, { d: formatDistance(dist) })}</p>}
                    {state === "denied" && <p className="text-xs text-amber-700 dark:text-amber-300">{d.noPosition}</p>}
                  </>
                )
              )}
              <div className="flex flex-wrap gap-2">
                {!shops.checkin && (
                  <button
                    type="button"
                    className={primary}
                    disabled={busy || onTrip || !position}
                    onClick={() => position && void run(() => backend.checkInAtShop(a.merchantId, position))}
                  >
                    {format(d.checkIn, { shop: a.merchantName })}
                  </button>
                )}
                <button type="button" className={secondary} disabled={busy} onClick={() => setEnding({ id: a.id, name: a.merchantName })}>
                  {d.end}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {status}
      <ConfirmSheet
        open={!!ending}
        title={format(d.endTitle, { shop: ending?.name ?? "" })}
        confirmLabel={d.end}
        danger
        busy={busy}
        onCancel={() => setEnding(null)}
        onConfirm={() => ending && void run(() => backend.endMerchantDriver(ending.id), d.ended).then(() => setEnding(null))}
      >
        <p>{d.endHint}</p>
      </ConfirmSheet>
    </Card>
  );
}

function hoursOf(inAt: string, outAt: string | null) {
  const minutes = Math.max(0, Math.round(((outAt ? new Date(outAt).getTime() : Date.now()) - new Date(inAt).getTime()) / 60_000));
  return { h: Math.floor(minutes / 60), m: minutes % 60 };
}

function Unpaid({ unpaid }: { unpaid: MerchantCheckin[] }) {
  const { t } = useI18n();
  const d = t.merchantDrivers.driver;
  const { backend } = useApp();
  const when = useDateTime();
  const fcfa = useFcfa();
  const { run, busy, status } = useShopAction();
  if (unpaid.length === 0) return null;
  return (
    <Card title={d.unpaid} hint={d.unpaidHint}>
      <ul className="space-y-2">
        {unpaid.map((k) => (
          <li key={k.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
            <span className="flex-1">
              {format(d.unpaidLine, { shop: k.merchantName, date: when(k.inAt), hours: format(t.merchantDrivers.hours, hoursOf(k.inAt, k.outAt)) })}
            </span>
            <span className="font-mono font-semibold">{fcfa(k.amountFcfa ?? 0)}</span>
            <button type="button" className={primary} disabled={busy} onClick={() => void run(() => backend.confirmShopHoursReceived(k.id), d.receivedDone)}>
              {d.received}
            </button>
          </li>
        ))}
      </ul>
      {status}
    </Card>
  );
}

/**
 * The driver's shops (plan marchand.md §4): assignment requests, "Je suis chez <shop>" /
 * "Je pars", favorites and hourly amounts to confirm. While checked in, `queue` (the station
 * queue join card) is not offered: the server refuses it with checked_in_at_shop.
 */
export function DriverShopsSection({ queue, onTrip }: { queue: ReactNode; onTrip: boolean }) {
  const { t } = useI18n();
  const d = t.merchantDrivers.driver;
  const { backend } = useApp();
  const { data } = useLiveQuery(() => Promise.all([backend.driverShops(), backend.merchantAssignmentRequests()]));
  const [shops, requests] = data ?? [null, []];
  const checkin = shops?.checkin ?? null;

  return (
    <>
      {checkin ? (
        <>
          {/* On a trip the driver panel reports already. */}
          {!onTrip && <PositionReporter />}
          <CheckedInBanner checkin={checkin} onTrip={onTrip} />
          {queue && <p className="rounded-lg bg-zinc-100 p-3 text-sm dark:bg-zinc-900">{d.queueBlocked}</p>}
        </>
      ) : (
        queue
      )}
      {(requests.length > 0 || (shops && (shops.assignments.some((a) => a.status === "active") || shops.favoriteOf.length > 0 || shops.unpaid.length > 0))) && (
        <div className="space-y-1 pt-2">
          <h2 className="text-lg font-semibold">{d.title}</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{d.intro}</p>
        </div>
      )}
      {requests.length > 0 && (
        <Card title={d.requests} hint={d.requestsHint}>
          <AssignmentRequestList requests={requests} showDriver={false} />
        </Card>
      )}
      {shops && <Assignments shops={shops} onTrip={onTrip} />}
      {shops && shops.favoriteOf.length > 0 && (
        <Card title={d.favorites} hint={d.favoritesHint}>
          <ul className="space-y-1 text-sm">
            {shops.favoriteOf.map((f) => (
              <li key={f.merchantId}>{format(d.favoriteOf, { shop: f.merchantName })}</li>
            ))}
          </ul>
        </Card>
      )}
      {shops && <Unpaid unpaid={shops.unpaid} />}
    </>
  );
}
