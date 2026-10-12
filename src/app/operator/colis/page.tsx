import { StaffParcels } from "@/components/parcels/staff-parcels";
import { RequireLogin } from "@/components/require-login";

export default function OperatorParcelsPage() {
  return (
    <RequireLogin roles={["operator", "admin"]}>
      <StaffParcels />
    </RequireLogin>
  );
}
