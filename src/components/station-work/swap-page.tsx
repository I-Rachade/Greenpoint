"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { isHolding } from "@shared/availability";
import { batteryNumbersRequired, type BatteryLookup } from "@shared/batteries";
import { BATTERY_CONDITIONS, energySwapAmount, MM_NETWORKS, ussdCode, type BatteryCondition, type MmNetwork } from "@shared/energy-swap";
import { reservationKind } from "@shared/reservations";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format, formatXof } from "@/lib/i18n/format";
import { newRequestId, SWAP_CUSTOMER_TYPES, takesBatteryIn, type StationCounter, type SwapCustomerType, type SwapInput } from "@shared/station-work";
import type { Reservation, StationView } from "@shared/types";
import { useApp } from "../app-provider";
import { ConfirmSheet } from "../confirm-sheet";
import { GreenpointStaff } from "../greenpoint/greenpoint-staff";
import { CheckIcon, QrIcon, WalletIcon } from "../icons";
import { useI18n } from "../i18n-provider";
import { LoadFailed } from "../load-state";
import { canScanQr, QrScanner } from "../parcels/qr-scanner";
import { BatteryBleRead } from "../ble/battery-ble-read";
import { useReservationWhat } from "../reservation-list";
import { Button, Card, EmptyState, Input, SkeletonCard, SuccessCheck, useReducedMotion, useToast } from "../ui";
import { WorkShell } from "./work-shell";
import { useOffline, useQueuedSwaps } from "@/lib/offline/hooks";
import { isNetworkError } from "@/lib/offline/storage";
import { enqueueSwap, QueueFullError } from "@/lib/offline/swap-queue";
import { personLabel } from "@shared/wallet";

export function Chips<T extends string>({ value, options, label, onChange }: { value: T; options: { id: T; label: string; disabled?: boolean }[]; label: string; onChange: (v: T) => void }) {
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
          className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold disabled:border-transparent disabled:bg-transparent disabled:text-gp-muted disabled:line-through disabled:opacity-70 ${
            value === o.id ? "border-gp-forest bg-gp-forest text-white dark:border-gp-green dark:bg-gp-green dark:text-gp-forest" : "border-gp-border bg-gp-surface"
          }`}
        >
          {value === o.id && <CheckIcon size={16} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A text field with a "scan" button when the phone can read QR codes (and barcodes, for battery numbers). */
export function ScanField({
  label,
  hint,
  value,
  onChange,
  required,
  inputMode,
  note,
  barcodes,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  inputMode?: "tel" | "text";
  /** Shown under the hint, e.g. whether the battery is known. */
  note?: ReactNode;
  /** A battery number: it can be a barcode as well as a QR code. */
  barcodes?: boolean;
}) {
  const [scanning, setScanning] = useState(false);
  // The camera sits outside the <label>: a tap on it must not focus the field and open the keyboard.
  return (
    <div className="space-y-1">
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
      </label>
      {note}
      {scanning && (
        <QrScanner
          barcodes={barcodes}
          onResult={(text) => {
            onChange(text);
            setScanning(false);
          }}
          onClose={() => setScanning(false)}
        />
      )}
    </div>
  );
}

/** A battery's charge in %, 0…100, as read on the battery. */
function PctField({ label, hint, value, onChange }: { label: string; hint: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      <span className="flex w-32 items-center gap-2">
        <Input
          inputMode="numeric"
          required
          value={value}
          maxLength={3}
          autoComplete="off"
          className="text-center tabular-nums"
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, "");
            onChange(v === "" ? "" : String(Math.min(Number(v), 100)));
          }}
        />
        <span className="font-semibold">%</span>
      </span>
      <span className="block text-xs text-gp-muted">{hint}</span>
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
 * One battery of the guided swap (mockup B3): dashed while it waits for its number, green once
 * scanned (number and charge). The camera reads QR codes and barcodes; the number can be typed too.
 */
function BatteryCard({
  label,
  serial,
  onSerial,
  pct,
  required,
  hint,
  children,
}: {
  label: string;
  serial: string;
  onSerial: (v: string) => void;
  /** The charge typed or read, for a type priced by energy; "" = none. */
  pct: string;
  required: boolean;
  hint: string;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const g = t.work.swap.guided;
  const camera = canScanQr();
  const [scanning, setScanning] = useState(false);
  const [typing, setTyping] = useState(false);
  const filled = serial.trim() !== "";
  const showInput = !camera || typing;
  return (
    <div
      className={`space-y-3 rounded-2xl p-3 transition-colors duration-240 ${
        filled ? "border border-gp-green/50 bg-gp-green/10" : "border-2 border-dashed border-gp-border bg-gp-surface dark:border-white/15"
      }`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${filled ? "bg-gp-green text-gp-forest" : "bg-gp-border/50 text-gp-forest dark:bg-white/10 dark:text-zinc-200"}`}
          aria-hidden
        >
          {filled ? <CheckIcon size={24} strokeWidth={2.4} /> : <QrIcon size={22} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-xs text-gp-muted">{label}</div>
          <div className={`font-semibold ${filled ? "truncate" : "leading-snug"}`}>
            {filled ? `${serial.trim().toUpperCase()}${pct !== "" ? ` · ${pct} %` : ""}` : g.scanPrompt}
          </div>
        </div>
        {camera && (
          <button type="button" onClick={() => setScanning(true)} className="min-h-11 shrink-0 px-1 text-sm font-semibold text-gp-green-dark dark:text-gp-green">
            {filled ? g.edit : g.scan}
          </button>
        )}
      </div>
      {showInput ? (
        <label className="block space-y-1">
          <span className="sr-only">{label}</span>
          <Input value={serial} required={required} autoComplete="off" placeholder={g.typeIt} onChange={(e) => onSerial(e.target.value)} />
          <span className="block text-xs text-gp-muted">{hint}</span>
        </label>
      ) : (
        <button type="button" onClick={() => setTyping(true)} className="text-xs font-medium text-gp-muted underline">
          {g.typeIt}
        </button>
      )}
      {children}
      {scanning && (
        <QrScanner
          barcodes
          onResult={(text) => {
            onSerial(text);
            setScanning(false);
          }}
          onClose={() => setScanning(false)}
        />
      )}
    </div>
  );
}

