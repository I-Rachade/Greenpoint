import { ExpressHowTo } from "@/components/parcels/my-parcels";
import { ParcelsGate } from "@/components/parcels/parcels-gate";
import { RequireLogin } from "@/components/require-login";

export default function ExpressHowToPage() {
  return (
    <RequireLogin>
      <ParcelsGate>
        <ExpressHowTo />
      </ParcelsGate>
    </RequireLogin>
  );
}
