"use client";

import { useState, type FormEvent } from "react";
import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import { hoursOf, OpeningHoursInput, openingHoursLine } from "@/components/opening-hours-input";
import { Badge, Button, Input, useToast, type BadgeTone } from "@/components/ui";
import { useErrorMessage } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { validPrice, type StationPrices } from "@/lib/operators";
import { canRequest, serviceDisplay, type ServiceDisplay, type StationServiceInfo } from "@/lib/station-services";
import type { StationView } from "@/lib/types";
import { Section } from "./shared";

export const SERVICE_TONE: Record<ServiceDisplay, BadgeTone> = {
  active: "green",
  globalOff: "amber",
  pending: "blue",
  rejected: "red",
  locked: "neutral",
};

/** Per station: which services are unlocked (the owner asks, the admin decides), hours, phone and prices. */
export function StationsView({
  stations,
  prices,
  services,
  onChanged,
}: {
  stations: StationView[];
  prices: StationPrices[];
  services: StationServiceInfo[];
  onChanged: () => void;
}) {
  return (
    <div className="space-y-4">
      {stations.map((s) => (
        <Section key={s.id} title={s.name} aside={<span className="text-sm text-gp-muted">{s.address}</span>}>
          {services.some((x) => x.stationId === s.id) && <Services station={s} services={services.filter((x) => x.stationId === s.id)} onChanged={onChanged} />}
          <Details key={`${s.id}:${s.openingHours}`} station={s} prices={prices.find((p) => p.stationId === s.id)} onChanged={onChanged} />
        </Section>
      ))}
    </div>
  );
}

function Services({ station, services, onChanged }: { station: StationView; services: StationServiceInfo[]; onChanged: () => void }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  async function ask(info: StationServiceInfo) {
    setBusy(info.service);
    try {
      await backend.requestStationService(station.id, info.service);
      toast(format(t.services.requested, { service: t.services.names[info.service], station: station.name }), { tone: "success" });
      onChanged();
    } catch (err) {
      toast(errorMessage(err), { tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">{t.services.title}</h3>
      <p className="text-xs text-gp-muted">{t.services.ownerIntro}</p>
      <ul className="divide-y divide-black/5 text-sm dark:divide-white/10">
        {services.map((info) => {
          const display = serviceDisplay(info);
          return (
            <li key={info.service} className="flex min-h-11 flex-wrap items-center gap-2 py-1.5">
              <span className="flex-1">{t.services.names[info.service]}</span>
              <Badge tone={SERVICE_TONE[display]}>{t.services.status[display]}</Badge>
              {canRequest(info) && (
                <Button variant="secondary" busy={busy === info.service} disabled={busy !== null} onClick={() => ask(info)}>
                  {t.services.request}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const priceText = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n));

function Details({ station, prices, onChanged }: { station: StationView; prices: StationPrices | undefined; onChanged: () => void }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const toast = useToast();
  const o = t.owner;
  const [hours, setHours] = useState(() => hoursOf(station.openingHours));
  const [phone, setPhone] = useState(station.phone ?? "");
  const [swap, setSwap] = useState(priceText(prices?.swapXof));
  const [kwh, setKwh] = useState(priceText(prices?.chargeKwhXof));
  const [minute, setMinute] = useState(priceText(prices?.chargeMinXof));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const read = (text: string) => (text.trim() === "" ? null : Number(text));

  async function save(e: FormEvent) {
    e.preventDefault();
    const values = { swapXof: read(swap), chargeKwhXof: read(kwh), chargeMinXof: read(minute) };
    if (!hours.days.length) return setProblem(t.errors.opening_hours_invalid);
    // Multiples of 5 FCFA, never 0 for a swap or per kWh (as the server checks).
    if (!Object.values(values).every(validPrice) || values.swapXof === 0 || values.chargeKwhXof === 0) return setProblem(o.prices.invalid);
    setProblem(null);
    setBusy(true);
    try {
      await backend.ownerSaveStation(station.id, { openingHours: openingHoursLine(hours), phone: phone.trim() || null, ...values });
      toast(o.saved, { tone: "success" });
      onChanged();
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const price = (id: string, label: string, value: string, set: (v: string) => void) => (
    <label htmlFor={id} className="space-y-1 text-sm">
      <span className="block">{label}</span>
      <Input id={id} type="number" inputMode="numeric" min={0} step={5} value={value} onChange={(e) => set(e.target.value)} className="sm:w-40" />
    </label>
  );

  return (
    <form onSubmit={save} className="space-y-3 border-t border-gp-border pt-3">
      <h3 className="text-sm font-medium">{o.details}</h3>
      <OpeningHoursInput value={hours} onChange={setHours} disabled={busy} />
      <label htmlFor={`phone-${station.id}`} className="block space-y-1 text-sm">
        <span>{o.phone}</span>
        <Input id={`phone-${station.id}`} type="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">{o.prices.title}</legend>
        <div className="flex flex-wrap gap-3">
          {price(`swap-${station.id}`, o.prices.swap, swap, setSwap)}
          {price(`kwh-${station.id}`, o.prices.kwh, kwh, setKwh)}
          {price(`min-${station.id}`, o.prices.minute, minute, setMinute)}
        </div>
        <p className="text-xs text-gp-muted">{o.prices.hint}</p>
      </fieldset>
      {problem && (
        <p role="alert" className="text-sm text-red-600">
          {problem}
        </p>
      )}
      <Button type="submit" busy={busy}>
        {o.save}
      </Button>
    </form>
  );
}
