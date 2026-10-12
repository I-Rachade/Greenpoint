import { OperatorPanel } from "@/components/operator-panel";
import { RequireLogin } from "@/components/require-login";

export default function OperatorPage() {
  return (
    <RequireLogin roles={["operator", "admin"]}>
      <OperatorPanel />
    </RequireLogin>
  );
}
