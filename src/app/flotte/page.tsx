import { FleetPanel } from "@/components/drivers/fleet-panel";
import { RequireLogin } from "@/components/require-login";

export default function FleetPage() {
  return (
    <RequireLogin>
      <FleetPanel />
    </RequireLogin>
  );
}
