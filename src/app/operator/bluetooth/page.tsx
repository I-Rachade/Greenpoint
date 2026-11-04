import { BleDiagnosticPage } from "@/components/ble/ble-diagnostic";
import { RequireLogin } from "@/components/require-login";

/** Bluetooth diagnostic of a battery, for admins only (plan "Lire le SOC des batteries par Bluetooth", step 2). */
export default function OperatorBluetoothPage() {
  return (
    <RequireLogin roles={["admin"]}>
      <BleDiagnosticPage />
    </RequireLogin>
  );
}
