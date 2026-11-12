import { Suspense } from "react";
import { ChargeAtPoint } from "@/components/charging/charge-at-point";

// The outlet's QR code links here with its charging point id (?p=…): the site is a static export.
export default function RechargePage() {
  return (
    <Suspense>
      <ChargeAtPoint />
    </Suspense>
  );
}
