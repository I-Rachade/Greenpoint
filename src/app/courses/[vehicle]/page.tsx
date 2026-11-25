import { notFound } from "next/navigation";
import { OrderPage } from "@/components/drivers/my-trips";
import { ParcelsGate } from "@/components/parcels/parcels-gate";
import { RequireLogin } from "@/components/require-login";
import { VEHICLE_SLUGS } from "@shared/drivers";

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(VEHICLE_SLUGS).map((vehicle) => ({ vehicle }));
}

export default async function OrderVehiclePage({ params }: { params: Promise<{ vehicle: string }> }) {
  const { vehicle } = await params;
  const type = VEHICLE_SLUGS[vehicle];
  if (!type) notFound();
  return (
    <RequireLogin>
      <ParcelsGate>
        <OrderPage vehicle={type} />
      </ParcelsGate>
    </RequireLogin>
  );
}
