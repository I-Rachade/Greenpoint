"use client";

import Link from "next/link";
import { LEGAL_PATHS } from "@/lib/legal/content";
import { useI18n } from "./i18n-provider";

/** Links to the legal notice, terms and privacy policy, for page footers. */
export function LegalLinks({ className = "" }: { className?: string }) {
  const { t } = useI18n();
  return (
    <nav className={`flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-zinc-500 ${className}`}>
      <Link href={LEGAL_PATHS.notice} className="hover:underline">
        {t.legal.notice}
      </Link>
      <Link href={LEGAL_PATHS.terms} className="hover:underline">
        {t.legal.terms}
      </Link>
      <Link href={LEGAL_PATHS.privacy} className="hover:underline">
        {t.legal.privacy}
      </Link>
    </nav>
  );
}
