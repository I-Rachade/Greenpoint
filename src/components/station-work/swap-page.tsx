"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { isHolding } from "@shared/availability";
import { batteryNumbersRequired, type BatteryLookup } from "@shared/batteries";
import { reservationKind } from "@shared/reservations";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format, formatXof } from "@/lib/i18n/format";
import { newRequestId, SWAP_CUSTOMER_TYPES, takesBatteryIn, type StationCounter, type SwapCustomerType, type SwapInput } from "@shared/station-work";
import type { Reservation, StationView } from "@shared/types";
import { useApp } from "../app-provider";
import { ConfirmSheet } from "../confirm-sheet";
import { GreenpointStaff } from "../greenpoint/greenpoint-staff";
import { QrIcon } from "../icons";
import { useI18n } from "../i18n-provider";
import { LoadFailed } from "../load-state";
import { canScanQr, QrScanner } from "../parcels/qr-scanner";
import { useReservationWhat } from "../reservation-list";
import { Button, Card, EmptyState, Input, SkeletonCard, SuccessCheck, useToast } from "../ui";
import { WorkShell } from "./work-shell";

function Chips<T extends string>({ value, options, label, onChange }: { value: T; options: { id: T; label: string; disabled?: boolean }[]; label: string; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          disabled={o.disabled}
          onClick={() => onChange(o.id)}
          className={`min-h-11 rounded-full border px-4 text-sm font-semibold disabled:opacity-40 ${
            value === o.id ? "border-gp-green-dark bg-gp-green-dark text-white" : "border-gp-border bg-gp-surface"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A text field with a "scan" button when the phone can read QR codes. */
function ScanField({
  label,
  hint,
  value,
  onChange,
  required,
  inputMode,
  note,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  inputMode?: "tel" | "text";
  /** Shown under the hint, e.g. whether the battery is known. */
  note?: ReactNode;
}) {
  const [scanning, setScanning] = useState(false);
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex gap-2">
        <Input value={value} required={required} inputMode={inputMode} onChange={(e) => onChange(e.target.value)} />
        {canScanQr() && (
          <Button variant="secondary" onClick={() => setScanning(true)} aria-label={label}>
            <QrIcon size={20} />
          </Button>
        )}
      </div>
      {hint && <span className="block text-xs text-gp-muted">{hint}</span>}
      {note}
      {scanning && (
        <QrScanner
          onResult={(text) => {
            onChange(text);
            setScanning(false);
          }}
          onClose={() => setScanning(false)}
        />
      )}
    </label>
  );
}

/** Under a battery number: known (with its brand), new (added at the swap), or registered under another brand. */
function BatteryNote({ stationId, serial, typeId }: { stationId: string; serial: string; typeId: string }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const s = t.work.swap;
  const [found, setFound] = useState<{ key: string; lookup: BatteryLookup } | null>(null);
  const key = `${serial.trim().toUpperCase()}|${typeId}`;
  useEffect(() => {
    if (!serial.trim()) return;
    let live = true;
    // Asks once the staff stop typing.
    const timer = setTimeout(() => {
      backend
        .lookupBattery(stationId, serial, typeId || null)
        .then((lookup) => live && setFound({ key, lookup }))
        .catch(() => live && setFound(null));
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [backend, stationId, serial, typeId, key]);
  if (!serial.trim() || found?.key !== key) return null;
  const l = found.lookup;
  const flag = l.status && l.status !== "in_service" ? format(s.batteryFlag, { status: t.batteries.statuses[l.status] }) : null;
  const tone = l.state === "wrong_brand" ? "text-red-600" : l.state === "new" ? "text-blue-700 dark:text-blue-300" : "text-gp-green-dark dark:text-gp-green";
  const text =
    l.state === "wrong_brand"
      ? format(s.batteryWrongBrand, { brand: l.brand || t.batteries.unknownBrand })
      : l.state === "new"
        ? s.batteryNew
        : l.brand
          ? format(s.batteryKnown, { brand: l.brand })
          : s.batteryKnownNoBrand;
  return (
    <span role="status" className={`block text-xs font-semibold ${tone}`}>
      {text}
      {flag && <span className="block text-amber-700 dark:text-amber-300">{flag}</span>}
    </span>
  );
}

/**
 * The swap form. From a reservation (/operator/echange?reservation=…) it comes filled in:
 * the reservation's customer and battery type, the customer's code first; the swap then
 * completes the reservation (worker/station-work.ts recordSwap).
 */
function SwapForm({
  station,
  counter,
  reservation,
  onReservationDone,
  initialCode = "",
  initialContact = "",
}: {
  station: StationView;
  counter: StationCounter;
  reservation?: Reservation;
  onReservationDone?: () => void;
  /** Filled in from a scan (src/components/station-work/staff-scan.tsx): the reservation's code, or the customer's account. */
  initialCode?: string;
  initialContact?: string;
}) {
  const { t, locale } = useI18n();
  const { backend, features } = useApp();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const what = useReservationWhat();
  const s = t.work.swap;
  const rows = counter.rows;
  const heldOf = (id: string) => (station.batteryTypes ?? []).find((bt) => bt.id === id)?.reserved ?? 0;
  const [typeId, setTypeId] = useState(reservation?.target ?? (rows.length === 1 ? rows[0].batteryTypeId : ""));
  const [customerType, setCustomerType] = useState<SwapCustomerType>(reservation || initialContact ? "app" : "cash");
  const [code, setCode] = useState(initialCode);
  const [contact, setContact] = useState(initialContact);
  const [driverCode, setDriverCode] = useState("");
  // Green Credit only at a station an admin designated (0047).
  const creditHere = !!station.greenCredit;
  const [payment, setPayment] = useState<"wallet" | "cash">(creditHere ? "wallet" : "cash");
  const [creditCode, setCreditCode] = useState("");
  const [amount, setAmount] = useState("");
  const [batteryIn, setBatteryIn] = useState("");
  const [batteryOut, setBatteryOut] = useState("");
  // One id per swap being entered: confirming twice records it once.
  const [requestId, setRequestId] = useState(newRequestId);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const row = rows.find((r) => r.batteryTypeId === typeId);
  // Battery register: a station with battery types records every battery it swaps.
  const numbersRequired = batteryNumbersRequired(rows.some((r) => r.batteryTypeId !== ""));
  const typeLabel = row?.label ?? s.noType;
  const wallet = customerType === "app" && payment === "wallet" && creditHere;
  const takesCash = customerType === "cash" || customerType === "first_purchase" || (customerType === "app" && !wallet);
  // The swap price is set in the backoffice (station details); without it only a first purchase or a fleet swap goes through.
  const priceMissing = !counter.priceXof && customerType !== "first_purchase" && customerType !== "fleet";

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!row) return setError(t.errors.battery_type_required);
    setConfirming(true);
  }

  async function record() {
    const input: SwapInput = {
      requestId,
      batteryTypeId: typeId,
      customerType,
      batteryIn: takesBatteryIn(customerType) ? batteryIn : null,
      batteryOut,
      contact: !reservation && ((customerType === "app" && !wallet) || customerType === "first_purchase") ? contact || null : null,
      reservationId: reservation?.id ?? null,
      pickupCode: reservation ? code : null,
      driverCode: customerType === "fleet" ? driverCode : null,
      payment: customerType === "app" ? (wallet ? "wallet" : "cash") : undefined,
      creditCode: wallet ? creditCode : null,
      amountXof: customerType === "first_purchase" && amount !== "" ? Number(amount) : null,
    };
    setBusy(true);
    try {
      await backend.recordSwap(station.id, input);
      toast(t.work.saved);
      if (reservation) return onReservationDone?.();
      setDone(true);
      setRequestId(newRequestId());
      setContact("");
      setDriverCode("");
      setCreditCode("");
      setBatteryIn("");
      setBatteryOut("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (done) {
    return (
      <Card className="flex flex-col items-center gap-3 p-6 text-center">
        <SuccessCheck />
        <p className="font-semibold">{t.work.saved}</p>
        <Button size="lg" onClick={() => setDone(false)}>
          {s.title}
        </Button>
        <Button variant="ghost" href="/operator/journal">
          {s.log}
        </Button>
      </Card>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      {reservation && (
        <Card className="space-y-3 p-4">
          <div>
            <p className="font-semibold">{format(t.work.reservations.fromReservation, { customer: reservation.customer ?? t.work.reservations.customer })}</p>
            <p className="text-sm text-gp-muted">{what(reservation)}</p>
          </div>
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t.work.reservations.code}</span>
            <Input
              inputMode="numeric"
              pattern="[0-9]{4}"
              maxLength={4}
              required
              autoFocus
              autoComplete="off"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="0000"
              className="w-32 text-center font-mono tracking-widest"
            />
          </label>
        </Card>
      )}
      {rows.length > 1 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{s.type}</legend>
          <Chips
            value={typeId}
            label={s.type}
            onChange={setTypeId}
            options={rows.map((r) => {
              const held = heldOf(r.batteryTypeId);
              return {
                id: r.batteryTypeId,
                label: `${r.label ?? ""} · ${format(s.full, { n: r.full })}${held ? ` · ${format(s.held, { n: held })}` : ""}`,
                // From a reservation only its type; without one, only what no reservation holds.
                disabled: r.full <= 0 || (reservation?.target ? r.batteryTypeId !== reservation.target : !reservation && r.full - held <= 0),
              };
            })}
          />
        </fieldset>
      )}
      {rows.length === 1 && <p className="text-sm text-gp-muted">{format(s.full, { n: rows[0].full })}</p>}

      {!reservation && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{s.customer}</legend>
          <Chips
            value={customerType}
            label={s.customer}
            onChange={setCustomerType}
            options={SWAP_CUSTOMER_TYPES.map((id) => ({ id, label: s.customerTypes[id], disabled: id === "fleet" && features.lite }))}
          />
        </fieldset>
      )}

      {customerType === "app" && !reservation && !wallet && <ScanField label={s.contact} hint={s.contactHint} value={contact} onChange={setContact} required inputMode="tel" />}
      {customerType === "first_purchase" && <ScanField label={s.contactOptional} value={contact} onChange={setContact} inputMode="tel" />}
      {customerType === "fleet" && <ScanField label={s.driverCode} hint={s.fleetHint} value={driverCode} onChange={setDriverCode} required />}

      {takesBatteryIn(customerType) && (
        <ScanField
          label={s.batteryIn}
          hint={numbersRequired ? s.batteryHintRequired : s.batteryHint}
          value={batteryIn}
          onChange={setBatteryIn}
          required={numbersRequired}
          note={<BatteryNote stationId={station.id} serial={batteryIn} typeId={typeId} />}
        />
      )}
      <ScanField
        label={s.batteryOut}
        hint={numbersRequired ? s.batteryHintRequired : s.batteryHint}
        value={batteryOut}
        onChange={setBatteryOut}
        required={numbersRequired}
        note={<BatteryNote stationId={station.id} serial={batteryOut} typeId={typeId} />}
      />

      {customerType !== "fleet" && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{s.payment}</legend>
          {customerType === "app" && creditHere && (
            <Chips
              value={payment}
              label={s.payment}
              onChange={setPayment}
              options={[
                { id: "wallet", label: s.payments.wallet },
                { id: "cash", label: s.payments.cash },
              ]}
            />
          )}
          {features.lite && !creditHere && <p className="text-sm text-gp-muted">{s.liteCashOnly}</p>}
          <p className={priceMissing ? "text-sm font-medium text-red-600" : "text-sm text-gp-muted"}>{counter.priceXof ? format(s.price, { price: formatXof(counter.priceXof, locale) }) : s.noPrice}</p>
          {wallet && <ScanField label={s.creditCode} hint={s.creditCodeHint} value={creditCode} onChange={setCreditCode} required />}
          {takesCash && customerType === "first_purchase" && (
            <label className="block space-y-1">
              <span className="text-sm font-medium">{s.purchaseAmount}</span>
              <Input inputMode="numeric" required value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
            </label>
          )}
        </fieldset>
      )}

      {error && (
        <p role="alert" className="animate-gp-shake text-sm text-red-600">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={!row || row.full <= 0 || priceMissing}>
        {s.confirm}
      </Button>

      <ConfirmSheet open={confirming} title={s.confirmTitle} confirmLabel={s.confirm} busy={busy} onConfirm={() => void record()} onCancel={() => setConfirming(false)}>
        <p>{format(takesBatteryIn(customerType) ? s.confirmText : s.confirmFirst, { type: typeLabel })}</p>
        <p className="font-semibold">
          {s.customerTypes[customerType]} · {customerType === "fleet" ? s.payments.fleet : wallet ? s.payments.wallet : s.payments.cash}
        </p>
      </ConfirmSheet>
    </form>
  );
}

function SwapView({ station }: { station: StationView }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const params = useSearchParams();
  const reservationId = params.get("reservation");
  // Kept once the swap completed the reservation, while the list reloads without it.
  const [finished, setFinished] = useState(false);
  const { data, error, reload } = useLiveQuery(
    () => Promise.all([backend.stationCounter(station.id), reservationId ? backend.stationReservations(station.id) : Promise.resolve([])]),
    `${station.id}:${reservationId ?? ""}`,
  );
  if (finished) {
    return (
      <Card className="flex flex-col items-center gap-3 p-6 text-center">
        <SuccessCheck />
        <p className="font-semibold">{t.work.reservations.done}</p>
        <Button size="lg" href="/operator/reservations">
          {t.work.reservations.back}
        </Button>
      </Card>
    );
  }
  if (!data) return error ? <LoadFailed error={error} onRetry={reload} /> : <SkeletonCard />;
  const [counter, reservations] = data;
  const reservation = reservationId ? reservations.find((r) => r.id === reservationId && reservationKind(r) === "swap") : undefined;
  if (reservationId && (!reservation || !isHolding(reservation))) {
    return <EmptyState text={t.work.reservations.gone} action={<Button href="/operator/reservations">{t.work.reservations.back}</Button>} />;
  }
  return (
    <>
      <SwapForm
        key={reservation?.id ?? "walk-in"}
        station={station}
        counter={counter}
        reservation={reservation}
        onReservationDone={() => setFinished(true)}
        initialCode={reservation ? (params.get("code") ?? "") : ""}
        initialContact={reservation ? "" : (params.get("client") ?? "")}
      />
      <Button variant="ghost" href="/operator/journal">
        {t.work.swap.log}
      </Button>
      {/* Swaps record the customer's greenpoints themselves; reward codes are confirmed here. */}
      <GreenpointStaff station={station} />
    </>
  );
}

/** /operator/echange: one swap, step by step: battery type, customer, batteries in and out, payment, confirm. */
export function SwapPage() {
  const { t } = useI18n();
  return (
    <WorkShell title={t.work.swap.title} services={["swap"]}>
      {({ station }) => <SwapView key={station.id} station={station} />}
    </WorkShell>
  );
}
