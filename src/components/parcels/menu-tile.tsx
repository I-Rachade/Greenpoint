"use client";

import Link from "next/link";

/** One big tile on the parcel counter menus, with how many items wait behind it. */
export function MenuTile({ href, label, count }: { href: string; label: string; count?: number }) {
  return (
    <Link
      href={href}
      className="relative flex min-h-24 items-center justify-center rounded-2xl bg-gp-forest p-4 text-center text-lg font-semibold text-white shadow-sm active:scale-[0.99]"
    >
      {label}
      {!!count && (
        <span className="absolute right-2 top-2 min-w-6 rounded-full bg-white px-1.5 text-sm font-bold text-gp-forest">{count}</span>
      )}
    </Link>
  );
}
