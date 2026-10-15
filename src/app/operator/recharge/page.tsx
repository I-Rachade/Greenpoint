import { RequireLogin } from "@/components/require-login";
import { ChargingPage } from "@/components/station-work/charging-page";

export default function OperatorChargingPage() {
  return (
    <RequireLogin stationWork>
      <ChargingPage />
    </RequireLogin>
  );
}
