import { RequireLogin } from "@/components/require-login";
import { ReservationsPage } from "@/components/station-work/reservations-page";

export default function OperatorReservationsPage() {
  return (
    <RequireLogin stationWork>
      <ReservationsPage />
    </RequireLogin>
  );
}
