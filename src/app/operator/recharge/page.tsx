import { Suspense } from "react";
import { RequireLogin } from "@/components/require-login";
import { ChargingPage } from "@/components/station-work/charging-page";

// Opened from a reservation with ?reservation=…: the static export reads it on the client.
export default function OperatorChargingPage() {
  return (
    <RequireLogin stationWork>
      <Suspense>
        <ChargingPage />
      </Suspense>
    </RequireLogin>
  );
}
