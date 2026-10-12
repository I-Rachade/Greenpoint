"use client";

import type { ReactNode } from "react";
import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import type { AdminSnapshot, AdminUser } from "@/lib/admin/types";
import { useLiveQuery } from "@/lib/hooks";

/** Loads the backoffice data and keeps it live (reloads on every station or reservation change). */
export function useAdminSnapshot() {
  const { backend } = useApp();
  return useLiveQuery(() => backend.adminSnapshot());
}

export function userLabel(user: Pick<AdminUser, "fullName" | "phone"> | undefined, fallback = "?"): string {
  if (!user) return fallback;
  return user.fullName ? `${user.fullName} (${user.phone})` : user.phone;
}

/** Lookups by id for tables that only carry ids. */
export function indexSnapshot(snap: AdminSnapshot) {
  return {
    stationName: (id: string | null | undefined) => snap.stations.find((s) => s.id === id)?.name ?? id ?? "",
    user: (id: string | null | undefined) => snap.users.find((u) => u.id === id),
  };
}

/** Short date and time ("12/10 14:05") in the app's language. */
export function useDateTime() {
  const { locale } = useI18n();
  const fmt = new Intl.DateTimeFormat(locale === "fr" ? "fr-TG" : "en-GB", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (iso: string | null) => (iso ? fmt.format(new Date(iso)) : "");
}

export function Loading({ error }: { error?: unknown }) {
  const { t } = useI18n();
  if (error) return <p className="p-6 text-sm text-red-600">{t.errors.forbidden}</p>;
  return <p className="p-6 text-sm text-zinc-500">{t.loading}</p>;
}

export const card = "rounded-xl border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-zinc-900";
export const field =
  "rounded-lg border border-black/15 bg-white px-3 py-1.5 text-sm dark:border-white/20 dark:bg-zinc-900";
export const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-zinc-500";
export const td = "px-3 py-2 align-top";

export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-black/10 bg-white dark:border-white/10 dark:bg-zinc-900">
      <table className="w-full min-w-[40rem] text-sm">
        <thead className="border-b border-black/10 dark:border-white/10">
          <tr>{head}</tr>
        </thead>
        <tbody className="divide-y divide-black/5 dark:divide-white/5">{children}</tbody>
      </table>
    </div>
  );
}

const PILL: Record<string, string> = {
  green: "bg-gp-green/15 text-gp-green-dark dark:text-gp-green",
  amber: "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100",
  red: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  gray: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  blue: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
};

export function Pill({ tone, children }: { tone: keyof typeof PILL; children: ReactNode }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${PILL[tone]}`}>{children}</span>;
}
