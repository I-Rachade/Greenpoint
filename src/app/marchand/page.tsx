import { MerchantPanel } from "@/components/merchants/merchant-panel";
import { RequireLogin } from "@/components/require-login";

/** The shop: bookings for every member, the backoffice for the merchant, shop invites for customers (?invitation=CODE). */
export default function MerchantPage() {
  return (
    <RequireLogin>
      <MerchantPanel />
    </RequireLogin>
  );
}
