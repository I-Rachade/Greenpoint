"use client";

import Link from "next/link";
import { Fragment } from "react";
import { CONTACT_EMAIL } from "@/lib/config";
import { LEGAL_DOCS, LEGAL_PLACEHOLDER, type LegalDocId } from "@/lib/legal/content";
import { format } from "@/lib/i18n/format";
import { useI18n } from "./i18n-provider";
import { LegalLinks } from "./legal-links";

/** Text with the contact address filled in and open placeholders highlighted. */
function LegalText({ text }: { text: string }) {
  const parts = text.replaceAll("{email}", CONTACT_EMAIL).split(LEGAL_PLACEHOLDER);
  return parts.map((part, i) =>
    LEGAL_PLACEHOLDER.test(part) ? (
      <mark key={i} className="rounded bg-amber-100 px-1 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100">
        {part}
      </mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

export function LegalPage({ doc }: { doc: LegalDocId }) {
  const { t, locale } = useI18n();
  const content = LEGAL_DOCS[locale][doc];
  return (
    <div className="flex-1 overflow-y-auto">
      <article className="mx-auto w-full max-w-2xl space-y-6 p-6 text-sm leading-relaxed text-zinc-700 dark:text-zinc-300">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{content.title}</h1>
          <p className="text-xs text-zinc-500">{format(t.legal.updated, { date: content.updated })}</p>
        </header>
        {content.sections.map((section) => (
          <section key={section.heading} className="space-y-2">
            <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{section.heading}</h2>
            {section.body.map((block, i) =>
              typeof block === "string" ? (
                <p key={i}>
                  <LegalText text={block} />
                </p>
              ) : (
                <ul key={i} className="list-disc space-y-1 pl-5">
                  {block.map((item) => (
                    <li key={item}>
                      <LegalText text={item} />
                    </li>
                  ))}
                </ul>
              ),
            )}
          </section>
        ))}
        <footer className="border-t border-black/10 pt-4 dark:border-white/10">
          <LegalLinks />
          <p className="mt-2 text-center text-xs">
            <Link href="/" className="text-gp-green-dark underline dark:text-gp-green">
              {t.legal.back}
            </Link>
          </p>
        </footer>
      </article>
    </div>
  );
}
