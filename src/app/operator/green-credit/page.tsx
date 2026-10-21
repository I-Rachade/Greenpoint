import { RequireLogin } from "@/components/require-login";
import { CreditPage } from "@/components/station-work/credit-page";

export default function OperatorGreenCreditPage() {
  return (
    <RequireLogin stationWork>
      <CreditPage />
    </RequireLogin>
  );
}
