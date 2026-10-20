"use client";

import { useState, type FormEvent } from "react";
import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format, formatXof } from "@/lib/i18n/format";
import {
  SHARE_RADIUS_MAX_M,
  SHARE_RADIUS_MIN_M,
  SHARE_VEHICLE_KINDS,
  type AdminShare,
  type AdminShareRide,
  type AdminShareStation,
  type AdminShareVehicle,
  type ShareTariff,
  type ShareTrackPoint,
  type ShareVehicleInput,
  type ShareVehicleStatus,
} from "@/lib/share";
import { card, field, Loading, Pill, StaleNotice, Table, td, th, useDateTime } from "./shared";

type Tab = "vehicles" | "stations" | "tariffs" | "checks" | "rides" | "incidents";
const TABS: Tab[] = ["vehicles", "stations", "tariffs", "checks", "rides", "incidents"];
type Run = (action: () => Promise<unknown>, done?: string) => Promise<boolean>;

const button = "rounded-full bg-gp-green-dark px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50";
const ghost = "rounded-full border border-black/15 px-3 py-1.5 text-sm dark:border-white/20 disabled:opacity-50";
/** What an admin may set a parked vehicle to (reserved and on the road come from rides). */
const ADMIN_STATES: ShareVehicleStatus[] = ["available", "charging", "maintenance", "lost"];

/**
 * Backoffice "Share" (src/lib/share.ts, worker/share.ts): the module switch, the vehicles and
 * their trackers, the stations that take them, the prices, the customers' checks, the rides
 * and the incidents.
 */
export function ShareManager() {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const { data, error, reload } = useLiveQuery(() => backend.adminShare());
  const [tab, setTab] = useState<Tab>("vehicles");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const a = t.share.admin;

  const run: Run = async (action, done) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      if (done) setMessage({ ok: true, text: done });
      reload();
      return true;
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!data) return <Loading error={error} onRetry={reload} />;
  const counts: Partial<Record<Tab, number>> = {
    checks: data.verifications.filter((v) => v.status === "pending").length,
    incidents: data.incidents.filter((i) => !i.resolvedAt).length,
  };

  return (
    <div className="space-y-4">
      <StaleNotice error={error} onRetry={reload} />
      <h1 className="text-xl font-semibold">{a.title}</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{a.intro}</p>
      <label className={`${card} flex items-start gap-3`}>
        <input type="checkbox" className="mt-1" checked={data.enabled} disabled={busy} onChange={(e) => void run(() => backend.setShareEnabled(e.target.checked))} />
        <span>
          <span className="block font-medium">{a.enabled}</span>
          <span className="block text-sm text-zinc-600 dark:text-zinc-400">{a.enabledHint}</span>
        </span>
      </label>
      {data.simulated && <p className="rounded-lg bg-amber-100 p-3 text-sm text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">{a.simulated}</p>}
      <div className="flex flex-wrap gap-2">
        {TABS.map((x) => (
          <button key={x} type="button" onClick={() => setTab(x)} aria-pressed={tab === x} className={tab === x ? button : ghost}>
            {a.tabs[x]}
            {!!counts[x] && ` (${counts[x]})`}
          </button>
        ))}
      </div>
      {message && <p className={`text-sm ${message.ok ? "text-gp-green-dark dark:text-gp-green" : "text-red-600"}`}>{message.text}</p>}
      {tab === "vehicles" && <Vehicles data={data} busy={busy} run={run} />}
      {tab === "stations" && <Stations stations={data.stations} busy={busy} run={run} />}
      {tab === "tariffs" && <Tariffs tariffs={data.tariffs} busy={busy} run={run} />}
      {tab === "checks" && <Checks data={data} busy={busy} run={run} />}
      {tab === "rides" && <Rides data={data} busy={busy} run={run} />}
      {tab === "incidents" && <Incidents data={data} busy={busy} run={run} />}
    </div>
  );
}

// Vehicles -------------------------------------------------------------------------------------

