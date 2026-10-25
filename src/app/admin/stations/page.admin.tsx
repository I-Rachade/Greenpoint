import { AdminStations } from "@/components/admin-stations";
import { StationsBoard } from "@/components/backoffice/stations-board";

export default function AdminStationsPage() {
  return (
    <>
      <StationsBoard />
      <AdminStations />
    </>
  );
}
