import { MyTrips } from "@/components/drivers/my-trips";
import { ParcelsGate } from "@/components/parcels/parcels-gate";
import { RequireLogin } from "@/components/require-login";

export default function TripsPage() {
  return (
    <RequireLogin>
      <ParcelsGate>
        <MyTrips />
      </ParcelsGate>
    </RequireLogin>
  );
}
