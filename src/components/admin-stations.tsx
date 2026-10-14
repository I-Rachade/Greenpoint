"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { offersCharging, offersSwap } from "@/lib/availability";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import type { Device } from "@/lib/iot/devices";
import type { Parcel, ParcelDepot } from "@/lib/parcels";
import { batteryTypeLabel, groupByBrand, type BatteryType } from "@/lib/battery-types";
import { hasAnyPoint, kindFor } from "@/lib/station-points";
import { VEHICLE_TYPES, type StationInput, type StationView } from "@/lib/types";
import { useApp } from "./app-provider";
import { StationMediaFields, StationReviewsAdmin } from "./backoffice/station-media";
import { BatteryIcon, BoltIcon, BoxIcon, CarIcon, SunIcon } from "./icons";
import { useI18n } from "./i18n-provider";
import { SolarBadge } from "./solar-badge";

/** The form's view of a station: general fields plus each point switched on or off. */
interface FormState {
  input: StationInput;
  swap: boolean;
  charging: boolean;
  parcelCounter: boolean;
  parcelLockers: boolean;
  lockers: number;
  note: string;
  /** Battery types the swap point swaps. */
  batteryTypeIds: string[];
}

function toForm(input: StationInput, depot: ParcelDepot | undefined, batteryTypeIds: string[] = []): FormState {
  const active = !!depot?.isActive;
  return {
    input,
    swap: offersSwap(input.kind),
    charging: offersCharging(input.kind),
    parcelCounter: active && depot!.counter,
    parcelLockers: active && depot!.lockers > 0,
    lockers: depot?.lockers || 0,
    note: depot?.note ?? "",
    batteryTypeIds,
  };
}

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
    isSolar: s.isSolar,
    photos: s.photos ?? [],
    amenities: s.amenities ?? [],
  };
}

/** Parcels handed in at the station or waiting there for their recipient. */
function parcelsAt(parcels: Parcel[], stationId: string): number {
  return parcels.filter(
    (p) =>
      (p.status === "deposited" && p.fromStationId === stationId) ||
      ((p.status === "arrived" || p.status === "stored") && p.toStationId === stationId),
  ).length;
}

const input = "w-full rounded-lg border border-black/15 bg-white px-3 py-2 dark:border-white/20 dark:bg-zinc-900";
const label = "block space-y-1 text-sm";

/** One point of the station: a switch, a hint and, while it is on, its settings. */
function PointSection({
  icon,
  title,
  hint,
  on,
  onToggle,
  children,
}: {
  icon: ReactNode;
  title: string;
  hint: string;
  on: boolean;
  onToggle: (on: boolean) => void;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <section className={`space-y-2 rounded-lg border p-3 ${on ? "border-gp-green-dark/40 bg-gp-green/5" : "border-black/10 dark:border-white/10"}`}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 text-gp-green-dark">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="font-medium">{title}</div>
          <p className="text-xs text-zinc-500">{hint}</p>
        </div>
        <label className="flex shrink-0 items-center gap-1 text-sm">
          <input type="checkbox" className="accent-gp-green-dark" checked={on} onChange={(e) => onToggle(e.target.checked)} />
          {t.admin.points.offered}
        </label>
      </div>
      {on && children}
    </section>
  );
}

