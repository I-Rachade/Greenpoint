import { RequireLogin } from "@/components/require-login";
import { IncidentPage } from "@/components/station-work/incident-page";

export default function OperatorIncidentPage() {
  return (
    <RequireLogin stationWork>
      <IncidentPage />
    </RequireLogin>
  );
}
