import { MyParcels } from "@/components/parcels/my-parcels";
import { ParcelsGate } from "@/components/parcels/parcels-gate";
import { RequireLogin } from "@/components/require-login";

export default function ParcelsPage() {
  return (
    <RequireLogin>
      <ParcelsGate>
        <MyParcels />
      </ParcelsGate>
    </RequireLogin>
  );
}
