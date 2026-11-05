"use client";

import { useState, type FormEvent } from "react";
import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import { EV_CONNECTORS, MAX_EV_POWER_KW, type EvCharger, type EvChargerInput, type EvChargerOutlet } from "@shared/ev-chargers";
import { formatKwh, socketQrUrl } from "@shared/charging";
import { isOffline } from "@shared/iot/charging-points";
import type { Device } from "@shared/iot/devices";
import { useErrorMessage, useLiveQuery, useNow, useRelativeTime } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { QrImage } from "../parcels/qr-image";
import { card, field, Loading, Pill, StaleNotice, useAdminSnapshot } from "./shared";

const TONE = {
  free: "green",
  reserved: "blue",
  charging: "blue",
  done: "gray",
  fault: "red",
  offline: "red",
} as const;

const EMPTY: EvChargerInput = {
  name: "",
  connector: "type2",
  powerKw: 22,
  stationId: null,
  isActive: true,
  pointId: null,
};

/** An outlet of a connected device a charger can be linked to. */
interface OutletChoice {
  id: string;
  stationId: string;
  label: string;
}

/** Every outlet of the connected devices (OCPP or a vendor's cloud API), by station. */
function outletChoices(devices: Device[], text: (device: Device, outlet: number) => string): OutletChoice[] {
  return devices.flatMap((d) =>
    d.points
      .filter((p) => p.outlet && p.deviceId)
      .sort((a, b) => a.outlet! - b.outlet!)
      .map((p) => ({
        id: p.id,
        stationId: p.stationId,
        label: text(d, p.outlet!),
      })),
  );
}

const inputOf = (c: EvCharger): EvChargerInput => ({
  name: c.name,
  connector: c.connector,
  powerKw: c.powerKw,
  stationId: c.stationId,
  isActive: c.isActive,
  pointId: c.pointId,
});

