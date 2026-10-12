import { MyParcels } from "@/components/parcels/my-parcels";
import { RequireLogin } from "@/components/require-login";

export default function ParcelsPage() {
  return (
    <RequireLogin>
      <MyParcels />
    </RequireLogin>
  );
}
