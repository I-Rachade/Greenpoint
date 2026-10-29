import { RequireLogin } from "@/components/require-login";
import { SwapLogPage } from "@/components/station-work/swap-log";

export default function OperatorSwapLogPage() {
  return (
    <RequireLogin stationWork>
      <SwapLogPage />
    </RequireLogin>
  );
}
