import { RegularSend } from "@/components/parcels/my-parcels";
import { ParcelsGate } from "@/components/parcels/parcels-gate";
import { RequireLogin } from "@/components/require-login";

export default function RegularSendPage() {
  return (
    <RequireLogin>
      <ParcelsGate>
        <RegularSend />
      </ParcelsGate>
    </RequireLogin>
  );
}
