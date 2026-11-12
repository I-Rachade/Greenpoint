"use client";

import Link from "next/link";
import type { AlertTone } from "@/lib/alerts";
import { useNow, useRelativeTime } from "@/lib/hooks";
import { useApp } from "./app-provider";
import { BellIcon, BoxIcon, TicketIcon } from "./icons";
import { useI18n } from "./i18n-provider";
import { PageTitle } from "./page-title";
import { useAlerts } from "./use-alerts";

const TONES: Record<AlertTone, string> = {
  success: "bg-gp-green/15 text-gp-green-dark dark:text-gp-green",
  info: "bg-gp-info/15 text-gp-info",
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  muted: "bg-gp-border/70 text-gp-muted dark:bg-white/10 dark:text-zinc-400",
};

const ICONS = { reservation: TicketIcon, parcel: BoxIcon, promotion: BellIcon };

/** Notifications screen: the customer's reservations, parcels and the current offer, newest first. */
export function NotificationsScreen() {
  const { t } = useI18n();
  const { profile, ready } = useApp();
  const now = useNow();
  const relativeTime = useRelativeTime();
  const { alerts, unread, isRead, markAllRead } = useAlerts();

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-4 pb-6 pt-4">
      <PageTitle
        title={t.ui.alerts.title}
        actions={
          unread > 0 && (
            <button type="button" onClick={markAllRead} className="text-sm font-medium text-gp-green-dark dark:text-gp-green">
              {t.ui.alerts.markAll}
            </button>
          )
        }
      />

      {!ready || (profile && alerts === null) ? (
        <p className="text-sm text-gp-muted">{t.loading}</p>
      ) : !profile ? (
        <Empty text={t.ui.alerts.loginHint}>
          <Link href="/login" className="mt-2 rounded-full bg-gp-green-dark px-5 py-2.5 text-sm font-semibold text-white">
            {t.nav.login}
          </Link>
        </Empty>
      ) : alerts && alerts.length === 0 ? (
        <Empty text={t.ui.alerts.empty} />
      ) : (
        <ul className="space-y-2">
          {alerts?.map((a) => {
            const Icon = ICONS[a.icon];
            const fresh = !isRead(a.id);
            return (
              <li key={a.id}>
                <Link
                  href={a.href}
                  className={`flex gap-3 rounded-2xl border p-3 ${
                    fresh ? "border-gp-green/40 bg-gp-surface shadow-sm" : "border-gp-border bg-gp-surface/60 dark:border-white/10"
                  }`}
                >
                  <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${TONES[a.tone]}`}>
                    <Icon size={20} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start gap-2">
                      <span className={`flex-1 text-sm ${fresh ? "font-semibold" : "font-medium"}`}>{a.title}</span>
                      {fresh && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gp-green" aria-hidden />}
                    </span>
                    {a.text && <span className="mt-0.5 block text-sm text-gp-muted dark:text-zinc-400">{a.text}</span>}
                    <span className="mt-1 block text-xs text-gp-muted">{relativeTime(a.at, now)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Empty({ text, children }: { text: string; children?: React.ReactNode }) {
  return (
    <div className="mt-10 flex flex-col items-center gap-3 text-center">
      <span className="flex h-20 w-20 items-center justify-center rounded-full bg-gp-green/15 text-gp-green-dark">
        <BellIcon size={36} />
      </span>
      <p className="max-w-xs text-sm text-gp-muted">{text}</p>
      {children}
    </div>
  );
}
