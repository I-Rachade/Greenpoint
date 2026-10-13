"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { useDateTime } from "@/components/backoffice/shared";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { measuresOf, PARCEL_SIZES, type Parcel, type ParcelInfo, type ParcelInput, type ParcelSize } from "@/lib/parcels";
import type { StationBooking } from "@/lib/partners";
import type { StationView } from "@/lib/types";
import { fareFor } from "@/lib/drivers";
import { distanceMeters } from "@/lib/geo";
import { useApp } from "../app-provider";
import { BackIcon } from "../icons";
import { StationDriversSection } from "../drivers/station-drivers";
import { useI18n } from "../i18n-provider";
import { canScanQr, QrScanner } from "./qr-scanner";
import { SizePicker } from "./size-picker";
import { SlipDialog } from "./slip-dialog";
import { ParcelStatusPill } from "./status";

/** Back to the station home with its two big buttons (status, parcels); only there while the parcel module is on. */
export function OperatorBack() {
  const { t } = useI18n();
  const { features } = useApp();
  if (!features.parcels) return null;
  return (
    <Link href="/operator" className="-ml-1 inline-flex items-center gap-1 text-sm text-gp-green-dark dark:text-gp-green">
      <BackIcon size={18} />
      {t.operator.back}
    </Link>
  );
}

const input = "w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-sm dark:border-white/20 dark:bg-zinc-900";
const primary = "rounded-full bg-gp-green-dark px-4 py-2 text-sm font-medium text-white disabled:opacity-40";

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-2 rounded-xl border border-black/10 p-4 dark:border-white/10">
      <h2 className="font-semibold">{title}</h2>
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
      {children}
    </section>
  );
}

function PickupBox({ stationId, onDone, onError }: { stationId: string; onDone: (msg: string) => void; onError: (msg: string) => void }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const [code, setCode] = useState("");
  const [scanning, setScanning] = useState(false);

  async function handOver(value: string) {
    onError("");
    try {
      const parcel = await backend.pickUpParcel(stationId, value);
      setCode("");
      onDone(format(t.parcels.staff.handedOver, { no: parcel.trackingNo }));
    } catch (err) {
      onError(errorMessage(err));
    }
  }

  return (
    <Section title={t.parcels.staff.pickupTitle} hint={t.parcels.staff.pickupHint}>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void handOver(code);
        }}
      >
        <input
          inputMode="numeric"
          pattern="[0-9 ]{6,7}"
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))}
          placeholder="000000"
          aria-label={t.parcels.pickupCode}
          className="w-36 rounded-lg border border-black/20 bg-white px-3 py-2 text-center font-mono text-lg tracking-widest dark:border-white/20 dark:bg-zinc-950"
        />
        <button type="submit" className={primary}>
          {t.parcels.staff.pickupButton}
        </button>
        {canScanQr() && !scanning && (
          <button type="button" onClick={() => setScanning(true)} className="rounded-full border border-black/15 px-4 py-2 text-sm dark:border-white/20">
            {t.parcels.staff.scan}
          </button>
        )}
      </form>
      {scanning && (
        <QrScanner
          onClose={() => setScanning(false)}
          onResult={(text) => {
            setScanning(false);
            void handOver(text);
          }}
        />
      )}
    </Section>
  );
}

const empty = { senderPhone: "", senderName: "", recipientPhone: "", recipientName: "", toStationId: "", content: "", declaredValue: "" };

