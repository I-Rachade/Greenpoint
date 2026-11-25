import { Suspense } from "react";
import { StationScreen } from "@/components/station-screen";

// The station id is in the query string (?id=…): the site is a static export without per-station pages.
export default function StationPage() {
  return (
    <Suspense>
      <StationScreen />
    </Suspense>
  );
}