function StationForm({
  stationId,
  initial,
  operators,
  sockets,
  parcelCount,
  batteryTypes,
  evChargers,
  onSave,
  onCancel,
}: {
  /** Null for a new station. */
  stationId: string | null;
  initial: FormState;
  operators: { id: string; name: string }[];
  /** All battery types; switched-off ones only show while still ticked. */
  batteryTypes: BatteryType[];
  /** Connected sockets registered at this station. */
  sockets: Device[];
  parcelCount: number;
  /** Active electric car chargers assigned to the station; assigned in the "Bornes VE" tab. */
  evChargers: number;
  onSave: (input: StationInput) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const p = t.admin.points;
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const set = <K extends keyof StationInput>(key: K, value: StationInput[K]) => setForm({ ...form, input: { ...form.input, [key]: value } });
  const toggle = (key: "swap" | "charging" | "parcelCounter" | "parcelLockers", on: boolean) =>
    setForm({ ...form, [key]: on, ...(key === "parcelLockers" && on && form.lockers < 1 ? { lockers: 1 } : {}) });
  const outlets = sockets.reduce((n, d) => n + d.outlets, 0);
  const shownTypes = batteryTypes.filter((bt) => bt.isActive || initial.batteryTypeIds.includes(bt.id));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!hasAnyPoint(form)) {
      setProblem(t.errors.station_without_point);
      return;
    }
    setProblem(null);
    const hadDepot = initial.parcelCounter || initial.parcelLockers || initial.note !== "" || initial.lockers > 0;
    const parcels = form.parcelCounter || form.parcelLockers;
    setBusy(true);
    try {
      await onSave({
        ...form.input,
        kind: kindFor(form.swap, form.charging),
        batteryCapacity: form.swap ? form.input.batteryCapacity : 0,
        batteryTypeIds: form.swap ? form.batteryTypeIds : [],
        // Only touch the depot when the station has or gets one.
        ...(parcels || hadDepot
          ? {
              parcelDepot: {
                isActive: parcels,
                counter: form.parcelCounter,
                lockers: form.parcelLockers ? Math.max(1, Math.floor(form.lockers)) : 0,
                note: form.note,
              },
            }
          : {}),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 rounded-xl border border-black/10 p-4 sm:grid-cols-2 dark:border-white/10">
      <label className={label}>
        <span>{t.admin.name}</span>
        <input className={input} value={form.input.name} onChange={(e) => set("name", e.target.value)} required />
      </label>
      <label className={label}>
        <span>{t.admin.operator}</span>
        <select className={input} value={form.input.operatorId} onChange={(e) => set("operatorId", e.target.value)} required>
          {operators.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      <label className={`${label} sm:col-span-2`}>
        <span>{t.admin.address}</span>
        <input className={input} value={form.input.address} onChange={(e) => set("address", e.target.value)} />
      </label>
      <label className={label}>
        <span>{t.admin.lat}</span>
        <input
          className={input}
          type="number"
          step="any"
          value={form.input.lat}
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
          value={form.input.lng}
          onChange={(e) => set("lng", Number(e.target.value))}
          required
        />
      </label>
      <p className="text-xs text-zinc-500 sm:col-span-2">{t.admin.coordsHint}</p>
      <label className={label}>
        <span>{t.admin.openingHours}</span>
        <input
          className={input}
          placeholder="07:00-21:00"
          value={form.input.openingHours}
          onChange={(e) => set("openingHours", e.target.value)}
        />
        <span className="text-xs text-zinc-500">{t.admin.openingHoursHint}</span>
      </label>
      <label className={label}>
        <span>{t.admin.phone}</span>
        <input
          className={input}
          type="tel"
          value={form.input.phone ?? ""}
          onChange={(e) => set("phone", e.target.value || null)}
        />
      </label>

      <section
        className={`flex items-start gap-2 rounded-lg border p-3 sm:col-span-2 ${
          form.input.isSolar ? "border-amber-400/60 bg-amber-50 dark:bg-amber-400/10" : "border-black/10 dark:border-white/10"
        }`}
      >
        <span className="mt-0.5 text-amber-600">
          <SunIcon size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-medium">{p.solar}</div>
          <p className="text-xs text-zinc-500">{p.solarHint}</p>
        </div>
        <label className="flex shrink-0 items-center gap-1 text-sm">
          <input
            type="checkbox"
            className="accent-amber-600"
            checked={!!form.input.isSolar}
            onChange={(e) => set("isSolar", e.target.checked)}
          />
          {p.solarOn}
        </label>
      </section>

      <div className="space-y-2 sm:col-span-2">
        <div>
          <h3 className="text-sm font-semibold">{p.title}</h3>
          <p className="text-xs text-zinc-500">{p.hint}</p>
        </div>

        <PointSection icon={<BatteryIcon size={18} />} title={p.swap} hint={p.swapHint} on={form.swap} onToggle={(on) => toggle("swap", on)}>
          <label className={label}>
            <span>{t.admin.batteryCapacity}</span>
            <input
              className={`${input} sm:w-40`}
              type="number"
              min={0}
              value={form.input.batteryCapacity}
              onChange={(e) => set("batteryCapacity", Number(e.target.value))}
            />
          </label>
          <fieldset className="space-y-1 text-sm">
            <legend>{p.batteryTypes}</legend>
            <p className="text-xs text-zinc-500">{p.batteryTypesHint}</p>
            {shownTypes.length === 0 ? (
              <p className="text-xs text-amber-700 dark:text-amber-500">{p.noBatteryTypes}</p>
            ) : (
              groupByBrand(shownTypes).map(([brand, types]) => (
                <div key={brand} className="flex flex-wrap items-center gap-3">
                  <span className="w-28 shrink-0 font-medium">{brand}</span>
                  {types.map((bt) => (
                    <label key={bt.id} className={`flex items-center gap-1 ${bt.isActive ? "" : "opacity-60"}`}>
                      <input
                        type="checkbox"
                        className="accent-gp-green-dark"
                        checked={form.batteryTypeIds.includes(bt.id)}
                        onChange={(e) =>
                          setForm({
                            ...form,
                            batteryTypeIds: e.target.checked
                              ? [...form.batteryTypeIds, bt.id]
                              : form.batteryTypeIds.filter((x) => x !== bt.id),
                          })
                        }
                      />
                      {bt.name}
                    </label>
                  ))}
                </div>
              ))
            )}
          </fieldset>
        </PointSection>

        <PointSection
          icon={<BoltIcon size={18} />}
          title={p.charging}
          hint={p.chargingHint}
          on={form.charging}
          onToggle={(on) => toggle("charging", on)}
        >
          {sockets.length === 0 ? (
            <p className="text-sm text-amber-700 dark:text-amber-500">{p.noSockets}</p>
          ) : (
            <div className="text-sm">
              <div className="font-medium">{format(p.sockets, { n: outlets })}</div>
              <ul className="text-xs text-zinc-600 dark:text-zinc-400">
                {sockets.map((d) => (
                  <li key={d.externalId}>
                    {d.externalId} · {[d.vendor, d.model].filter(Boolean).join(" ") || d.link} · {d.outlets}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Link href="/admin/devices" className="text-sm text-gp-green-dark hover:underline">
            {p.manageSockets}
          </Link>
        </PointSection>

        <PointSection
          icon={<BoxIcon size={18} />}
          title={p.parcelCounter}
          hint={p.parcelCounterHint}
          on={form.parcelCounter}
          onToggle={(on) => toggle("parcelCounter", on)}
        >
          <label className={label}>
            <span>{p.note}</span>
            <input className={input} value={form.note} maxLength={200} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </label>
        </PointSection>

        <PointSection
          icon={<BoxIcon size={18} />}
          title={p.parcelLockers}
          hint={p.parcelLockersHint}
          on={form.parcelLockers}
          onToggle={(on) => toggle("parcelLockers", on)}
        >
          <label className={label}>
            <span>{p.lockers}</span>
            <input
              className={`${input} sm:w-40`}
              type="number"
              min={1}
              max={500}
              value={form.lockers}
              onChange={(e) => setForm({ ...form, lockers: Number(e.target.value) })}
            />
          </label>
        </PointSection>
        {(form.parcelCounter || form.parcelLockers) && parcelCount > 0 && (
          <p className="text-xs text-zinc-500">{format(p.parcelsHere, { n: parcelCount })}</p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-black/10 p-3 text-sm dark:border-white/10">
          <span className="flex items-center gap-2">
            <CarIcon size={18} className="text-gp-green-dark" />
            {format(p.evChargers, { n: evChargers })}
          </span>
          <Link href="/admin/ev-chargers" className="text-gp-green-dark hover:underline">
            {p.manageEvChargers}
          </Link>
        </div>
      </div>

      <StationMediaFields
        photos={form.input.photos ?? []}
        amenities={form.input.amenities ?? []}
        onPhotos={(photos) => set("photos", photos)}
        onAmenities={(amenities) => set("amenities", amenities)}
      />
      {stationId && <StationReviewsAdmin stationId={stationId} />}

      {(form.swap || form.charging) && (
        <fieldset className="space-y-1 text-sm sm:col-span-2">
          <legend>{t.admin.vehicles}</legend>
          <div className="flex flex-wrap gap-3">
            {VEHICLE_TYPES.map((v) => (
              <label key={v} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  className="accent-gp-green-dark"
                  checked={form.input.vehicleTypes.includes(v)}
                  onChange={(e) =>
                    set(
                      "vehicleTypes",
                      e.target.checked ? [...form.input.vehicleTypes, v] : form.input.vehicleTypes.filter((x) => x !== v),
                    )
                  }
                />
                {t.vehicles[v]}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {problem && (
        <p role="alert" className="text-sm text-red-600 sm:col-span-2">
          {problem}
        </p>
      )}
      <div className="flex items-end gap-2 sm:col-span-2">
        <button type="submit" disabled={busy} className="rounded-full bg-gp-green-dark px-4 py-2 text-sm font-medium text-white">
          {t.admin.save}
        </button>
        <button type="button" onClick={onCancel} className="rounded-full px-4 py-2 text-sm underline">
          {t.admin.cancel}
        </button>
      </div>
    </form>
  );
}

/** Small labels for the points a station offers. */
function PointBadges({ station, sockets }: { station: StationView; sockets: Device[] }) {
  const { t } = useI18n();
  const p = t.admin.points;
  const pill = "inline-flex items-center gap-1 rounded-full bg-gp-green/10 px-2 py-0.5 text-xs text-gp-green-dark";
  const outlets = sockets.reduce((n, d) => n + d.outlets, 0);
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {station.isSolar && <SolarBadge />}
      {offersSwap(station.kind) && (
        <span className={pill}>
          <BatteryIcon size={12} /> {p.swap} · {station.batteryCapacity}
          {(station.batteryTypes ?? []).length > 0 &&
            ` · ${(station.batteryTypes ?? []).map((bt) => `${batteryTypeLabel(bt)} (${bt.fullBatteries})`).join(", ")}`}
        </span>
      )}
      {offersCharging(station.kind) && (
        <span className={outlets ? pill : "inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800"}>
          <BoltIcon size={12} /> {p.charging} · {format(p.sockets, { n: outlets })}
        </span>
      )}
      {station.parcelPoint?.counter && (
        <span className={pill}>
          <BoxIcon size={12} /> {p.parcelCounter}
        </span>
      )}
      {(station.parcelPoint?.lockers ?? 0) > 0 && (
        <span className={pill}>
          <BoxIcon size={12} /> {p.parcelLockers} · {station.parcelPoint!.lockers}
        </span>
      )}
    </div>
  );
}

/** The battery types of the motorbike brands: add, rename, switch off. */
function BatteryTypesManager({
  types,
  usage,
  onChanged,
}: {
  types: BatteryType[];
  usage: (id: string) => number;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const b = t.admin.batteryTypes;
  const [brand, setBrand] = useState("");
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    try {
      await action();
      setProblem(null);
      onChanged();
    } catch (err) {
      setProblem(errorMessage(err));
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    await run(async () => {
      await backend.saveBatteryType(null, { brand, name, isActive: true });
      setName("");
    });
  }

  return (
    <section className="space-y-3 rounded-xl border border-black/10 p-4 dark:border-white/10">
      <div>
        <h2 className="flex items-center gap-2 font-semibold">
          <BatteryIcon size={18} /> {b.title}
        </h2>
        <p className="text-xs text-zinc-500">{b.hint}</p>
      </div>
      {types.length === 0 ? (
        <p className="text-sm text-zinc-500">{b.none}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {groupByBrand(types).map(([group, list]) => (
            <li key={group} className="flex flex-wrap items-center gap-2">
              <span className="w-28 shrink-0 font-medium">{group}</span>
              {list.map((bt) => (
                <span
                  key={bt.id}
                  className={`inline-flex items-center gap-2 rounded-full border px-2 py-0.5 ${bt.isActive ? "border-gp-green-dark/30" : "border-black/10 opacity-60 dark:border-white/10"}`}
                >
                  {bt.name}
                  <span className="text-xs text-zinc-500">{format(b.stations, { n: usage(bt.id) })}</span>
                  <button
                    type="button"
                    className="text-xs text-gp-green-dark hover:underline"
                    onClick={() => run(() => backend.saveBatteryType(bt.id, { brand: bt.brand, name: bt.name, isActive: !bt.isActive }))}
                  >
                    {bt.isActive ? b.deactivate : b.activate}
                  </button>
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="flex flex-wrap items-end gap-2">
        <label className={label}>
          <span>{b.brand}</span>
          <input className={`${input} w-40`} list="battery-brands" value={brand} maxLength={60} placeholder={b.brandPlaceholder} onChange={(e) => setBrand(e.target.value)} required />
          <datalist id="battery-brands">
            {[...new Set(types.map((bt) => bt.brand))].map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </label>
        <label className={label}>
          <span>{b.name}</span>
          <input className={`${input} w-40`} value={name} maxLength={80} placeholder={b.namePlaceholder} onChange={(e) => setName(e.target.value)} required />
        </label>
        <button type="submit" className="rounded-full bg-gp-green-dark px-4 py-2 text-sm font-medium text-white">
          {b.add}
        </button>
      </form>
      {problem && (
        <p role="alert" className="text-sm text-red-600">
          {problem}
        </p>
      )}
    </section>
  );
}

export function AdminStations() {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const { data, reload } = useLiveQuery(() =>
    Promise.all([
      backend.adminSnapshot(),
      backend.listOperators(),
      backend.listDevices(),
      backend.adminParcels(),
      backend.listBatteryTypes(),
    ]),
  );
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  if (!data) return <p className="p-6 text-sm text-zinc-500">{t.loading}</p>;
  const [snap, operators, devices, { parcels, depots }, batteryTypes] = data;
  const stations = [...snap.stations].sort((a, b) => a.name.localeCompare(b.name));
  const socketsOf = (id: string) => devices.filter((d) => d.stationId === id);
  const depotOf = (id: string) => depots.find((d) => d.stationId === id);

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
    isSolar: false,
    photos: [],
    amenities: [],
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 overflow-y-auto p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{t.admin.title}</h1>
        {editing === null && (
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="rounded-full bg-gp-green-dark px-4 py-2 text-sm font-medium text-white"
          >
            {t.admin.add}
          </button>
        )}
      </div>
      {message && <p className={`text-sm ${message.ok ? "text-gp-green-dark" : "text-red-600"}`}>{message.text}</p>}
      <BatteryTypesManager
        types={batteryTypes}
        usage={(id) => stations.filter((s) => (s.batteryTypes ?? []).some((bt) => bt.id === id)).length}
        onChanged={reload}
      />
      {editing === "new" && (
        <StationForm
          stationId={null}
          initial={toForm(blank, undefined)}
          operators={operators}
          sockets={[]}
          parcelCount={0}
          batteryTypes={batteryTypes}
          evChargers={0}
          onSave={(i) => save(null, i)}
          onCancel={() => setEditing(null)}
        />
      )}
      <ul className="space-y-2">
        {stations.map((s) =>
          editing === s.id ? (
            <li key={s.id}>
              <StationForm
                stationId={s.id}
                initial={toForm(
                  toInput(s),
                  depotOf(s.id),
                  (s.batteryTypes ?? []).map((bt) => bt.id),
                )}
                operators={operators}
                sockets={socketsOf(s.id)}
                parcelCount={parcelsAt(parcels, s.id)}
                batteryTypes={batteryTypes}
                evChargers={(s.evChargers ?? []).length}
                onSave={(i) => save(s.id, i)}
                onCancel={() => setEditing(null)}
              />
            </li>
          ) : (
            <li
              key={s.id}
              className={`flex items-center gap-3 rounded-lg border border-black/10 p-3 dark:border-white/10 ${s.isActive ? "" : "opacity-60"}`}
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium">{s.name}</div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  {s.operatorName} · {s.lat.toFixed(4)}, {s.lng.toFixed(4)}
                </div>
                <PointBadges station={s} sockets={socketsOf(s.id)} />
              </div>
              <button type="button" onClick={() => setEditing(s.id)} className="text-sm text-gp-green-dark hover:underline">
                {t.admin.edit}
              </button>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
