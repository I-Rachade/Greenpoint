"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import { useApp } from "./app-provider";
import { BoxIcon, StoreIcon } from "./icons";
import { useI18n } from "./i18n-provider";
import { OperatorPanel } from "./operator-panel";

function BigButton({ href, icon: Icon, label, hint }: { href: string; icon: ComponentType<{ size?: number }>; label: string; hint: string }) {
  return (
    <Link
      href={href}
      className="flex flex-1 flex-col items-center justify-center gap-3 rounded-3xl bg-gp-forest p-6 text-center text-white shadow-sm active:scale-[0.99]"
    >
      <Icon size={56} />
      <span className="text-3xl font-semibold">{label}</span>
      <span className="text-sm text-white/80">{hint}</span>
    </Link>
  );
}

/** /operator: two big buttons for the station's status and its parcel counter; only the status while the parcel module is off. */
export function OperatorHome() {
  const { t } = useI18n();
  const { features, featuresReady } = useApp();
  if (!featuresReady) return null;
  if (!features.parcels) return <OperatorPanel />;
  return (
    <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-4 p-4 sm:p-6">
      <h1 className="sr-only">{t.operator.homeTitle}</h1>
      <BigButton href="/operator/statut" icon={StoreIcon} label={t.operator.homeStatus} hint={t.operator.homeStatusHint} />
      <BigButton href="/operator/colis" icon={BoxIcon} label={t.operator.homeParcels} hint={t.operator.homeParcelsHint} />
    </div>
  );
}
