import { RequireLogin } from "@/components/require-login";
import { SwapPage } from "@/components/station-work/swap-page";

export default function OperatorSwapPage() {
  return (
    <RequireLogin stationWork>
      <SwapPage />
    </RequireLogin>
  );
}