const EMPTY_VEHICLE: ShareVehicleInput = { kind: "emoto", name: "", plate: "", homeStationId: null, trackerId: null, imei: "", sim: "", unlockCommand: "", lockCommand: "", note: "" };

function Vehicles({ data, busy, run }: { data: AdminShare; busy: boolean; run: Run }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const when = useDateTime();
  const s = t.share;
  const a = s.admin;
  const [editing, setEditing] = useState<{ id: string | null; input: ShareVehicleInput } | null>(null);
  const [state, setState] = useState<Record<string, { status: ShareVehicleStatus; stationId: string }>>({});

  const edit = (v: AdminShareVehicle) =>
    setEditing({
      id: v.id,
      input: { kind: v.kind, name: v.name, plate: v.plate, homeStationId: v.homeStationId, trackerId: v.trackerId, imei: v.imei, sim: v.sim, unlockCommand: v.unlockCommand, lockCommand: v.lockCommand, note: v.note },
    });

  return (
    <section className="space-y-3">
      {editing ? (
        <VehicleForm
          value={editing.input}
          stations={data.stations}
          busy={busy}
          onCancel={() => setEditing(null)}
          onSave={(input) =>
            void run(() => backend.saveShareVehicle(editing.id, input), a.save).then((ok) => {
              if (ok) setEditing(null);
            })
          }
        />
      ) : (
        <button type="button" className={button} onClick={() => setEditing({ id: null, input: EMPTY_VEHICLE })}>
          {a.newVehicle}
        </button>
      )}
      {data.vehicles.length === 0 ? (
        <p className="text-sm text-zinc-500">{a.noVehicles}</p>
      ) : (
        <Table
          head={
            <>
              <th className={th}>{a.name}</th>
              <th className={th}>{a.station}</th>
              <th className={th}>{a.tracker}</th>
              <th className={th} />
            </>
          }
        >
          {data.vehicles.map((v) => {
            const pick = state[v.id] ?? { status: v.status, stationId: v.stationId ?? v.homeStationId ?? "" };
            const parked = v.status !== "reserved" && v.status !== "in_ride";
            return (
              <tr key={v.id}>
                <td className={td}>
                  <div className="font-medium">{v.name}</div>
                  <div className="text-xs text-zinc-500">
                    {s.kinds[v.kind]}
                    {v.plate && ` · ${v.plate}`}
                  </div>
                </td>
                <td className={td}>
                  <Pill tone={v.status === "available" ? "green" : v.status === "lost" ? "red" : v.status === "maintenance" ? "gray" : "blue"}>{s.vehicleStatus[v.status]}</Pill>
                  <div className="text-xs text-zinc-500">{v.stationName ?? "—"}</div>
                  {v.batteryPercent !== null && <div className="text-xs text-zinc-500">{format(s.battery, { n: v.batteryPercent })}</div>}
                </td>
                <td className={td}>
                  {v.trackerId ? (
                    <>
                      <div className="font-mono text-xs">{v.trackerId}</div>
                      <div className="text-xs text-zinc-500">
                        {v.online ? a.online : a.offline}
                        {v.lastSeenAt && ` · ${format(a.seen, { time: when(v.lastSeenAt) })}`}
                      </div>
                      {v.lat !== null && v.lng !== null && (
                        <a className="text-xs underline" href={`https://www.openstreetmap.org/?mlat=${v.lat}&mlon=${v.lng}#map=17/${v.lat}/${v.lng}`} target="_blank" rel="noreferrer">
                          {v.lat.toFixed(5)}, {v.lng.toFixed(5)}
                        </a>
                      )}
                    </>
                  ) : (
                    <span className="text-xs text-zinc-500">{a.none}</span>
                  )}
                </td>
                <td className={`${td} space-y-2`}>
                  <div className="flex flex-wrap gap-1">
                    <button type="button" className={ghost} onClick={() => edit(v)}>
                      {a.edit}
                    </button>
                    {(["unlock", "lock", "locate"] as const).map((cmd) => (
                      <button key={cmd} type="button" className={ghost} disabled={busy} onClick={() => void run(() => backend.shareVehicleCommand(v.id, cmd), a.test[cmd])}>
                        {a.test[cmd]}
                      </button>
                    ))}
                    <button type="button" className={ghost} disabled={busy} onClick={() => window.confirm(`${a.delete} ${v.name} ?`) && void run(() => backend.deleteShareVehicle(v.id))}>
                      {a.delete}
                    </button>
                  </div>
                  {parked && (
                    <div className="flex flex-wrap items-center gap-1">
                      <select className={field} value={pick.status} onChange={(e) => setState({ ...state, [v.id]: { ...pick, status: e.target.value as ShareVehicleStatus } })}>
                        {ADMIN_STATES.map((x) => (
                          <option key={x} value={x}>
                            {s.vehicleStatus[x]}
                          </option>
                        ))}
                      </select>
                      <span className="text-xs">{a.at}</span>
                      <select className={field} value={pick.stationId} onChange={(e) => setState({ ...state, [v.id]: { ...pick, stationId: e.target.value } })}>
                        <option value="">{a.none}</option>
                        {data.stations.map((st) => (
                          <option key={st.stationId} value={st.stationId}>
                            {st.name}
                          </option>
                        ))}
                      </select>
                      <button type="button" className={ghost} disabled={busy} onClick={() => void run(() => backend.setShareVehicleState(v.id, pick.status, pick.stationId || null), a.save)}>
                        {a.setState}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </Table>
      )}
    </section>
  );
}

function VehicleForm({
  value,
  stations,
  busy,
  onSave,
  onCancel,
}: {
  value: ShareVehicleInput;
  stations: AdminShareStation[];
  busy: boolean;
  onSave: (input: ShareVehicleInput) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const s = t.share;
  const a = s.admin;
  const [v, setV] = useState(value);
  const text = (key: "name" | "plate" | "imei" | "sim" | "unlockCommand" | "lockCommand" | "note", label: string, hint?: string) => (
    <label className="block space-y-1 text-sm">
      <span className="font-medium">{label}</span>
      <input className={`${field} w-full`} value={v[key]} onChange={(e) => setV({ ...v, [key]: e.target.value })} required={key === "name"} />
      {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
  return (
    <form
      className={`${card} grid gap-3 sm:grid-cols-2`}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSave(v);
      }}
    >
      <label className="block space-y-1 text-sm">
        <span className="font-medium">{a.kind}</span>
        <select className={`${field} w-full`} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as ShareVehicleInput["kind"] })}>
          {SHARE_VEHICLE_KINDS.map((k) => (
            <option key={k} value={k}>
              {s.kinds[k]}
            </option>
          ))}
        </select>
      </label>
      {text("name", a.name)}
      {text("plate", a.plate)}
      <label className="block space-y-1 text-sm">
        <span className="font-medium">{a.home}</span>
        <select className={`${field} w-full`} value={v.homeStationId ?? ""} onChange={(e) => setV({ ...v, homeStationId: e.target.value || null })}>
          <option value="">{a.none}</option>
          {stations.map((st) => (
            <option key={st.stationId} value={st.stationId}>
              {st.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1 text-sm">
        <span className="font-medium">{a.tracker}</span>
        <input className={`${field} w-full font-mono`} value={v.trackerId ?? ""} onChange={(e) => setV({ ...v, trackerId: e.target.value || null })} />
      </label>
      {text("imei", a.imei)}
      {text("sim", a.sim)}
      {text("unlockCommand", a.unlockCommand, a.commandHint)}
      {text("lockCommand", a.lockCommand, a.commandHint)}
      {text("note", a.note)}
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className={button} disabled={busy}>
          {a.save}
        </button>
        <button type="button" className={ghost} onClick={onCancel}>
          {t.ui.cancel}
        </button>
      </div>
    </form>
  );
}

// Stations and prices --------------------------------------------------------------------------

function Stations({ stations, busy, run }: { stations: AdminShareStation[]; busy: boolean; run: Run }) {
  const { t } = useI18n();
  const a = t.share.admin;
  return (
    <Table
      head={
        <>
          <th className={th}>{a.station}</th>
          <th className={th}>{a.offers}</th>
          <th className={th}>{a.radius}</th>
          <th className={th}>{a.helmetsField}</th>
          <th className={th}>{a.vehiclesHere}</th>
          <th className={th} />
        </>
      }
    >
      {stations.map((st) => (
        <StationRow key={st.stationId} station={st} busy={busy} run={run} />
      ))}
    </Table>
  );
}

function StationRow({ station, busy, run }: { station: AdminShareStation; busy: boolean; run: Run }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const a = t.share.admin;
  const [enabled, setEnabled] = useState(station.enabled);
  const [radius, setRadius] = useState(String(station.radiusM));
  const [helmets, setHelmets] = useState(String(station.helmets));
  const changed = enabled !== station.enabled || Number(radius) !== station.radiusM || Number(helmets) !== station.helmets;
  return (
    <tr>
      <td className={`${td} font-medium`}>{station.name}</td>
      <td className={td}>
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} aria-label={`${a.offers} ${station.name}`} />
      </td>
      <td className={td}>
        <input className={`${field} w-20`} type="number" min={SHARE_RADIUS_MIN_M} max={SHARE_RADIUS_MAX_M} value={radius} onChange={(e) => setRadius(e.target.value)} />
      </td>
      <td className={td}>
        <input className={`${field} w-20`} type="number" min={0} max={500} value={helmets} onChange={(e) => setHelmets(e.target.value)} />
      </td>
      <td className={td}>{station.vehicles}</td>
      <td className={td}>
        <button
          type="button"
          className={button}
          disabled={busy || !changed}
          onClick={() => void run(() => backend.saveShareStation(station.stationId, { enabled, radiusM: Number(radius), helmets: Number(helmets) }), a.save)}
        >
          {a.save}
        </button>
      </td>
    </tr>
  );
}

const PRICE_FIELDS = ["unlockXof", "minuteXof", "pauseMinuteXof", "depositXof", "wrongDropXof"] as const;

function Tariffs({ tariffs, busy, run }: { tariffs: ShareTariff[]; busy: boolean; run: Run }) {
  const { t } = useI18n();
  return (
    <section className="space-y-3">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.share.admin.tariffHint}</p>
      {tariffs.map((x) => (
        <TariffForm key={x.kind} tariff={x} busy={busy} run={run} />
      ))}
    </section>
  );
}

function TariffForm({ tariff, busy, run }: { tariff: ShareTariff; busy: boolean; run: Run }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const s = t.share;
  const a = s.admin;
  const [values, setValues] = useState<Record<(typeof PRICE_FIELDS)[number], string>>(() => Object.fromEntries(PRICE_FIELDS.map((k) => [k, String(tariff[k])])) as Record<(typeof PRICE_FIELDS)[number], string>);
  const [active, setActive] = useState(tariff.isActive);
  return (
    <form
      className={`${card} space-y-3`}
      onSubmit={(e) => {
        e.preventDefault();
        const input = { ...Object.fromEntries(PRICE_FIELDS.map((k) => [k, Number(values[k])])), isActive: active } as Omit<ShareTariff, "kind">;
        void run(() => backend.saveShareTariff(tariff.kind, input), a.save);
      }}
    >
      <h2 className="font-semibold">{s.kinds[tariff.kind]}</h2>
      <div className="grid gap-3 sm:grid-cols-3">
        {PRICE_FIELDS.map((k) => (
          <label key={k} className="block space-y-1 text-sm">
            <span className="font-medium">{a[k]} (FCFA)</span>
            <input className={`${field} w-full`} type="number" min={0} step={1} required value={values[k]} onChange={(e) => setValues({ ...values, [k]: e.target.value })} />
          </label>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        {a.active}
      </label>
      <button type="submit" className={button} disabled={busy}>
        {a.save}
      </button>
    </form>
  );
}

// Checks ---------------------------------------------------------------------------------------

function Checks({ data, busy, run }: { data: AdminShare; busy: boolean; run: Run }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const when = useDateTime();
  const s = t.share;
  const a = s.admin;
  const [reasons, setReasons] = useState<Record<string, string>>({});
  if (!data.verifications.length) return <p className="text-sm text-zinc-500">{a.noChecks}</p>;

  const open = (key: string) => {
    // Opened first, filled once the private photo has loaded (pop-up blockers allow only direct opens).
    const tab = window.open("", "_blank");
    backend.shareFileUrl(key).then(
      (url) => {
        if (tab) tab.location.href = url;
      },
      () => tab?.close(),
    );
  };

  return (
    <Table
      head={
        <>
          <th className={th}>{t.backoffice.nav.users}</th>
          <th className={th} />
          <th className={th} />
        </>
      }
    >
      {data.verifications.map((v) => (
        <tr key={v.userId}>
          <td className={td}>
            <div className="font-medium">{v.customer}</div>
            <Pill tone={v.status === "approved" ? "green" : v.status === "rejected" ? "red" : "amber"}>{a.checkStatus[v.status]}</Pill>
            {v.submittedAt && <div className="text-xs text-zinc-500">{when(v.submittedAt)}</div>}
            {v.rejectReason && <div className="text-xs text-zinc-500">{v.rejectReason}</div>}
          </td>
          <td className={td}>
            <div className="flex flex-wrap gap-1">
              {Object.entries(v.documents).map(([kind, key]) => (
                <button key={kind} type="button" className={ghost} onClick={() => open(key!)}>
                  {s.documents[kind as keyof typeof s.documents]}
                </button>
              ))}
            </div>
          </td>
          <td className={`${td} space-y-1`}>
            <button type="button" className={button} disabled={busy || v.status === "approved"} onClick={() => void run(() => backend.decideShareVerification(v.userId, true, ""), a.approve)}>
              {a.approve}
            </button>
            <div className="flex gap-1">
              <input className={field} placeholder={a.rejectReason} value={reasons[v.userId] ?? ""} onChange={(e) => setReasons({ ...reasons, [v.userId]: e.target.value })} />
              <button
                type="button"
                className={ghost}
                disabled={busy || !(reasons[v.userId] ?? "").trim()}
                onClick={() => void run(() => backend.decideShareVerification(v.userId, false, reasons[v.userId] ?? ""), a.reject)}
              >
                {a.reject}
              </button>
            </div>
          </td>
        </tr>
      ))}
    </Table>
  );
}

// Rides and incidents --------------------------------------------------------------------------

function Rides({ data, busy, run }: { data: AdminShare; busy: boolean; run: Run }) {
  const { t, locale } = useI18n();
  const when = useDateTime();
  const s = t.share;
  const a = s.admin;
  if (!data.rides.length) return <p className="text-sm text-zinc-500">{a.noRides}</p>;
  return (
    <Table
      head={
        <>
          <th className={th}>{t.backoffice.nav.users}</th>
          <th className={th}>{a.track}</th>
          <th className={th}>FCFA</th>
          <th className={th} />
        </>
      }
    >
      {data.rides.map((r) => (
        <tr key={r.id}>
          <td className={td}>
            <div className="font-medium">{r.customer}</div>
            <div className="text-xs text-zinc-500">
              {r.vehicle.name} · {when(r.startedAt ?? r.reservedAt)}
            </div>
          </td>
          <td className={td}>
            <Pill tone={r.status === "ended" ? "gray" : r.status === "cancelled" ? "gray" : "blue"}>{s.status[r.status]}</Pill>
            <div className="text-xs text-zinc-500">
              {r.fromStationName} → {r.status === "ended" ? (r.endStationName ?? s.outsideStation) : (r.toStationName ?? "…")}
            </div>
          </td>
          <td className={td}>
            <div className="tabular-nums">{formatXof(r.amountXof, locale)}</div>
            <div className="text-xs text-zinc-500">{r.paymentStatus === "paid" ? (r.paidWith ? s.paidWith[r.paidWith] : "") : r.paymentStatus === "unpaid" ? s.unpaid : ""}</div>
          </td>
          <td className={td}>
            <RideActions ride={r} stations={data.stations} busy={busy} run={run} />
          </td>
        </tr>
      ))}
    </Table>
  );
}

function RideActions({ ride, stations, busy, run }: { ride: AdminShareRide; stations: AdminShareStation[]; busy: boolean; run: Run }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const a = t.share.admin;
  const [endAt, setEndAt] = useState("");
  const [wrongDrop, setWrongDrop] = useState(false);
  const [track, setTrack] = useState<ShareTrackPoint[] | null>(null);
  const open = ride.status === "reserved" || ride.status === "riding" || ride.status === "paused";
  const last = track?.[track.length - 1];
  return (
    <div className="space-y-1">
      {open && (
        <div className="flex flex-wrap items-center gap-1">
          <select className={field} value={endAt} onChange={(e) => setEndAt(e.target.value)} aria-label={a.endAt}>
            <option value="">{a.outside}</option>
            {stations
              .filter((st) => st.enabled)
              .map((st) => (
                <option key={st.stationId} value={st.stationId}>
                  {st.name}
                </option>
              ))}
          </select>
          <label className="flex items-center gap-1 text-xs">
            <input type="checkbox" checked={wrongDrop} onChange={(e) => setWrongDrop(e.target.checked)} />
            {a.wrongDrop}
          </label>
          <button type="button" className={ghost} disabled={busy} onClick={() => window.confirm(a.endRide) && void run(() => backend.adminEndShareRide(ride.id, endAt || null, wrongDrop), a.endRide)}>
            {a.endRide}
          </button>
        </div>
      )}
      <div className="flex flex-wrap gap-1">
        {ride.paymentStatus === "unpaid" && (
          <button type="button" className={ghost} disabled={busy} onClick={() => window.confirm(a.waive) && void run(() => backend.waiveShareRide(ride.id), a.waive)}>
            {a.waive}
          </button>
        )}
        {ride.startedAt && (
          <button type="button" className={ghost} onClick={() => void backend.shareRideTrack(ride.id).then(setTrack, () => setTrack([]))}>
            {a.track}
          </button>
        )}
      </div>
      {track && (
        <div className="text-xs text-zinc-500">
          {track.length} pts
          {last && (
            <>
              {" · "}
              <a className="underline" href={`https://www.openstreetmap.org/?mlat=${last.lat}&mlon=${last.lng}#map=16/${last.lat}/${last.lng}`} target="_blank" rel="noreferrer">
                {last.lat.toFixed(5)}, {last.lng.toFixed(5)}
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Incidents({ data, busy, run }: { data: AdminShare; busy: boolean; run: Run }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const when = useDateTime();
  const a = t.share.admin;
  const [notes, setNotes] = useState<Record<string, string>>({});
  if (!data.incidents.length) return <p className="text-sm text-zinc-500">{a.noIncidents}</p>;
  return (
    <ul className="space-y-2">
      {data.incidents.map((i) => (
        <li key={i.id} className={`${card} space-y-2`}>
          <div className="flex flex-wrap items-baseline gap-2">
            <Pill tone={i.resolvedAt ? "gray" : "red"}>{a.incidentKinds[i.kind]}</Pill>
            <span className="font-medium">{i.vehicleName ?? "—"}</span>
            <span className="text-xs text-zinc-500">{when(i.createdAt)}</span>
          </div>
          {i.note && <p className="text-sm">{i.note}</p>}
          {i.resolvedAt ? (
            <p className="text-sm text-zinc-500">{format(a.resolved, { text: i.resolution ?? "" })}</p>
          ) : (
            <div className="flex gap-1">
              <input className={`${field} flex-1`} placeholder={a.resolution} value={notes[i.id] ?? ""} onChange={(e) => setNotes({ ...notes, [i.id]: e.target.value })} />
              <button type="button" className={button} disabled={busy || !(notes[i.id] ?? "").trim()} onClick={() => void run(() => backend.resolveShareIncident(i.id, notes[i.id] ?? ""), a.resolve)}>
                {a.resolve}
              </button>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
