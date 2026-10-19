"use client";

import Link from "next/link";
import { useState } from "react";
import { customerCode } from "@/lib/charging";
import { format } from "@/lib/i18n/format";
import { useLiveQuery } from "@/lib/hooks";
import { isStationStaff } from "@/lib/operators";
import { pickupQrPayload } from "@/lib/parcels";
import { reservationQrPayload } from "@/lib/reservations";
import { useApp } from "./app-provider";
import { BoxIcon, QrIcon, TicketIcon, UserIcon, WalletIcon } from "./icons";
import { useI18n } from "./i18n-provider";
import { QrImage } from "./parcels/qr-image";
import { StaffScan } from "./station-work/staff-scan";
import { CounterCode } from "./wallet/wallet-panel";

/** One QR code the customer can show: a parcel to collect, a reservation, their Green Credit, or their own account. */
interface ShownCode {
  key: string;
  kind: "parcel" | "reservation" | "credit" | "identity";
  /** Short name on the switcher; `label` is the full one above the code. */
  chip: string;
  label: string;
  qr: string;
  code: string;
  hint: string;
}

/**
 * The page behind the scanner button in the tab bar: either scan a socket to start a charge
 * (src/components/charging/charge-at-point.tsx), or show my QR code at the station. The code
 * shown first is the one needed now: a parcel waiting to be collected, then the next
 * reservation, then the Green Credit code (PIN first), then the account's own code that staff
 * scan to identify the customer.
 */
export function ScanHub() {
  const { profile } = useApp();
  // Station staff scan the customer's code instead: a parcel to hand over, a reservation, an account.
  return isStationStaff(profile) ? <StaffScan /> : <CustomerScan />;
}

function CustomerScan() {
  const { t, locale } = useI18n();
  const { backend, profile, features } = useApp();
  const L = t.ui.scanHub;
  const [showing, setShowing] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const contact = profile?.phone ?? profile?.email ?? null;
  const { data } = useLiveQuery(
    () =>
      profile
        ? Promise.all([backend.myReservations(), features.parcels ? backend.myParcels() : Promise.resolve([]), backend.listStations()])
        : Promise.resolve(null),
    `${profile?.id ?? ""}:${features.parcels}`,
  );

  const codes: ShownCode[] = [];
  if (data) {
    const [reservations, parcels, stations] = data;
    const stationName = (id: string) => stations.find((s) => s.id === id)?.name ?? "";
    const time = (iso: string) => new Date(iso).toLocaleTimeString(locale === "fr" ? "fr-FR" : "en-GB", { hour: "2-digit", minute: "2-digit" });
    for (const p of parcels) {
      if (p.direction !== "received" || p.status !== "arrived" || !p.pickupCode) continue;
      codes.push({
        key: `parcel-${p.id}`,
        kind: "parcel",
        chip: L.parcel,
        label: `${L.parcel} ${p.trackingNo}`,
        qr: pickupQrPayload(p.trackingNo, p.pickupCode),
        code: p.pickupCode,
        hint: format(L.parcelHint, { station: stationName(p.toStationId) }),
      });
    }
    const active = reservations.filter((r) => r.status === "active" && r.pickupCode).sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
    for (const r of active) {
      codes.push({
        key: `reservation-${r.id}`,
        kind: "reservation",
        chip: L.reservation,
        label: `${L.reservation} · ${stationName(r.stationId)}`,
        // Staff scan it to open the reservation with its code (src/components/station-work/staff-scan.tsx).
        qr: reservationQrPayload(r.id, r.pickupCode!),
        code: r.pickupCode!,
        hint: format(L.reservationHint, { station: stationName(r.stationId), time: time(r.expiresAt) }),
      });
    }
  }
  // Green Credit: the PIN, then the one-time code staff scan to load or spend the credit (CounterCode).
  if (profile) codes.push({ key: "credit", kind: "credit", chip: t.wallet.title, label: t.wallet.title, qr: "", code: "", hint: "" });
  if (contact) {
    codes.push({ key: "identity", kind: "identity", chip: L.identity, label: L.identity, qr: customerCode(contact), code: contact, hint: t.charging.myCodeHint });
  }
  const current = codes.find((c) => c.key === picked) ?? codes[0];
  const icons = { parcel: BoxIcon, reservation: TicketIcon, credit: WalletIcon, identity: UserIcon };

  const tile = "flex min-h-32 flex-col items-center justify-center gap-1.5 rounded-2xl p-3 text-center shadow-sm active:scale-[0.99]";
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 overflow-y-auto p-6">
      <h1 className="text-2xl font-semibold">{L.title}</h1>
      <p className="text-sm text-gp-muted">{L.intro}</p>
      <div className="grid grid-cols-2 gap-3">
        <Link href="/recharge?scan=1" className={`${tile} bg-gp-forest text-white`}>
          <QrIcon size={36} />
          <span className="text-base font-semibold leading-tight">{L.scan}</span>
          <span className="text-xs text-white/75">{L.scanHint}</span>
        </Link>
        <button
          type="button"
          onClick={() => setShowing(true)}
          aria-pressed={showing}
          className={`${tile} ${showing ? "bg-gp-yellow text-gp-forest" : "bg-gp-forest text-white"}`}
        >
          <UserIcon size={36} />
          <span className="text-base font-semibold leading-tight">{L.show}</span>
          <span className={`text-xs ${showing ? "text-gp-forest/75" : "text-white/75"}`}>{L.showHint}</span>
        </button>
      </div>

      {showing &&
        (!profile ? (
          <div className="space-y-3 rounded-2xl border border-gp-border bg-gp-surface p-4 text-sm dark:border-white/10">
            <p>{L.login}</p>
            <Link href="/login?next=/scanner" className="inline-block rounded-full bg-gp-green-dark px-4 py-2 font-semibold text-white">
              {t.nav.login}
            </Link>
          </div>
        ) : !current ? (
          <p className="text-sm text-gp-muted">{t.loading}</p>
        ) : (
          <section className="animate-gp-pop space-y-4 rounded-2xl border border-gp-border bg-gp-surface p-4 shadow-sm dark:border-white/10">
            {codes.length > 1 && (
              <div className="flex flex-wrap gap-2">
                {codes.map((c) => {
                  const Icon = icons[c.kind];
                  const on = c.key === current.key;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setPicked(c.key)}
                      aria-pressed={on}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium ${
                        on ? "border-gp-green-dark bg-gp-green/15 text-gp-green-dark dark:text-gp-green" : "border-gp-border dark:border-white/10"
                      }`}
                    >
                      <Icon size={16} />
                      {c.chip}
                    </button>
                  );
                })}
              </div>
            )}
            {current.kind === "credit" ? (
              <CounterCode onUsed={() => {}} />
            ) : (
              <div className="flex flex-col items-center gap-2 text-center">
                <div className="font-semibold">{current.label}</div>
                <QrImage text={current.qr} label={current.label} size={220} />
                <div className={`font-mono font-semibold ${current.kind === "identity" ? "text-lg" : "text-4xl tracking-[0.3em] text-gp-green-dark dark:text-gp-green"}`}>
                  {current.code}
                </div>
                <p className="text-sm text-gp-muted">{current.hint}</p>
              </div>
            )}
          </section>
        ))}
    </div>
  );
}