/** Backoffice page to add electric car chargers and assign them to stations. */
export function EvChargersManager() {
  const { t } = useI18n();
  const { backend, features } = useApp();
  const errorMessage = useErrorMessage();
  const { data: chargers, error, reload } = useLiveQuery(() => backend.listEvChargers());
  const { data: snap, error: snapError, reload: reloadSnap } = useAdminSnapshot();
  const { data: devices } = useLiveQuery(() => backend.listDevices());
  const now = useNow(30_000);
  const relativeTime = useRelativeTime();
  // null = no form; "new" = adding; otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // The charger whose test command is being sent.
  const [testing, setTesting] = useState<string | null>(null);
  const retry = () => {
    reload();
    reloadSnap();
  };
  if (!chargers || !snap) return <Loading error={error ?? snapError} onRetry={retry} />;

  const b = t.backoffice.evChargers;
  const stations = [...snap.stations].sort((x, y) => x.name.localeCompare(y.name)).map((s) => ({ id: s.id, name: s.name }));
  const waiting = chargers.filter((c) => !c.stationId).length;
  const outlets = outletChoices(devices ?? [], (d, n) => format(b.form.pointOption, { device: d.externalId, vendor: d.vendor, n }));

  async function run(action: () => Promise<void>, success: string) {
    try {
      await action();
      setMessage({ ok: true, text: success });
      reload();
      return true;
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
      return false;
    }
  }

  /** Switches a linked charger's outlet on or off, then reads its state again as the charger answers. */
  async function test(c: EvCharger, o: EvChargerOutlet, on: boolean) {
    if (on && !window.confirm(format(b.test.confirm, { name: c.name }))) return;
    setMessage(null);
    setTesting(c.id);
    const ok = await run(() => backend.switchOutlet(o.deviceId, o.outlet, on), format(on ? b.test.started : b.test.stopped, { name: c.name }));
    setTesting(null);
    if (ok) for (const ms of [4_000, 12_000, 30_000]) window.setTimeout(reload, ms);
  }

  const form = (charger: EvCharger | null) => (
    <ChargerForm
      initial={charger ? inputOf(charger) : EMPTY}
      stations={stations}
      outlets={outlets}
      taken={chargers.filter((c) => c.pointId && c.id !== charger?.id).map((c) => ({ pointId: c.pointId!, name: c.name }))}
      onCancel={() => setEditing(null)}
      onSave={async (input) => {
        const name = input.name.trim();
        const ok = await run(() => backend.saveEvCharger(charger?.id ?? null, input), format(charger ? b.saved : b.added, { name }));
        if (ok) setEditing(null);
      }}
    />
  );

  return (
    <div className="space-y-4">
      <StaleNotice error={error ?? snapError} onRetry={retry} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{b.title}</h1>
        {editing === null && (
          <button
            type="button"
            onClick={() => {
              setMessage(null);
              setEditing("new");
            }}
            className="rounded-full bg-gp-green-dark px-4 py-1.5 text-sm font-medium text-white"
          >
            {b.add}
          </button>
        )}
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{b.intro}</p>
      {features.lite && <p className="text-sm text-amber-700 dark:text-amber-300">{t.backoffice.lite.moduleHidden}</p>}
      {waiting > 0 && <p className="text-sm text-amber-700 dark:text-amber-400">{format(b.waiting, { n: waiting })}</p>}
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-gp-green-dark" : "text-red-600"}`}>
          {message.text}
        </p>
      )}

      {editing === "new" && form(null)}

      {chargers.length === 0 ? (
        <p className={`${card} text-sm text-zinc-500`}>{b.empty}</p>
      ) : (
        <ul className="space-y-2">
          {chargers.map((c) =>
            editing === c.id ? (
              <li key={c.id}>{form(c)}</li>
            ) : (
              <li key={c.id} className={`${card} flex flex-wrap items-center justify-between gap-3`}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 font-medium">
                    {c.name}
                    {!c.isActive && <Pill tone="gray">{b.inactive}</Pill>}
                    {c.pointId ? <Pill tone="green">{b.connected}</Pill> : <Pill tone="gray">{b.notConnected}</Pill>}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {b.connectors[c.connector]} · {c.powerKw} kW
                  </div>
                  {c.pointId && (
                    <div className="text-xs text-zinc-500">
                      {format(c.outlet && !c.outlet.qrStart ? b.linkedHint : b.connectedHint, {
                        outlet: c.outlet
                          ? format(b.form.pointOption, {
                              device: c.outlet.deviceId,
                              vendor: c.outlet.vendor,
                              n: c.outlet.outlet,
                            })
                          : (outlets.find((o) => o.id === c.pointId)?.label ?? c.pointId),
                      })}
                    </div>
                  )}
                  <TestRow
                    charger={c}
                    busy={testing === c.id}
                    now={now}
                    relativeTime={relativeTime}
                    onSwitch={(o, on) => test(c, o, on)}
                    onQrStart={(on) =>
                      run(() => backend.setQrStart(c.pointId!, on), format(on ? t.backoffice.devices.qrOn : t.backoffice.devices.qrOff, { label: c.name }))
                    }
                  />
                </div>
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  {/* Assigning is the everyday step, so it saves right away. */}
                  <label className="flex items-center gap-2">
                    <span className="sr-only">{b.form.station}</span>
                    {!c.stationId && <Pill tone="amber">{b.unassigned}</Pill>}
                    <select
                      value={c.stationId ?? ""}
                      aria-label={b.form.station}
                      onChange={(e) =>
                        run(
                          // Another station: its outlet is not there, so the link goes.
                          () =>
                            backend.saveEvCharger(c.id, {
                              ...inputOf(c),
                              stationId: e.target.value || null,
                              pointId: null,
                            }),
                          format(b.saved, { name: c.name }),
                        )
                      }
                      className={field}
                    >
                      <option value="">{b.unassigned}</option>
                      {stations.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setMessage(null);
                      setEditing(c.id);
                    }}
                    className="text-gp-green-dark hover:underline"
                  >
                    {b.edit}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(format(b.confirmRemove, { name: c.name }))) {
                        run(() => backend.deleteEvCharger(c.id), format(b.removed, { name: c.name }));
                      }
                    }}
                    className="text-red-600 hover:underline"
                  >
                    {b.remove}
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

/** Live state of a linked charger and the buttons to switch it on and off for a test, without a customer or payment. */
function TestRow({
  charger,
  busy,
  now,
  relativeTime,
  onSwitch,
  onQrStart,
}: {
  charger: EvCharger;
  busy: boolean;
  now: Date;
  relativeTime: (iso: string, now: Date) => string;
  onSwitch: (outlet: EvChargerOutlet, on: boolean) => void;
  onQrStart: (on: boolean) => void;
}) {
  const { t, locale } = useI18n();
  const b = t.backoffice.evChargers.test;
  const d = t.backoffice.devices;
  const [qrShown, setQrShown] = useState(false);
  const o = charger.outlet;
  if (!charger.pointId || !o) return <p className="mt-1 text-xs text-zinc-500">{b.notLinked}</p>;
  const offline = isOffline(
    {
      id: charger.pointId,
      stationId: charger.stationId ?? "",
      label: "",
      status: o.status,
      deviceId: o.deviceId,
      outlet: o.outlet,
      powerWatts: null,
      lastSeenAt: o.lastSeenAt,
    },
    now,
  );
  const status = offline ? "offline" : o.status;
  const button = "rounded-full border px-3 py-1 text-xs font-medium disabled:opacity-50";
  return (
    <div className="mt-2 space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-zinc-500">{b.state}</span>
        <Pill tone={TONE[status]}>{t.backoffice.devices.status[status]}</Pill>
        <span className="text-zinc-500">
          {t.backoffice.devices.lastSeen}: {o.lastSeenAt ? relativeTime(o.lastSeenAt, now) : t.backoffice.devices.never}
        </span>
        {o.switchable ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onSwitch(o, true)}
              title={b.hint}
              className={`${button} border-gp-green-dark text-gp-green-dark`}
            >
              {b.start}
            </button>
            <button type="button" disabled={busy} onClick={() => onSwitch(o, false)} className={`${button} border-zinc-400 text-zinc-700 dark:text-zinc-300`}>
              {b.stop}
            </button>
            {offline && <span className="text-amber-700 dark:text-amber-400">{b.offlineHint}</span>}
          </>
        ) : (
          <span className="text-zinc-500">{b.notSwitchable}</span>
        )}
      </div>
      {/* What the device is and what it reports live, as on the customer's charge screen. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-zinc-600 dark:text-zinc-400">
        <span>
          {[o.vendor, o.model].filter(Boolean).join(" ") || o.deviceId} · {o.ocpp ? b.viaOcpp : b.viaCloud}
        </span>
        {status === "charging" && o.powerWatts !== null && (
          <span>
            {t.charging.power}: {o.powerWatts} W
          </span>
        )}
        {status === "charging" && o.energyWh !== null && (
          <span>
            {t.charging.energy}: {formatKwh(o.energyWh, locale)}
          </span>
        )}
        {o.socPercent !== null && status === "charging" && (
          <span>
            {t.charging.carBattery}: {o.socPercent} %
          </span>
        )}
        <span>{o.ocpp ? b.startsWithCard : b.noCard}</span>
      </div>
      {/* Customers start it by scanning the box's QR code; the motorbike devices page does not list this outlet. */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2" title={d.qrStartHint}>
          <input
            type="checkbox"
            checked={o.qrStart}
            disabled={!o.switchable && !o.qrStart}
            onChange={(e) => onQrStart(e.target.checked)}
            className="h-4 w-4 accent-gp-green-dark"
          />
          {d.qrStart}
        </label>
        {o.qrStart && o.qrCode && (
          <button type="button" onClick={() => setQrShown(!qrShown)} aria-expanded={qrShown} className="text-gp-green-dark hover:underline">
            {qrShown ? d.qrHide : d.qrShow}
          </button>
        )}
      </div>
      {o.qrStart && o.qrCode && qrShown && (
        <div className="flex flex-col items-start gap-1">
          <QrImage text={socketQrUrl(qrOrigin(), o.qrCode, o.outlet)} label={`${d.qrStart} ${charger.name}`} size={180} />
          <p className="text-zinc-500">{b.qrHint}</p>
        </div>
      )}
    </div>
  );
}

