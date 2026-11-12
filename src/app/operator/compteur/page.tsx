import { RequireLogin } from "@/components/require-login";
import { CounterPage } from "@/components/station-work/counter-page";

export default function OperatorCounterPage() {
  return (
    <RequireLogin stationWork>
      <CounterPage />
    </RequireLogin>
  );
}
