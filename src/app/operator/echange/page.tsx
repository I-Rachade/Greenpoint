import { Suspense } from "react";
import { RequireLogin } from "@/components/require-login";
import { SwapPage } from "@/components/station-work/swap-page";

// Opened from a reservation with ?reservation=…: the static export reads it on the client.
export default function OperatorSwapPage() {
  return (
    <RequireLogin stationWork>
      <Suspense>
        <SwapPage />
      </Suspense>
    </RequireLogin>
  );
}
