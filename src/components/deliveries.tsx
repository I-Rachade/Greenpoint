"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import { TripTiles } from "./drivers/my-trips";
import { BoxIcon, ChevronIcon, ScooterIcon } from "./icons";
import { useI18n } from "./i18n-provider";
import { ParcelTiles } from "./parcels/my-parcels";

/** A row leading to the list of one's parcels or trips. */
function FollowLink({ href, icon: Icon, label }: { href: string; icon: ComponentType<{ size?: number }>; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border border-black/10 p-4 text-sm font-semibold text-gp-green-dark dark:border-white/10 dark:text-gp-green"
    >
      <Icon size={22} />
      <span className="flex-1">{label}</span>
      <ChevronIcon size={18} />
    </Link>
  );
}

/** "Livraisons" tab: everything from the parcels and trips pages in one place, to pick what to do. */
export function Deliveries() {
  const { t } = useI18n();
  const L = t.ui.deliveries;
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 overflow-y-auto p-6">
      <h1 className="text-2xl font-semibold">{L.title}</h1>
      <p className="text-sm text-gp-muted">{L.intro}</p>
      <h2 className="font-semibold">{L.send}</h2>
      <ParcelTiles />
      <h2 className="font-semibold">{L.order}</h2>
      <TripTiles />
      <h2 className="font-semibold">{L.follow}</h2>
      <div className="space-y-2">
        <FollowLink href="/colis" icon={BoxIcon} label={L.myParcels} />
        <FollowLink href="/courses" icon={ScooterIcon} label={L.myTrips} />
      </div>
    </div>
  );
}
