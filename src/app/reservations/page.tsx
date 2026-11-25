import { RequireLogin } from "@/components/require-login";
import { ReservationList } from "@/components/reservation-list";

export default function ReservationsPage() {
  return (
    <RequireLogin>
      <ReservationList />
    </RequireLogin>
  );
}
