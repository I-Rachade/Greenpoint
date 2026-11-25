"use client";

import Link from "next/link";
import type { ComponentType } from "react";

/** One big tile on the parcel counter menus: an icon, a label, and how many items wait behind it. */
export function MenuTile({
  href,
  icon: Icon,
  label,
  count,
}: {
  href: string;
  icon: ComponentType<{ size?: number }>;
  label: string;
  count?: number;
}) {
  return (
    <Link
      href={href}
      className="relative flex min-h-28 flex-col items-center justify-center gap-2 rounded-2xl bg-gp-forest p-3 text-center text-base font-semibold leading-tight text-white shadow-sm active:scale-[0.99]"
    >
      <Icon size={36} />
      {label}
      {!!count && (
        <span className="absolute right-2 top-2 min-w-6 rounded-full bg-white px-1.5 text-sm font-bold text-gp-forest">{count}</span>
      )}
    </Link>
  );
}
