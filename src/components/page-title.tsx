"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { BackIcon } from "./icons";
import { useI18n } from "./i18n-provider";

/** Screen title row: optional back arrow, title, and actions on the right. */
export function PageTitle({
  title,
  back,
  actions,
}: {
  title: string;
  /** A path, or true to go back in history. */
  back?: string | true;
  actions?: ReactNode;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const backClass =
    "-ml-2 flex h-10 w-10 items-center justify-center rounded-full text-gp-forest hover:bg-black/5 dark:text-zinc-100 dark:hover:bg-white/10";
  return (
    <div className="flex items-center gap-2 pb-2">
      {back === true ? (
        <button type="button" className={backClass} onClick={() => router.back()} aria-label={t.ui.back}>
          <BackIcon />
        </button>
      ) : back ? (
        <Link href={back} className={backClass} aria-label={t.ui.back}>
          <BackIcon />
        </Link>
      ) : null}
      <h1 className="min-w-0 flex-1 truncate text-2xl font-semibold">{title}</h1>
      {actions}
    </div>
  );
}

/** Card moved to ./ui; re-exported so existing imports keep working. */
export { Card } from "./ui";