type SwapStep = "customer" | "batteries" | "pay";

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
  const { backend, features, profile } = useApp();
  const offline = useOffline();
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
  // Green Credit only at a station an admin designated (0047), and never without network:
  // its one-time code is checked by the server only.
  const creditHere = !!station.greenCredit && !offline;
  const [payment, setPayment] = useState<"wallet" | "cash">(creditHere ? "wallet" : "cash");
  const [creditCode, setCreditCode] = useState("");
  const [amount, setAmount] = useState("");
  const [batteryIn, setBatteryIn] = useState("");
  const [batteryOut, setBatteryOut] = useState("");
  // A type priced by energy (Omnivoltaic procedure, shared/energy-swap.ts).
  const [inPct, setInPct] = useState("");
  const [outPct, setOutPct] = useState("");
  const [plate, setPlate] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [condition, setCondition] = useState<BatteryCondition | "">("");
  const [outChecked, setOutChecked] = useState(false);
  const [network, setNetwork] = useState<MmNetwork | "">("");
  const [mmRef, setMmRef] = useState("");
  // One id per swap being entered: confirming twice records it once.
  const [requestId, setRequestId] = useState(newRequestId);
  const [confirming, setConfirming] = useState(false);
  // The form in steps: customer, battery brought back, battery given, payment.
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const reduced = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<false | "sent" | "kept">(false);
  const [error, setError] = useState<string | null>(null);

  const row = rows.find((r) => r.batteryTypeId === typeId);
  const energy = row?.energy ?? null;
  const networks = energy ? MM_NETWORKS.filter((n) => energy.ussd[n]) : [];
  const chosenNetwork = network && networks.includes(network) ? network : networks.length === 1 ? networks[0] : "";
  const pct = (v: string) => (v === "" ? null : Number(v));
  const priced = energy ? energySwapAmount(pct(inPct), pct(outPct), energy.priceFullXof) : null;
  const pctTyped = inPct !== "" && outPct !== "";
  // At a type priced by energy only app and walk-in customers (no fleet, no first purchase).
  const customerTypes = energy ? SWAP_CUSTOMER_TYPES.filter((id) => id === "app" || id === "cash") : SWAP_CUSTOMER_TYPES;
  function chooseType(id: string) {
    setTypeId(id);
    if (rows.find((r) => r.batteryTypeId === id)?.energy && customerType !== "app" && customerType !== "cash") setCustomerType("cash");
  }
  // Battery register: a station with battery types records every battery it swaps.
  const numbersRequired = batteryNumbersRequired(rows.some((r) => r.batteryTypeId !== ""));
  const typeLabel = row?.label ?? s.noType;
  const wallet = !energy && customerType === "app" && payment === "wallet" && creditHere;
  const takesCash = customerType === "cash" || customerType === "first_purchase" || (customerType === "app" && !wallet);
  // The swap price is set in the backoffice (station details); without it only a first purchase or a fleet swap goes through.
  const priceMissing = !energy && !counter.priceXof && customerType !== "first_purchase" && customerType !== "fleet";

  // Customer, then both batteries on one screen (a first purchase brings none back), then payment.
  const steps: SwapStep[] = ["customer", "batteries", "pay"];
  const takesIn = takesBatteryIn(customerType);
  const at = Math.min(step, steps.length - 1);
  const current = steps[at];
  const last = at === steps.length - 1;
  const stepNames: Record<SwapStep, string> = { customer: s.steps.customer, batteries: s.steps.batteries, pay: s.steps.pay };

  /** What the batteries step still waits for, shown under the button (which stays off until then). */
  const g = s.guided;
  const batteriesMissing: string | null =
    takesIn && numbersRequired && !batteryIn.trim()
      ? g.needIn
      : takesIn && energy && (inPct === "" || !condition)
        ? inPct === "" ? g.needPct : g.needCondition
        : numbersRequired && !batteryOut.trim()
          ? g.needOut
          : energy && (!priced || (takesIn && inPct === ""))
            ? g.needPct
            : energy && !outChecked
              ? g.needChecked
              : null;
  const waiting = current === "batteries" ? batteriesMissing : null;

  function go(to: number) {
    setError(null);
    setDirection(to > at ? 1 : -1);
    setStep(to);
    window.scrollTo?.({ top: 0 });
  }

  /** What stops the current step before going on (the browser checks the required fields). */
  function stepProblem(): string | null {
    if (current === "customer" && !row) return t.errors.battery_type_required;
    if (current === "batteries" && energy && takesIn && !condition) return s.energy.conditionRequired;
    if (current === "batteries" && energy && !priced) return s.energy.checkPct;
    if (current === "batteries" && batteriesMissing) return batteriesMissing;
    return null;
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const problem = stepProblem();
    if (problem) return setError(problem);
    if (!last) return go(at + 1);
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
      ...(energy
        ? {
            payment: undefined,
            creditCode: null,
            inPct: pct(inPct),
            outPct: pct(outPct),
            plate,
            customerName: customerType === "cash" ? customerName || null : null,
            batteryInCondition: condition || null,
            batteryOutChecked: outChecked,
            mmNetwork: chosenNetwork || null,
            mmRef,
          }
        : {}),
    };
    setBusy(true);
    try {
      let kept = false;
      try {
        await backend.recordSwap(station.id, input);
      } catch (err) {
        // No network: a walk-in, cash or fleet swap is kept on the phone and sent later at its real
        // time (src/lib/offline/swap-queue.ts); Green Credit and reservations need the server.
        if (!isNetworkError(err) || reservation || wallet || !profile || backend.mode !== "cloudflare") throw err;
        enqueueSwap({
          stationId: station.id,
          stationName: station.name,
          userId: profile.id,
          person: personLabel(profile),
          input: { ...input, offlineAt: new Date().toISOString() },
        });
        kept = true;
      }
      toast(kept ? t.offline.savedOffline : t.work.saved);
      if (reservation) return onReservationDone?.();
      setDone(kept ? "kept" : "sent");
      setStep(0);
      setRequestId(newRequestId());
      setContact("");
      setDriverCode("");
      setCreditCode("");
      setBatteryIn("");
      setBatteryOut("");
      setInPct("");
      setOutPct("");
      setPlate("");
      setCustomerName("");
      setCondition("");
      setOutChecked(false);
      setMmRef("");
    } catch (err) {
      setError(err instanceof QueueFullError ? t.offline.queueFull : errorMessage(err));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (done) {
    return (
      <Card className="flex flex-col items-center gap-3 p-6 text-center">
        <SuccessCheck />
        <p className="font-semibold">{done === "kept" ? t.offline.savedOffline : t.work.saved}</p>
        {done === "kept" && <p className="text-sm text-gp-muted">{t.offline.savedOfflineHint}</p>}
        <Button size="lg" onClick={() => setDone(false)}>
          {s.title}
        </Button>
        <Button variant="ghost" href="/operator/journal">
          {s.log}
        </Button>
      </Card>
    );
  }

  // The new step slides in from the side it comes from; with reduced motion it simply appears.
  const slide = reduced
    ? ""
    : `transition-[translate,opacity] duration-240 ease-gp-out starting:opacity-0 ${direction > 0 ? "starting:translate-x-6" : "starting:-translate-x-6"}`;

  return (
    <form onSubmit={submit} className="space-y-5">
      <ol className="flex rounded-2xl border border-gp-border bg-gp-surface px-2 py-3 dark:border-white/10" aria-label={s.steps.label}>
        {steps.map((name, i) => {
          const isDone = i < at;
          return (
            <li key={name} aria-current={i === at ? "step" : undefined} className="flex min-w-0 flex-1 justify-center">
              <button
                type="button"
                disabled={!isDone}
                onClick={() => go(i)}
                className="flex min-w-0 flex-col items-center gap-1 disabled:cursor-default"
              >
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold transition-colors duration-240 ${
                    isDone ? "bg-gp-green text-gp-forest" : i === at ? "bg-gp-forest text-white dark:bg-gp-green dark:text-gp-forest" : "bg-gp-border/70 text-gp-muted dark:bg-white/10"
                  }`}
                  aria-hidden
                >
                  {isDone ? <CheckIcon size={16} strokeWidth={2.6} /> : i + 1}
                </span>
                <span className={`truncate text-xs ${i === at ? "font-semibold" : isDone ? "font-medium" : "text-gp-muted"}`}>{stepNames[name]}</span>
              </button>
            </li>
          );
        })}
      </ol>
      {at > 0 && row && (
        <p className="text-sm text-gp-muted">
          {[typeLabel, energy && customerType === "cash" ? s.energy.walkIn : s.customerTypes[customerType], energy ? plate.trim().toUpperCase() : ""]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      <div key={current} className={`space-y-5 ${slide}`}>
      {current === "customer" && (
      <>
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
            onChange={chooseType}
            options={rows.map((r) => {
              const held = heldOf(r.batteryTypeId);
              return {
                id: r.batteryTypeId,
                label: `${r.label ?? ""} · ${format(s.full, { n: r.full })}${held ? ` · ${format(s.held, { n: held })}` : ""}`,
                // From a reservation only its type; without one, only what no reservation holds.
                // Offline the counter may be old: the swap goes through and the server marks it to check.
                disabled: offline ? false : r.full <= 0 || (reservation?.target ? r.batteryTypeId !== reservation.target : !reservation && r.full - held <= 0),
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
            options={customerTypes.map((id) => ({ id, label: energy && id === "cash" ? s.energy.walkIn : s.customerTypes[id], disabled: id === "fleet" && features.lite }))}
          />
        </fieldset>
      )}
      {energy && (
        <>
          <label className="block space-y-1">
            <span className="text-sm font-medium">{s.energy.plate}</span>
            <Input required value={plate} maxLength={20} autoComplete="off" className="uppercase" onChange={(e) => setPlate(e.target.value)} />
          </label>
          {customerType === "cash" && !reservation && (
            <label className="block space-y-1">
              <span className="text-sm font-medium">{s.energy.customerName}</span>
              <Input value={customerName} maxLength={80} onChange={(e) => setCustomerName(e.target.value)} />
            </label>
          )}
        </>
      )}

      {customerType === "app" && !reservation && !wallet && <ScanField label={s.contact} hint={s.contactHint} value={contact} onChange={setContact} required inputMode="tel" />}
      {customerType === "first_purchase" && <ScanField label={s.contactOptional} value={contact} onChange={setContact} inputMode="tel" />}
      {customerType === "fleet" && <ScanField label={s.driverCode} hint={s.fleetHint} value={driverCode} onChange={setDriverCode} required />}
      </>
      )}

      {current === "batteries" && (
      <>
        {takesIn && (
          <BatteryCard
            label={g.cardIn}
            serial={batteryIn}
            onSerial={setBatteryIn}
            pct={energy ? inPct : ""}
            required={numbersRequired}
            hint={numbersRequired ? s.batteryHintRequired : s.batteryHint}
          >
            <BatteryNote stationId={station.id} serial={batteryIn} typeId={typeId} />
            <BatteryBleRead
              serial={batteryIn}
              onRead={(r) => {
                if (r.serial) setBatteryIn(r.serial);
                if (energy && r.socPct !== null) setInPct(String(r.socPct));
              }}
            />
            {energy && (
              <>
                <PctField label={s.energy.inPct} hint={s.energy.pctHint} value={inPct} onChange={setInPct} />
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">{s.energy.condition}</legend>
                  <Chips value={condition} label={s.energy.condition} onChange={setCondition} options={BATTERY_CONDITIONS.map((id) => ({ id, label: s.energy.conditions[id] }))} />
                  {condition && condition !== "ok" && <p className="text-sm font-medium text-amber-700 dark:text-amber-300">{s.energy.conditionRepair}</p>}
                </fieldset>
              </>
            )}
          </BatteryCard>
        )}
        <BatteryCard
          label={g.cardOut}
          serial={batteryOut}
          onSerial={setBatteryOut}
          pct={energy ? outPct : ""}
          required={numbersRequired}
          hint={numbersRequired ? s.batteryHintRequired : s.batteryHint}
        >
          <BatteryNote stationId={station.id} serial={batteryOut} typeId={typeId} />
          <BatteryBleRead
            serial={batteryOut}
            onRead={(r) => {
              if (r.serial) setBatteryOut(r.serial);
              if (energy && r.socPct !== null) setOutPct(String(r.socPct));
            }}
          />
          {energy && (
            <>
              <PctField label={s.energy.outPct} hint={s.energy.pctHint} value={outPct} onChange={setOutPct} />
              {!priced && pctTyped && (
                <p role="alert" className="text-sm font-medium text-red-600">
                  {s.energy.checkPct}
                </p>
              )}
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" className="mt-1 size-5 accent-gp-green-dark" required checked={outChecked} onChange={(e) => setOutChecked(e.target.checked)} />
                <span>{s.energy.outChecked}</span>
              </label>
            </>
          )}
        </BatteryCard>

        {customerType !== "fleet" && (
          <div className="flex items-center gap-3 rounded-2xl border border-gp-border bg-gp-surface p-4 dark:border-white/10">
            <WalletIcon size={22} className="shrink-0 text-gp-green-dark dark:text-gp-green" />
            <div className="min-w-0 flex-1">
              <div className="text-sm text-gp-muted">{g.planned}</div>
              <div className="font-semibold">
                {energy ? (chosenNetwork === "flooz" ? "Flooz" : chosenNetwork === "tmoney" ? "T-Money" : s.energy.pay) : wallet ? s.payments.wallet : s.payments.cash}
              </div>
            </div>
            <div className="shrink-0 font-heading text-lg font-bold tabular-nums">
              {energy
                ? priced
                  ? formatXof(priced.amountXof, locale)
                  : "–"
                : customerType === "first_purchase"
                  ? amount !== "" ? formatXof(Number(amount), locale) : "–"
                  : counter.priceXof
                    ? formatXof(counter.priceXof, locale)
                    : "–"}
            </div>
          </div>
        )}
        {customerType === "fleet" && <p className="text-sm text-gp-muted">{s.payments.fleet}</p>}
      </>
      )}
      {current === "pay" && energy && (
        <>
          <fieldset className="space-y-3 rounded-2xl border border-gp-border bg-gp-surface p-4">
            <legend className="px-1 text-sm font-medium">{s.energy.pay}</legend>
            <p className="text-sm text-gp-muted">{format(s.energy.priceFull, { type: typeLabel, price: formatXof(energy.priceFullXof, locale) })}</p>
            {priced ? (
              <p className="text-lg font-semibold tabular-nums">
                {format(s.energy.supplied, { pct: priced.suppliedPct, price: formatXof(energy.priceFullXof, locale), amount: formatXof(priced.amountXof, locale) })}
              </p>
            ) : (
              pctTyped && (
                <p role="alert" className="text-sm font-medium text-red-600">
                  {s.energy.checkPct}
                </p>
              )
            )}
            {networks.length > 1 && (
              <Chips value={chosenNetwork} label={s.payment} onChange={setNetwork} options={networks.map((n) => ({ id: n, label: n === "tmoney" ? "T-Money" : "Flooz" }))} />
            )}
            {priced && chosenNetwork && energy.ussd[chosenNetwork] && (
              <div className="space-y-1">
                <p className="text-sm">{s.energy.dial}</p>
                <a
                  href={`tel:${encodeURIComponent(ussdCode(energy.ussd[chosenNetwork]!, priced.amountXof))}`}
                  className="block break-all rounded-xl bg-gp-green-dark/10 px-3 py-2 text-center font-mono text-lg font-semibold tracking-wide text-gp-green-dark dark:text-gp-green"
                >
                  {ussdCode(energy.ussd[chosenNetwork]!, priced.amountXof)}
                </a>
              </div>
            )}
            <label className="block space-y-1">
              <span className="text-sm font-medium">{s.energy.mmRef}</span>
              <Input required value={mmRef} maxLength={40} autoComplete="off" className="font-mono uppercase" onChange={(e) => setMmRef(e.target.value)} />
              <span className="block text-xs text-gp-muted">{s.energy.mmRefHint}</span>
            </label>
          </fieldset>
        </>
      )}

      {current === "pay" && customerType === "fleet" && <p className="text-sm text-gp-muted">{s.payments.fleet}</p>}
      {current === "pay" && customerType !== "fleet" && !energy && (
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
      </div>

      {error && (
        <p role="alert" className="animate-gp-shake text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        {at > 0 && (
          <Button variant="secondary" size="lg" onClick={() => go(at - 1)}>
            {s.steps.back}
          </Button>
        )}
        <Button
          type="submit"
          size="lg"
          className="flex-1"
          disabled={!row || (!offline && row.full <= 0) || priceMissing || !!waiting || (last && !!energy && (!priced || !chosenNetwork || (takesIn && !condition)))}
        >
          {last ? (
            <>
              <CheckIcon size={18} />
              {s.confirm}
            </>
          ) : (
            s.steps.next
          )}
        </Button>
      </div>
      {waiting && <p className="-mt-2 text-center text-sm text-gp-muted">{waiting}</p>}

      <ConfirmSheet open={confirming} title={s.confirmTitle} confirmLabel={s.confirm} busy={busy} onConfirm={() => void record()} onCancel={() => setConfirming(false)}>
        <p>{format(takesBatteryIn(customerType) ? s.confirmText : s.confirmFirst, { type: typeLabel })}</p>
        {energy && priced ? (
          <>
            <p className="font-semibold">
              {format(s.energy.confirmEnergy, {
                supplied: priced.suppliedPct,
                amount: formatXof(priced.amountXof, locale),
                network: chosenNetwork === "flooz" ? "Flooz" : "T-Money",
                ref: mmRef.replace(/\s+/g, "").toUpperCase(),
              })}
            </p>
            <p className="text-sm">{s.energy.safety}</p>
          </>
        ) : (
          <p className="font-semibold">
            {s.customerTypes[customerType]} · {customerType === "fleet" ? s.payments.fleet : wallet ? s.payments.wallet : s.payments.cash}
          </p>
        )}
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
  const queue = useQueuedSwaps();
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
  const [kept, reservations] = data;
  // Swaps waiting on the phone already took their full battery: the counter shows it.
  const waiting = queue.filter((q) => q.stationId === station.id && q.status === "pending");
  const counter = waiting.length
    ? {
        ...kept,
        rows: kept.rows.map((r) => {
          const n = waiting.filter((q) => (q.input.batteryTypeId ?? "") === r.batteryTypeId || (kept.rows.length === 1 && !q.input.batteryTypeId)).length;
          return { ...r, full: Math.max(r.full - n, 0) };
        }),
      }
    : kept;
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
