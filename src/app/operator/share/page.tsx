import { RequireLogin } from "@/components/require-login";
import { SharePage } from "@/components/station-work/share-page";

export default function OperatorSharePage() {
  return (
    <RequireLogin stationWork>
      <SharePage />
    </RequireLogin>
  );
}
