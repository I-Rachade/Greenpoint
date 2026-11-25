import { Deliveries } from "@/components/deliveries";
import { ParcelsGate } from "@/components/parcels/parcels-gate";
import { RequireLogin } from "@/components/require-login";

export default function DeliveriesPage() {
  return (
    <RequireLogin>
      <ParcelsGate>
        <Deliveries />
      </ParcelsGate>
    </RequireLogin>
  );
}
