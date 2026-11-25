import { OperatorHome } from "@/components/operator-home";
import { RequireLogin } from "@/components/require-login";

export default function OperatorPage() {
  return (
    <RequireLogin stationWork>
      <OperatorHome />
    </RequireLogin>
  );
}
