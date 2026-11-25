import { notFound } from "next/navigation";
import { ParcelsGate } from "@/components/parcels/parcels-gate";
import { StaffParcels } from "@/components/parcels/staff-parcels";
import { RequireLogin } from "@/components/require-login";
import { isParcelSection, PARCEL_SECTIONS } from "@/lib/parcel-sections";

export const dynamicParams = false;

export function generateStaticParams() {
  return PARCEL_SECTIONS.map((section) => ({ section }));
}

export default async function OperatorParcelSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!isParcelSection(section)) notFound();
  return (
    <RequireLogin stationWork>
      <ParcelsGate>
        <StaffParcels section={section} />
      </ParcelsGate>
    </RequireLogin>
  );
}
