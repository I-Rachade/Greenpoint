"use client";

import { useState, type FormEvent } from "react";
import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import { displayStatus } from "@/lib/iot/charging-points";
import { canSwitch, DEVICE_LINKS, MAX_OUTLETS, type DeviceInput } from "@/lib/iot/devices";
import { useErrorMessage, useLiveQuery, useNow, useRelativeTime } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { card, field, indexSnapshot, Loading, Pill, useAdminSnapshot } from "./shared";

const EMPTY: DeviceInput = { externalId: "", stationId: "", outlets: 2, link: "lorawan", vendor: "", model: "" };

const TONE = { free: "green", reserved: "blue", charging: "blue", done: "gray", fault: "red", offline: "red" } as const;

/** Backoffice page to register connected sockets and switch their outlets. */
export function DevicesManager() {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const relativeTime = useRelativeTime();
  const now = useNow(30_000);
  const { data: devices, error, reload } = useLiveQuery(() => backend.listDevices());
  const { data: snap } = useAdminSnapshot();
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  if (!devices || !snap) return <Loading error={error} />;

  const b = t.backoffice.devices;
  const idx = indexSnapshot(snap);

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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{b.title}</h1>
        {!adding && (
          <button
            type="button"
            onClick={() => {
              setMessage(null);
              setAdding(true);
            }}
            className="rounded-full bg-gp-green-dark px-4 py-1.5 text-sm font-medium text-white"
          >
            {b.add}
          </button>
        )}
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{b.intro}</p>
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-gp-green-dark" : "text-red-600"}`}>
          {message.text}
        </p>
      )}

      {adding && (
        <DeviceForm
          stations={snap.stations.map((s) => ({ id: s.id, name: s.name }))}
          onCancel={() => setAdding(false)}
          onSave={async (input) => {
            const id = input.externalId.trim().toUpperCase();
            if (await run(() => backend.createDevice(input), format(b.added, { id }))) setAdding(false);
          }}
        />
      )}

      {devices.length === 0 ? (
        <p className={`${card} text-sm text-zinc-500`}>{b.empty}</p>
      ) : (
        <ul className="space-y-2">
          {devices.map((d) => {
            const switchable = canSwitch(d.externalId);
            return (
              <li key={d.externalId} className={`${card} space-y-3`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono text-sm font-medium">{d.externalId}</div>
                    <div className="text-xs text-zinc-500">
                      {idx.stationName(d.stationId)} · {[d.vendor, d.model].filter(Boolean).join(" ") || b.links[d.link]} ·{" "}
                      {b.lastSeen}: {d.lastSeenAt ? relativeTime(d.lastSeenAt, now) : b.never}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(format(b.confirmRemove, { id: d.externalId, n: d.points.length }))) {
                        run(() => backend.deleteDevice(d.externalId), format(b.removed, { id: d.externalId }));
                      }
                    }}
                    className="text-sm text-red-600 hover:underline"
                  >
                    {b.remove}
                  </button>
                </div>
                <ul className="grid gap-2 sm:grid-cols-2">
                  {d.points.map((p) => {
                    const status = displayStatus(p, now);
                    return (
                      <li
                        key={p.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-black/10 px-3 py-2 text-sm dark:border-white/10"
                      >
                        <span className="font-medium">
                          {b.outlet} {p.outlet} · {p.label}
                        </span>
                        <span className="flex items-center gap-2">
                          <Pill tone={TONE[status]}>{b.status[status]}</Pill>
                          {switchable && p.outlet !== null && (
                            <>
                              <button
                                type="button"
                                onClick={() => run(() => backend.switchOutlet(d.externalId, p.outlet!, true), format(b.sent, { label: p.label }))}
                                className="text-gp-green-dark hover:underline"
                              >
                                {b.on}
                              </button>
                              <button
                                type="button"
                                onClick={() => run(() => backend.switchOutlet(d.externalId, p.outlet!, false), format(b.sent, { label: p.label }))}
                                className="text-zinc-600 hover:underline dark:text-zinc-300"
                              >
                                {b.off}
                              </button>
                            </>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function DeviceForm({
  stations,
  onSave,
  onCancel,
}: {
  stations: { id: string; name: string }[];
  onSave: (input: DeviceInput) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const f = t.backoffice.devices.form;
  const links = t.backoffice.devices.links;
  const [input, setInput] = useState<DeviceInput>(EMPTY);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<DeviceInput>) => setInput((prev) => ({ ...prev, ...patch }));

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
        {f.externalId}
        <input
          required
          value={input.externalId}
          onChange={(e) => set({ externalId: e.target.value })}
          pattern="[0-9A-Za-z:_\-]{4,64}"
          autoComplete="off"
          className={`${field} font-mono`}
        />
        <span className="text-xs text-zinc-500">{f.externalIdHint}</span>
      </label>
      <label className={label}>
        {f.station}
        <select required value={input.stationId} onChange={(e) => set({ stationId: e.target.value })} className={field}>
          <option value="">{f.chooseStation}</option>
          {stations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        {f.outlets}
        <input
          type="number"
          required
          min={1}
          max={MAX_OUTLETS}
          value={input.outlets}
          onChange={(e) => set({ outlets: Number(e.target.value) })}
          className={field}
        />
      </label>
      <label className={label}>
        {f.link}
        <select value={input.link} onChange={(e) => set({ link: e.target.value as DeviceInput["link"] })} className={field}>
          {DEVICE_LINKS.map((l) => (
            <option key={l} value={l}>
              {links[l]}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        {f.vendor}
        <input value={input.vendor} onChange={(e) => set({ vendor: e.target.value })} maxLength={80} className={field} />
      </label>
      <label className={label}>
        {f.model}
        <input value={input.model} onChange={(e) => set({ model: e.target.value })} maxLength={80} className={field} />
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
