import { OperatorHome } from "@/components/operator-home";
import { RequireLogin } from "@/components/require-login";

/** Old address of the station status page: the station home now holds open/close and the service tiles. */
export default function OperatorStatusPage() {
  return (
    <RequireLogin stationWork>
      <OperatorHome />
    </RequireLogin>
  );
}
