import { ParcelsGate } from "@/components/parcels/parcels-gate";
import { StaffParcels } from "@/components/parcels/staff-parcels";
import { RequireLogin } from "@/components/require-login";

export default function OperatorParcelsPage() {
  return (
    <RequireLogin stationWork>
      <ParcelsGate>
        <StaffParcels />
      </ParcelsGate>
    </RequireLogin>
  );
}
