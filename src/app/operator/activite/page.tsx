import { RequireLogin } from "@/components/require-login";
import { ActivityPage } from "@/components/station-work/activity-page";

export default function OperatorActivityPage() {
  return (
    <RequireLogin stationWork>
      <ActivityPage />
    </RequireLogin>
  );
}
