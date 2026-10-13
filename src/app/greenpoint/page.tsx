import { GreenpointPanel } from "@/components/greenpoint/greenpoint-panel";
import { RequireLogin } from "@/components/require-login";

export default function GreenpointPage() {
  return (
    <RequireLogin>
      <GreenpointPanel />
    </RequireLogin>
  );
}
