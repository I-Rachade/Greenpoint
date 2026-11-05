"use client";

import { useApp } from "./app-provider";
import { MyScooterHome } from "./my-scooter-home";
import { StationFinder } from "./station-finder";

/**
 * "/": riders land on "Mon scooter" (mockup A1), visitors too (with an invitation to sign up in
 * place of the battery); staff, drivers, fleets and shops keep the station finder.
 */
export function Home() {
  const { profile } = useApp();
  return !profile || profile.role === "customer" ? <MyScooterHome /> : <StationFinder />;
}
