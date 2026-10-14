import { notFound } from "next/navigation";
import { RidePage } from "@/components/drivers/my-trips";
import { ParcelsGate } from "@/components/parcels/parcels-gate";
import { RequireLogin } from "@/components/require-login";
import { RIDE_SLUGS } from "@/lib/drivers";

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(RIDE_SLUGS).map((vehicle) => ({ vehicle }));
}

export default async function RideVehiclePage({ params }: { params: Promise<{ vehicle: string }> }) {
  const { vehicle } = await params;
  const type = RIDE_SLUGS[vehicle];
  if (!type) notFound();
  return (
    <RequireLogin>
      <ParcelsGate>
        <RidePage vehicle={type} />
      </ParcelsGate>
    </RequireLogin>
  );
}
