"use client";

import { useState, type FormEvent } from "react";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { VEHICLE_TYPES, type StationInput, type StationKind, type StationView } from "@/lib/types";
import { useApp } from "./app-provider";
import { useI18n } from "./i18n-provider";

const KINDS: StationKind[] = ["charging", "swap", "both"];

function toInput(s: StationView): StationInput {
  return {
    operatorId: s.operatorId,
    name: s.name,
    address: s.address,
    lat: s.lat,
    lng: s.lng,
    kind: s.kind,
    vehicleTypes: s.vehicleTypes,
    chargingSlots: s.chargingSlots,
    batteryCapacity: s.batteryCapacity,
    openingHours: s.openingHours,
    phone: s.phone,
  };
}

function StationForm({
  initial,
  operators,
  onSave,
  onCancel,
}: {
  initial: StationInput;
  operators: { id: string; name: string }[];
  onSave: (input: StationInput) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof StationInput>(key: K, value: StationInput[K]) => setForm({ ...form, [key]: value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave(form);
    } finally {
      setBusy(false);
    }
  }

  const input = "w-full rounded-lg border border-black/15 bg-white px-3 py-2 dark:border-white/20 dark:bg-zinc-900";
  const label = "block space-y-1 text-sm";

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl border border-black/10 p-4 sm:grid-cols-2 dark:border-white/10">
      <label className={label}>
        <span>{t.admin.name}</span>
        <input className={input} value={form.name} onChange={(e) => set("name", e.target.value)} required />
      </label>
      <label className={label}>
        <span>{t.admin.operator}</span>
        <select className={input} value={form.operatorId} onChange={(e) => set("operatorId", e.target.value)} required>
          {operators.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      <label className={`${label} sm:col-span-2`}>
        <span>{t.admin.address}</span>
        <input className={input} value={form.address} onChange={(e) => set("address", e.target.value)} />
      </label>
      <label className={label}>
        <span>{t.admin.lat}</span>
        <input
          className={input}
          type="number"
          step="any"
          value={form.lat}
          onChange={(e) => set("lat", Number(e.target.value))}
          required
        />
      </label>
      <label className={label}>
        <span>{t.admin.lng}</span>
        <input
          className={input}
          type="number"
          step="any"
          value={form.lng}
          onChange={(e) => set("lng", Number(e.target.value))}
          required
        />
      </label>
      <p className="text-xs text-zinc-500 sm:col-span-2">{t.admin.coordsHint}</p>
      <label className={label}>
        <span>{t.admin.kind}</span>
        <select className={input} value={form.kind} onChange={(e) => set("kind", e.target.value as StationKind)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {t.kinds[k]}
            </option>
          ))}
        </select>
      </label>
      <label className={label}>
        <span>{t.admin.openingHours}</span>
        <input
          className={input}
          placeholder="07:00-21:00"
          value={form.openingHours}
          onChange={(e) => set("openingHours", e.target.value)}
        />
      </label>
      <label className={label}>
        <span>{t.admin.chargingSlots}</span>
        <input
          className={input}
          type="number"
          min={0}
          value={form.chargingSlots}
          onChange={(e) => set("chargingSlots", Number(e.target.value))}
        />
      </label>
      <label className={label}>
        <span>{t.admin.batteryCapacity}</span>
        <input
          className={input}
          type="number"
          min={0}
          value={form.batteryCapacity}
          onChange={(e) => set("batteryCapacity", Number(e.target.value))}
        />
      </label>
      <fieldset className="space-y-1 text-sm sm:col-span-2">
        <legend>{t.admin.vehicles}</legend>
        <div className="flex flex-wrap gap-3">
          {VEHICLE_TYPES.map((v) => (
            <label key={v} className="flex items-center gap-1">
              <input
                type="checkbox"
                className="accent-green-600"
                checked={form.vehicleTypes.includes(v)}
                onChange={(e) =>
                  set(
                    "vehicleTypes",
                    e.target.checked ? [...form.vehicleTypes, v] : form.vehicleTypes.filter((x) => x !== v),
                  )
                }
              />
              {t.vehicles[v]}
            </label>
          ))}
        </div>
      </fieldset>
      <label className={label}>
        <span>{t.admin.phone}</span>
        <input
          className={input}
          type="tel"
          value={form.phone ?? ""}
          onChange={(e) => set("phone", e.target.value || null)}
        />
      </label>
      <div className="flex items-end gap-2 sm:col-span-2">
        <button type="submit" disabled={busy} className="rounded-full bg-green-600 px-4 py-2 text-sm font-medium text-white">
          {t.admin.save}
        </button>
        <button type="button" onClick={onCancel} className="rounded-full px-4 py-2 text-sm underline">
          {t.admin.cancel}
        </button>
      </div>
    </form>
  );
}

export function AdminStations() {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const { data, reload } = useLiveQuery(() => Promise.all([backend.listStations(), backend.listOperators()]));
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (!data) return <p className="p-6 text-sm text-zinc-500">{t.loading}</p>;
  const [stations, operators] = data;

  async function save(id: string | null, input: StationInput) {
    try {
      await backend.saveStation(id, input);
      setMessage({ ok: true, text: t.admin.saved });
      setEditing(null);
      reload();
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    }
  }

  const blank: StationInput = {
    operatorId: operators.find((o) => o.isOwn)?.id ?? operators[0]?.id ?? "",
    name: "",
    address: "",
    lat: 6.1319,
    lng: 1.2228,
    kind: "both",
    vehicleTypes: ["scooter"],
    chargingSlots: 0,
    batteryCapacity: 0,
    openingHours: "",
    phone: null,
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 overflow-y-auto p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t.admin.title}</h1>
        {editing === null && (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="rounded-full bg-green-600 px-4 py-2 text-sm font-medium text-white"
          >
            {t.admin.add}
          </button>
        )}
      </div>
      {message && <p className={`text-sm ${message.ok ? "text-green-700" : "text-red-600"}`}>{message.text}</p>}
      {editing === "new" && (
        <StationForm initial={blank} operators={operators} onSave={(i) => save(null, i)} onCancel={() => setEditing(null)} />
      )}
      <ul className="space-y-2">
        {stations.map((s) =>
          editing === s.id ? (
            <li key={s.id}>
              <StationForm
                initial={toInput(s)}
                operators={operators}
                onSave={(i) => save(s.id, i)}
                onCancel={() => setEditing(null)}
              />
            </li>
          ) : (
            <li key={s.id} className="flex items-center gap-3 rounded-lg border border-black/10 p-3 dark:border-white/10">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{s.name}</div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  {s.operatorName} · {t.kinds[s.kind]} · {s.lat.toFixed(4)}, {s.lng.toFixed(4)}
                </div>
              </div>
              <button type="button" onClick={() => setEditing(s.id)} className="text-sm text-green-700 hover:underline">
                {t.admin.edit}
              </button>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
