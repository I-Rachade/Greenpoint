import { AdminStations } from "@/components/admin-stations";
import { RequireLogin } from "@/components/require-login";

export default function AdminPage() {
  return (
    <RequireLogin roles={["admin"]}>
      <AdminStations />
    </RequireLogin>
  );
}