function qrOrigin(): string {
  return window.location.protocol.startsWith("http") ? window.location.origin : "https://app.poinderecharge.com";
}

function ChargerForm({
  initial,
  stations,
  outlets,
  taken,
  onSave,
  onCancel,
}: {
  initial: EvChargerInput;
  stations: { id: string; name: string }[];
  outlets: OutletChoice[];
  /** Outlets other chargers already use. */
  taken: { pointId: string; name: string }[];
  onSave: (input: EvChargerInput) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const b = t.backoffice.evChargers;
  const f = b.form;
  const [input, setInput] = useState<EvChargerInput>(initial);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<EvChargerInput>) => setInput((prev) => ({ ...prev, ...patch }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave(input);
    } finally {
      setBusy(false);
    }
  }

  const label = "flex flex-col gap-1 text-sm";
  return (
    <form onSubmit={submit} className={`${card} grid gap-3 sm:grid-cols-2`}>
      <label className={`${label} sm:col-span-2`}>
        {f.name}
        <input required maxLength={80} value={input.name} onChange={(e) => set({ name: e.target.value })} className={field} />
      </label>
      <label className={label}>
        {f.connector}
        <select value={input.connector} onChange={(e) => set({ connector: e.target.value as EvChargerInput["connector"] })} className={field}>
          {EV_CONNECTORS.map((c) => (
            <option key={c} value={c}>
              {b.connectors[c]}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        {f.power}
        <input
          type="number"
          required
          min={1}
          max={MAX_EV_POWER_KW}
          step="0.1"
          value={input.powerKw}
          onChange={(e) => set({ powerKw: Number(e.target.value) })}
          className={field}
        />
      </label>
      <label className={label}>
        {f.station}
        <select value={input.stationId ?? ""} onChange={(e) => set({ stationId: e.target.value || null, pointId: null })} className={field}>
          <option value="">{b.unassigned}</option>
          {stations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <OutletField input={input} outlets={outlets} taken={taken} onChange={(pointId) => set({ pointId })} />
      <label className="flex items-center gap-2 self-end text-sm">
        <input type="checkbox" checked={input.isActive} onChange={(e) => set({ isActive: e.target.checked })} className="accent-gp-green-dark" />
        {f.active}
      </label>
      <div className="flex items-end justify-end gap-2 sm:col-span-2">
        <button type="button" onClick={onCancel} className="rounded-full px-4 py-1.5 text-sm text-zinc-700 dark:text-zinc-300">
          {f.cancel}
        </button>
        <button type="submit" disabled={busy} className="rounded-full bg-gp-green-dark px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {f.save}
        </button>
      </div>
    </form>
  );
}

/** Links the charger to an outlet of a connected device at its station: the app then switches, meters and bills it. */
function OutletField({
  input,
  outlets,
  taken,
  onChange,
}: {
  input: EvChargerInput;
  outlets: OutletChoice[];
  taken: { pointId: string; name: string }[];
  onChange: (pointId: string | null) => void;
}) {
  const { t } = useI18n();
  const f = t.backoffice.evChargers.form;
  const here = outlets.filter((o) => o.stationId === input.stationId);
  return (
    <label className="flex flex-col gap-1 text-sm sm:col-span-2">
      {f.point}
      <select value={input.pointId ?? ""} onChange={(e) => onChange(e.target.value || null)} disabled={!input.stationId || here.length === 0} className={field}>
        <option value="">{f.noPoint}</option>
        {here.map((o) => {
          const other = taken.find((x) => x.pointId === o.id);
          return (
            <option key={o.id} value={o.id} disabled={!!other}>
              {other ? `${o.label} (${format(f.pointTaken, { name: other.name })})` : o.label}
            </option>
          );
        })}
      </select>
      <span className="text-xs text-zinc-500">{!input.stationId ? f.pickStation : here.length === 0 ? f.noOutlets : f.pointHint}</span>
    </label>
  );
}