function NewParcelForm({
  station,
  stations,
  info,
  onCreated,
  onError,
}: {
  station: StationView;
  stations: StationView[];
  info: ParcelInfo;
  onCreated: (parcel: Parcel) => void;
  onError: (msg: string) => void;
}) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const [form, setForm] = useState(empty);
  const [checked, setChecked] = useState(false);
  const [paid, setPaid] = useState(false);
  const [express, setExpress] = useState(false);
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState<ParcelSize | null>(null);
  const set = (key: keyof typeof empty) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const num = (v: string) => Number(v.replace(",", "."));
  const tier = info.sizes.find((x) => x.size === size) ?? null;
  const destinations = info.depots
    .filter((d) => d.stationId !== station.id)
    .map((d) => stations.find((s) => s.id === d.stationId))
    .filter((s): s is StationView => !!s);
  const to = destinations.find((s) => s.id === form.toStationId);
  const fare = express && to ? fareFor(distanceMeters(station, to), true, info.driverSettings) : 0;
  const total = tier ? tier.priceFcfa + fare : 0;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!tier) return;
    onError("");
    setBusy(true);
    const parcel: ParcelInput = {
      senderPhone: form.senderPhone,
      senderName: form.senderName,
      recipientPhone: form.recipientPhone,
      recipientName: form.recipientName,
      toStationId: form.toStationId,
      content: form.content,
      declaredValue: form.declaredValue ? Math.round(num(form.declaredValue)) : null,
      measures: measuresOf(tier),
      express,
    };
    try {
      const created = await backend.createParcel(station.id, parcel);
      setForm(empty);
      setSize(null);
      setChecked(false);
      setPaid(false);
      setExpress(false);
      onCreated(created);
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const label = "space-y-1 text-sm";
  return (
    <Section title={t.parcels.staff.newTitle} hint={t.parcels.newAccount}>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <label className={label}>
          <span>{t.parcels.staff.senderPhone}</span>
          <input className={input} type="tel" required value={form.senderPhone} onChange={set("senderPhone")} placeholder="90 12 34 56" />
        </label>
        <label className={label}>
          <span>{t.parcels.staff.name}</span>
          <input className={input} value={form.senderName} onChange={set("senderName")} maxLength={80} />
        </label>
        <label className={label}>
          <span>{t.parcels.staff.recipientPhone}</span>
          <input className={input} type="tel" required value={form.recipientPhone} onChange={set("recipientPhone")} placeholder="90 12 34 56" />
        </label>
        <label className={label}>
          <span>{t.parcels.staff.name}</span>
          <input className={input} value={form.recipientName} onChange={set("recipientName")} maxLength={80} />
        </label>
        <label className={`${label} sm:col-span-2`}>
          <span>{t.parcels.staff.destination}</span>
          <select className={input} required value={form.toStationId} onChange={set("toStationId")}>
            <option value="">{t.parcels.staff.chooseDestination}</option>
            {destinations.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className={`${label} sm:col-span-2`}>
          <span>{t.parcels.staff.content}</span>
          <input className={input} required value={form.content} onChange={set("content")} maxLength={300} />
        </label>
        <div className="sm:col-span-2">
          <SizePicker tiers={info.sizes} value={size} onChange={setSize} />
        </div>
        <label className={label}>
          <span>{t.parcels.staff.declaredValue}</span>
          <input className={input} inputMode="numeric" value={form.declaredValue} onChange={set("declaredValue")} />
        </label>
        <div className="flex items-end text-sm font-semibold" aria-live="polite">
          {tier &&
            (fare
              ? format(t.drivers.staff.expressPrice, { parcel: tier.priceFcfa, fare, total })
              : format(t.parcels.staff.computed, { size: tier.size, price: tier.priceFcfa }))}
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={express} onChange={(e) => setExpress(e.target.checked)} />
          {t.drivers.staff.express}
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" required checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          {t.parcels.staff.checkedContent}
        </label>
        {tier && (
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input type="checkbox" required checked={paid} onChange={(e) => setPaid(e.target.checked)} />
            {format(t.parcels.staff.cashReceived, { price: total })}
          </label>
        )}
        <div className="sm:col-span-2">
          <button type="submit" className={primary} disabled={busy || !tier}>
            {t.parcels.staff.create}
          </button>
        </div>
      </form>
    </Section>
  );
}

/** One parcel booked by a partner app: staff measure it, check the content and take it in. */
function BookedParcel({
  booking,
  station,
  stations,
  info,
  onAccepted,
  onError,
}: {
  booking: StationBooking;
  station: StationView;
  stations: StationView[];
  info: ParcelInfo;
  onAccepted: (parcel: Parcel) => void;
  onError: (msg: string) => void;
}) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState<ParcelSize>(booking.size);
  const tier = info.sizes.find((x) => x.size === size) ?? null;
  const bigger = tier && PARCEL_SIZES.indexOf(tier.size) > PARCEL_SIZES.indexOf(booking.size);
  const to = stations.find((s) => s.id === booking.toStationId)?.name ?? "?";

  async function accept(e: FormEvent) {
    e.preventDefault();
    onError("");
    setBusy(true);
    try {
      if (!tier) return;
      onAccepted(await backend.acceptBooking(station.id, booking.id, measuresOf(tier)));
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="space-y-2 rounded-lg bg-zinc-100 p-2 text-sm dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono">{booking.trackingNo}</span>
        <span>
          {booking.size} · → {to} · {booking.recipient.name ? `${booking.recipient.name} · ` : ""}
          {booking.recipient.phone}
        </span>
        <span className="flex-1" />
        {!open && (
          <button type="button" className={primary} onClick={() => setOpen(true)}>
            {t.parcels.staff.accept}
          </button>
        )}
      </div>
      <p className="text-xs text-zinc-500">
        {format(t.parcels.staff.bookedRef, { partner: booking.partnerName, ref: booking.reference })} · {booking.content}
      </p>
      {open && (
        <form onSubmit={accept} className="space-y-2">
          <p className="text-xs font-medium">{t.parcels.staff.bookedMeasured}</p>
          <SizePicker tiers={info.sizes} value={size} onChange={setSize} />
          <p className="text-xs font-semibold" aria-live="polite">
            {!tier ? (
              <span className="text-red-600">{t.parcels.staff.tooLarge}</span>
            ) : bigger ? (
              <span className="text-amber-700 dark:text-amber-300">{format(t.parcels.staff.bookedBigger, { size: tier.size, price: tier.priceFcfa })}</span>
            ) : (
              format(t.parcels.staff.computed, { size: tier.size, price: tier.priceFcfa })
            )}
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" required checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            {t.parcels.staff.checkedContent}
          </label>
          <div className="flex gap-2">
            <button type="submit" className={primary} disabled={busy || !tier}>
              {t.parcels.staff.accept}
            </button>
            <button type="button" className="rounded-full border border-black/15 px-4 py-2 text-sm dark:border-white/20" onClick={() => setOpen(false)}>
              {t.partners.cancel}
            </button>
          </div>
        </form>
      )}
    </li>
  );
}

/** A list of parcels with tick boxes and one action for the ticked ones. */
function BatchList({
  parcels,
  stations,
  actionLabel,
  onAction,
  extra,
}: {
  parcels: Parcel[];
  stations: StationView[];
  actionLabel: (n: number) => string;
  onAction: (ids: string[]) => Promise<boolean>;
  extra?: (p: Parcel) => ReactNode;
}) {
  const { t } = useI18n();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const name = (id: string) => stations.find((s) => s.id === id)?.name ?? "?";
  const ids = parcels.map((p) => p.id).filter((id) => selected.has(id));
  if (parcels.length === 0) return <p className="text-sm text-zinc-500">{t.parcels.staff.none}</p>;
  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2 text-xs text-zinc-500">
        <input
          type="checkbox"
          checked={ids.length === parcels.length}
          onChange={(e) => setSelected(new Set(e.target.checked ? parcels.map((p) => p.id) : []))}
        />
        {t.parcels.staff.selectAll}
      </label>
      <ul className="space-y-1">
        {parcels.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-100 p-2 text-sm dark:bg-zinc-900">
            <input
              type="checkbox"
              aria-label={p.trackingNo}
              checked={selected.has(p.id)}
              onChange={(e) =>
                setSelected((s) => {
                  const next = new Set(s);
                  if (e.target.checked) next.add(p.id);
                  else next.delete(p.id);
                  return next;
                })
              }
            />
            <span className="font-mono">{p.trackingNo}</span>
            <span>
              {p.size} · {name(p.fromStationId)} → {name(p.toStationId)}
            </span>
            <span className="flex-1" />
            {extra?.(p)}
          </li>
        ))}
      </ul>
      <button
        type="button"
        className={primary}
        disabled={ids.length === 0}
        onClick={() => void onAction(ids).then((ok) => ok && setSelected(new Set()))}
      >
        {actionLabel(ids.length)}
      </button>
    </div>
  );
}

