"use client";

import { Pill } from "@/components/backoffice/shared";
import type { ParcelStatus } from "@/lib/parcels";
import { useI18n } from "../i18n-provider";

const TONE: Record<ParcelStatus, "green" | "amber" | "red" | "gray" | "blue"> = {
  deposited: "gray",
  in_transit: "blue",
  arrived: "green",
  picked_up: "gray",
  cancelled: "gray",
  stored: "amber",
  released: "gray",
  auctioned: "red",
};

export function ParcelStatusPill({ status }: { status: ParcelStatus }) {
  const { t } = useI18n();
  return <Pill tone={TONE[status]}>{t.parcels.status[status]}</Pill>;
}
