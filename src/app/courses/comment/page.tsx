import { TripsHowTo } from "@/components/drivers/my-trips";
import { ParcelsGate } from "@/components/parcels/parcels-gate";
import { RequireLogin } from "@/components/require-login";

export default function TripsHowToPage() {
  return (
    <RequireLogin>
      <ParcelsGate>
        <TripsHowTo />
      </ParcelsGate>
    </RequireLogin>
  );
}
