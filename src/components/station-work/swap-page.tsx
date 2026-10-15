"use client";

import { useState, type FormEvent } from "react";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format, formatXof } from "@/lib/i18n/format";
import { newRequestId, SWAP_CUSTOMER_TYPES, takesBatteryIn, type StationCounter, type SwapCustomerType, type SwapInput } from "@/lib/station-work";
import type { StationView } from "@/lib/types";
import { useApp } from "../app-provider";
import { ConfirmSheet } from "../confirm-sheet";
import { GreenpointStaff } from "../greenpoint/greenpoint-staff";
import { QrIcon } from "../icons";
import { useI18n } from "../i18n-provider";
import { LoadFailed } from "../load-state";
import { canScanQr, QrScanner } from "../parcels/qr-scanner";
import { Button, Card, Input, SkeletonCard, SuccessCheck, useToast } from "../ui";
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
function ScanField({ label, hint, value, onChange, required, inputMode }: { label: string; hint?: string; value: string; onChange: (v: string) => void; required?: boolean; inputMode?: "tel" | "text" }) {
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

function SwapForm({ station, counter }: { station: StationView; counter: StationCounter }) {
  const { t, locale } = useI18n();
  const { backend, features } = useApp();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const s = t.work.swap;
  const rows = counter.rows;
  const [typeId, setTypeId] = useState(rows.length === 1 ? rows[0].batteryTypeId : "");
  const [customerType, setCustomerType] = useState<SwapCustomerType>("cash");
  const [contact, setContact] = useState("");
  const [driverCode, setDriverCode] = useState("");
  const [payment, setPayment] = useState<"wallet" | "cash">(features.lite ? "cash" : "wallet");
  const [pin, setPin] = useState("");
  const [amount, setAmount] = useState(counter.priceXof ? String(counter.priceXof) : "");
  const [batteryIn, setBatteryIn] = useState("");
  const [batteryOut, setBatteryOut] = useState("");
  // One id per swap being entered: confirming twice records it once.
  const [requestId, setRequestId] = useState(newRequestId);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const row = rows.find((r) => r.batteryTypeId === typeId);
  const typeLabel = row?.label ?? s.noType;
  const wallet = customerType === "app" && payment === "wallet" && !features.lite;
  const takesCash = customerType === "cash" || customerType === "first_purchase" || (customerType === "app" && !wallet);

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
      contact: customerType === "app" || customerType === "first_purchase" ? contact || null : null,
      driverCode: customerType === "fleet" ? driverCode : null,
      payment: customerType === "app" ? (wallet ? "wallet" : "cash") : undefined,
      pin: wallet ? pin : null,
      amountXof: takesCash && amount !== "" ? Number(amount) : null,
    };
    setBusy(true);
    try {
      await backend.recordSwap(station.id, input);
      toast(t.work.saved);
      setDone(true);
      setRequestId(newRequestId());
      setContact("");
      setDriverCode("");
      setPin("");
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
      {rows.length > 1 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{s.type}</legend>
          <Chips
            value={typeId}
            label={s.type}
            onChange={setTypeId}
            options={rows.map((r) => ({ id: r.batteryTypeId, label: `${r.label ?? ""} · ${format(s.full, { n: r.full })}`, disabled: r.full <= 0 }))}
          />
        </fieldset>
      )}
      {rows.length === 1 && <p className="text-sm text-gp-muted">{format(s.full, { n: rows[0].full })}</p>}

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{s.customer}</legend>
        <Chips
          value={customerType}
          label={s.customer}
          onChange={setCustomerType}
          options={SWAP_CUSTOMER_TYPES.map((id) => ({ id, label: s.customerTypes[id], disabled: id === "fleet" && features.lite }))}
        />
      </fieldset>

      {customerType === "app" && <ScanField label={s.contact} hint={s.contactHint} value={contact} onChange={setContact} required inputMode="tel" />}
      {customerType === "first_purchase" && <ScanField label={s.contactOptional} value={contact} onChange={setContact} inputMode="tel" />}
      {customerType === "fleet" && <ScanField label={s.driverCode} hint={s.fleetHint} value={driverCode} onChange={setDriverCode} required />}

      {takesBatteryIn(customerType) && <ScanField label={s.batteryIn} hint={s.batteryHint} value={batteryIn} onChange={setBatteryIn} />}
      <ScanField label={s.batteryOut} hint={s.batteryHint} value={batteryOut} onChange={setBatteryOut} />

      {customerType !== "fleet" && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{s.payment}</legend>
          {customerType === "app" && !features.lite && (
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
          {features.lite && <p className="text-sm text-gp-muted">{s.liteCashOnly}</p>}
          <p className="text-sm text-gp-muted">{counter.priceXof ? format(s.price, { price: formatXof(counter.priceXof, locale) }) : s.noPrice}</p>
          {wallet && (
            <label className="block space-y-1">
              <span className="text-sm font-medium">{s.pin}</span>
              <Input type="password" inputMode="numeric" autoComplete="off" maxLength={6} required value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
              <span className="block text-xs text-gp-muted">{s.pinHint}</span>
            </label>
          )}
          {takesCash && (
            <label className="block space-y-1">
              <span className="text-sm font-medium">{s.amount}</span>
              <Input inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
            </label>
          )}
        </fieldset>
      )}

      {error && (
        <p role="alert" className="animate-gp-shake text-sm text-red-600">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" className="w-full" disabled={!row || row.full <= 0}>
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
  const { data, error, reload } = useLiveQuery(() => backend.stationCounter(station.id), station.id);
  if (!data) return error ? <LoadFailed error={error} onRetry={reload} /> : <SkeletonCard />;
  return (
    <>
      <SwapForm station={station} counter={data} />
      <Button variant="ghost" href="/operator/journal">
        {t.work.swap.log}
      </Button>
      {/* Swaps record the customer's greenpoints themselves; reward codes are confirmed here. */}
      <GreenpointStaff station={station} only={[]} />
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
