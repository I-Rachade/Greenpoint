import { OperatorPanel } from "@/components/operator-panel";
import { RequireLogin } from "@/components/require-login";

export default function OperatorStatusPage() {
  return (
    <RequireLogin stationWork>
      <OperatorPanel />
    </RequireLogin>
  );
}
