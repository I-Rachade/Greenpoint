import { PointPartnerPanel } from "@/components/point-partner-panel";
import { RequireLogin } from "@/components/require-login";

export default function PointPartnerPage() {
  return (
    <RequireLogin>
      <PointPartnerPanel />
    </RequireLogin>
  );
}
