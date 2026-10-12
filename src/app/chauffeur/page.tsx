import { DriverPanel } from "@/components/drivers/driver-panel";
import { RequireLogin } from "@/components/require-login";

export default function DriverPage() {
  return (
    <RequireLogin>
      <DriverPanel />
    </RequireLogin>
  );
}
