import { HowToSend } from "@/components/parcels/my-parcels";
import { ParcelsGate } from "@/components/parcels/parcels-gate";
import { RequireLogin } from "@/components/require-login";

export default function HowToSendPage() {
  return (
    <RequireLogin>
      <ParcelsGate>
        <HowToSend />
      </ParcelsGate>
    </RequireLogin>
  );
}
