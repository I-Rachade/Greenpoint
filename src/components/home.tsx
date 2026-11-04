"use client";

import { useApp } from "./app-provider";
import { MyScooterHome } from "./my-scooter-home";
import { StationFinder } from "./station-finder";

/** "/": a signed-in rider lands on "Mon scooter" (mockup A1); everyone else on the station finder. */
export function Home() {
  const { profile } = useApp();
  return profile?.role === "customer" ? <MyScooterHome /> : <StationFinder />;
}
