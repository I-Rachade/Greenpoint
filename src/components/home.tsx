"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { isStationStaff } from "@shared/operators";
import { useApp } from "./app-provider";
import { MyScooterHome } from "./my-scooter-home";
import { StationFinder } from "./station-finder";

/** True once the app has opened on "/" in this run: only that first time sends staff to their station. */
let opened = false;

/**
 * "/": riders land on "Mon scooter" (mockup A1), visitors too (with an invitation to sign up in
 * place of the battery); drivers, fleets and shops keep the station finder.
 * Station staff open the app on their station (/operator); the map stays one tab away.
 */
export function Home() {
  const { profile, ready } = useApp();
  const router = useRouter();
  const staff = isStationStaff(profile);
  const toStation = ready && staff && !opened;
  useEffect(() => {
    if (!ready) return;
    if (toStation) router.replace("/operator");
    opened = true;
  }, [ready, toStation, router]);
  if (toStation) return null;
  return !profile || profile.role === "customer" ? <MyScooterHome /> : <StationFinder />;
}