function StationParcels({ station, stations, info }: { station: StationView; stations: StationView[]; info: ParcelInfo }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const when = useDateTime();
  const { data: parcels, reload } = useLiveQuery(() => backend.stationParcels(station.id), station.id);
  const { data: bookings, reload: reloadBookings } = useLiveQuery(() => backend.stationBookings(station.id), station.id);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [slip, setSlip] = useState<Parcel | null>(null);
  const hasDepot = info.depots.some((d) => d.stationId === station.id);

  async function run(action: () => Promise<unknown>, success = ""): Promise<boolean> {
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(success);
      reload();
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    }
  }

  if (!hasDepot) return <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.parcels.staff.noDepot}</p>;
  const list = parcels ?? [];
  // Express parcels go with a driver (section below), not on the collection run.
  const outgoing = list.filter((p) => p.fromStationId === station.id && p.status === "deposited" && !p.express);
  const incoming = list.filter((p) => p.toStationId === station.id && p.status === "in_transit" && !p.express);
  const waiting = list.filter((p) => p.toStationId === station.id && p.status === "arrived");
  const history = list.filter((p) => !["deposited", "in_transit", "arrived"].includes(p.status)).slice(0, 30);
  const small = "rounded-full border border-black/15 px-2 py-0.5 text-xs dark:border-white/20";

  return (
    <div className="space-y-4">
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-gp-green-dark dark:text-gp-green">
          {notice}
        </p>
      )}
      {/* Registering a parcel is the main job at the counter, so it comes first. */}
      <NewParcelForm
        station={station}
        stations={stations}
        info={info}
        onError={setError}
        onCreated={(parcel) => {
          setNotice(format(t.parcels.staff.created, { no: parcel.trackingNo }));
          setSlip(parcel);
          reload();
        }}
      />
      <PickupBox
        stationId={station.id}
        onError={setError}
        onDone={(msg) => {
          setNotice(msg);
          reload();
        }}
      />
      {(bookings?.length ?? 0) > 0 && (
        <Section title={t.parcels.staff.bookedTitle} hint={t.parcels.staff.bookedHint}>
          <ul className="space-y-2">
            {bookings!.map((b) => (
              <BookedParcel
                key={b.id}
                booking={b}
                station={station}
                stations={stations}
                info={info}
                onError={setError}
                onAccepted={(parcel) => {
                  setNotice(format(t.parcels.staff.accepted, { no: parcel.trackingNo }));
                  setSlip(parcel);
                  reload();
                  reloadBookings();
                }}
              />
            ))}
          </ul>
        </Section>
      )}
      <Section title={t.parcels.staff.outgoing} hint={t.parcels.staff.outgoingHint}>
        <BatchList
          parcels={outgoing}
          stations={stations}
          actionLabel={(n) => format(t.parcels.staff.markInTransit, { n })}
          onAction={(ids) => run(() => backend.markParcelsInTransit(station.id, ids))}
          extra={(p) => (
            <>
              <button type="button" className={small} onClick={() => setSlip(p)}>
                {t.parcels.slip}
              </button>
              <button
                type="button"
                className={small}
                onClick={() => window.confirm(t.parcels.staff.confirmCancel) && void run(() => backend.cancelParcel(p.id))}
              >
                {t.parcels.staff.cancel}
              </button>
            </>
          )}
        />
      </Section>
      <Section title={t.parcels.staff.incoming}>
        <BatchList
          parcels={incoming}
          stations={stations}
          actionLabel={(n) => format(t.parcels.staff.markArrived, { n })}
          onAction={(ids) => run(() => backend.markParcelsArrived(station.id, ids))}
        />
      </Section>
      <Section title={t.parcels.staff.waiting}>
        {waiting.length === 0 ? (
          <p className="text-sm text-zinc-500">{t.parcels.staff.none}</p>
        ) : (
          <ul className="space-y-1">
            {waiting.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-zinc-100 p-2 text-sm dark:bg-zinc-900">
                <span className="font-mono">{p.trackingNo}</span>
                <span>
                  {p.size} · {p.recipient.name ? `${p.recipient.name} · ` : ""}
                  {p.recipient.phone}
                </span>
                {p.deliveryStatus && <span className="text-xs text-blue-700 dark:text-blue-300">{t.drivers.delivery[p.deliveryStatus]}</span>}
                <span className="flex-1" />
                {p.pickupDeadline && <span className="text-xs text-zinc-500">{format(t.parcels.deadline, { date: when(p.pickupDeadline) })}</span>}
                <button type="button" className={small} onClick={() => void run(() => backend.resendPickupCode(p.id), t.parcels.staff.resent)}>
                  {t.parcels.staff.resend}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <h2 className="pt-2 text-lg font-semibold">{t.drivers.staff.title}</h2>
      <StationDriversSection station={station} stations={stations} />
      <Section title={t.parcels.staff.history}>
        {history.length === 0 ? (
          <p className="text-sm text-zinc-500">{t.parcels.staff.none}</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {history.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{p.trackingNo}</span>
                <ParcelStatusPill status={p.status} />
                <span className="text-xs text-zinc-500">{when(p.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {slip && <SlipDialog parcel={slip} stations={stations} onClose={() => setSlip(null)} />}
    </div>
  );
}

export function StaffParcels() {
  const { t } = useI18n();
  const { backend } = useApp();
  const { data, error } = useLiveQuery(() => Promise.all([backend.staffStations(), backend.listStations(), backend.parcelInfo()]));
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (error) return <p className="p-6 text-sm text-red-600">{t.errors.forbidden}</p>;
  if (!data) return <p className="p-6 text-sm text-zinc-500">{t.loading}</p>;
  const [allMine, all, info] = data;
  // Only stations that take parcels; admins see every station and would otherwise land on one without a counter.
  const depots = new Set(info.depots.map((d) => d.stationId));
  const mine = allMine.filter((s) => depots.has(s.id));
  const station = mine.find((s) => s.id === selectedId) ?? mine[0];

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 overflow-y-auto p-6">
      <OperatorBack />
      <h1 className="text-2xl font-semibold">{t.parcels.staff.title}</h1>
      {mine.length === 0 && <p className="text-sm">{allMine.length ? t.parcels.staff.noDepot : t.operator.noStations}</p>}
      {mine.length > 1 && (
        <select className={input} value={station?.id} onChange={(e) => setSelectedId(e.target.value)}>
          {mine.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
      {station && <StationParcels key={station.id} station={station} stations={all} info={info} />}
    </div>
  );
}
