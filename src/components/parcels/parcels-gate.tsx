"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useApp } from "../app-provider";
import { useI18n } from "../i18n-provider";

/** Shows parcel pages only while the parcel module is switched on in the backoffice. */
export function ParcelsGate({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const { features, featuresReady } = useApp();
  if (features.parcels) return children;
  if (!featuresReady) return null;
  return (
    <div className="mx-auto max-w-md space-y-3 p-6 text-center">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.parcels.unavailable}</p>
      <Link href="/" className="inline-block rounded-full bg-gp-green-dark px-4 py-2 text-sm font-medium text-white">
        {t.nav.map}
      </Link>
    </div>
  );
}
