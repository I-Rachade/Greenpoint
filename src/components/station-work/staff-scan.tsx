"use client";

import { useState } from "react";
import { contactFromCode, isCustomerCode } from "@shared/charging";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { parsePickupInput } from "@shared/parcels";
import { parseReservationQr, reservationKind, staffFlowHref } from "@shared/reservations";
import { isHolding } from "@shared/availability";
import type { StationView } from "@shared/types";
import { useApp } from "../app-provider";
import { BoxIcon, QrIcon, TicketIcon, UserIcon } from "../icons";
import { useI18n } from "../i18n-provider";
import { QrScanner } from "../parcels/qr-scanner";
import { useReservationWhat } from "../reservation-list";
import { Button, Card, SuccessCheck } from "../ui";
import { WorkShell } from "./work-shell";

/** What a scanned customer code turned out to be. */
type Scanned =
  | { kind: "parcel"; text: string; trackingNo: string }
  | { kind: "reservation"; id: string; code: string }
  | { kind: "customer"; contact: string }
  | { kind: "unknown" };

function classify(text: string): Scanned {
  const reservation = parseReservationQr(text);
  if (reservation) return { kind: "reservation", ...reservation };
  const pickup = parsePickupInput(text);
  if (pickup?.trackingNo) return { kind: "parcel", text: text.trim(), trackingNo: pickup.trackingNo };
  if (isCustomerCode(text)) return { kind: "customer", contact: contactFromCode(text) };
  return { kind: "unknown" };
}

/** A parcel pickup QR code: hand the parcel over (the backend checks the code against the parcel). */
function ParcelResult({ station, scanned }: { station: StationView; scanned: Extract<Scanned, { kind: "parcel" }> }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const S = t.ui.staffScan;
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (done) {
    return (
      <Card className="flex flex-col items-center gap-3 p-6 text-center">
        <SuccessCheck />
        <p className="font-semibold">{done}</p>
      </Card>
    );
  }
  return (
    <Card className="space-y-3 p-4">
      <p className="flex items-center gap-2 font-semibold">
        <BoxIcon size={20} />
        {format(S.parcel, { no: scanned.trackingNo })}
      </p>
      <p className="text-sm text-gp-muted">{S.parcelHint}</p>
      <Button
        size="lg"
        className="w-full"
        busy={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const parcel = await backend.pickUpParcel(station.id, scanned.text);
            setDone(format(t.parcels.staff.handedOver, { no: parcel.trackingNo }));
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        {S.handOver}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </Card>
  );
}

/** A reservation QR code: who reserved what, and the way into its flow with the code filled in. */
function ReservationResult({ station, scanned }: { station: StationView; scanned: Extract<Scanned, { kind: "reservation" }> }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const what = useReservationWhat();
  const S = t.ui.staffScan;
  const { data } = useLiveQuery(() => backend.stationReservations(station.id), `${station.id}:${scanned.id}`);
  if (!data) return <p className="text-sm text-gp-muted">{t.loading}</p>;
  const r = data.find((x) => x.id === scanned.id);
  if (!r || !isHolding(r)) return <Card className="p-4 text-sm">{S.reservationGone}</Card>;
  return (
    <Card className="space-y-3 p-4">
      <p className="flex items-center gap-2 font-semibold">
        <TicketIcon size={20} />
        {format(S.reservation, { customer: r.customer ?? t.work.reservations.customer })}
      </p>
      <p className="text-sm text-gp-muted">{what(r)}</p>
      <Button size="lg" className="w-full" href={`${staffFlowHref(r)}&code=${scanned.code}`}>
        {reservationKind(r) === "swap" ? S.validateSwap : S.validateCharge}
      </Button>
    </Card>
  );
}

/** A customer's own code: start a swap or a charge on their account. */
function CustomerResult({ station, contact }: { station: StationView; contact: string }) {
  const { t } = useI18n();
  const S = t.ui.staffScan;
  const services = station.activeServices ?? [];
  const client = encodeURIComponent(contact);
  return (
    <Card className="space-y-3 p-4">
      <p className="flex items-center gap-2 font-semibold">
        <UserIcon size={20} />
        {format(S.customer, { contact })}
      </p>
      <div className="grid grid-cols-2 gap-2">
        {services.includes("swap") && (
          <Button size="lg" href={`/operator/echange?client=${client}`}>
            {S.swap}
          </Button>
        )}
        {(services.includes("charging") || services.includes("ev")) && (
          <Button size="lg" variant="secondary" href={`/operator/recharge?client=${client}`}>
            {S.charge}
          </Button>
        )}
      </div>
    </Card>
  );
}

/**
 * The scanner page for station staff (behind the scanner button in the tab bar): scan the
 * code the customer shows (src/components/scan-hub.tsx) and act on it at the active station:
 * hand over a parcel, validate a reservation, or serve the customer's account.
 */
export function StaffScan() {
  const { t } = useI18n();
  const S = t.ui.staffScan;
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState<{ at: number; value: Scanned } | null>(null);
  return (
    <WorkShell title={S.title}>
      {({ station }) => (
        <>
          <p className="text-sm text-gp-muted">{S.intro}</p>
          <button
            type="button"
            onClick={() => setScanning(true)}
            className="flex min-h-32 w-full flex-col items-center justify-center gap-1.5 rounded-2xl bg-gp-forest p-3 text-center text-white shadow-sm active:scale-[0.99]"
          >
            <QrIcon size={36} />
            <span className="text-base font-semibold">{S.scan}</span>
            <span className="text-xs text-white/75">{S.scanHint}</span>
          </button>
          {scanned?.value.kind === "parcel" && <ParcelResult key={scanned.at} station={station} scanned={scanned.value} />}
          {scanned?.value.kind === "reservation" && <ReservationResult key={scanned.at} station={station} scanned={scanned.value} />}
          {scanned?.value.kind === "customer" && <CustomerResult key={scanned.at} station={station} contact={scanned.value.contact} />}
          {scanned?.value.kind === "unknown" && <Card className="p-4 text-sm">{S.unknown}</Card>}
          {scanning && (
            <QrScanner
              onClose={() => setScanning(false)}
              onResult={(text) => {
                setScanning(false);
                setScanned({ at: Date.now(), value: classify(text) });
              }}
            />
          )}
        </>
      )}
    </WorkShell>
  );
}
