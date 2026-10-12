"use client";

import { CONTACT_EMAIL } from "@/lib/config";
import { useI18n } from "./i18n-provider";

export function ContactInfo() {
  const { t } = useI18n();
  return (
    <div className="mx-auto w-full max-w-sm space-y-4 p-6">
      <h1 className="text-2xl font-semibold">{t.contact.title}</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.contact.intro}</p>
      <p>
        <span className="block text-sm text-zinc-500">{t.contact.email}</span>
        <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-gp-green-dark underline dark:text-gp-green">
          {CONTACT_EMAIL}
        </a>
      </p>
    </div>
  );
}
