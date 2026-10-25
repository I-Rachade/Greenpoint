"use client";

import { useState, type ComponentType, type SVGProps } from "react";
import type { DeliveryJob } from "@shared/drivers";
import { useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { isMerchantAccount, type MerchantStatus, type MerchantView } from "@shared/merchants";
import { useApp } from "../app-provider";
import { useI18n } from "../i18n-provider";
import { BoxPlusIcon, ChartIcon, GridIcon, HistoryIcon, ListIcon, PulseIcon, ScooterIcon, StoreIcon, TicketIcon, UsersIcon } from "../icons";
import { LoadFailed, StaleNotice } from "../load-state";
import { Badge, SkeletonCard, type BadgeTone } from "../ui";
import { MerchantActivityLog, MerchantBookings, MerchantLive, MerchantOverview, MerchantStatistics } from "./merchant-backoffice";
import { MerchantBook, MerchantTrips } from "./merchant-book";
import { MerchantDrivers } from "./merchant-drivers";
import { NotAMerchant } from "./merchant-invites";
import { MerchantShop } from "./merchant-shop";
import { MerchantTeam } from "./merchant-team";

/** Every member books and follows the shop's trips. */
const MEMBER_TABS = ["book", "trips"] as const;
/** The merchant (owner) also has the backoffice. */
const OWNER_TABS = ["overview", "book", "trips", "live", "bookings", "stats", "activity", "team", "drivers", "shop"] as const;
type Tab = (typeof OWNER_TABS)[number];

const TAB_ICON: Record<Tab, ComponentType<SVGProps<SVGSVGElement> & { size?: number }>> = {
  overview: GridIcon,
  book: BoxPlusIcon,
  trips: ListIcon,
  live: PulseIcon,
  bookings: TicketIcon,
  stats: ChartIcon,
  activity: HistoryIcon,
  team: UsersIcon,
  drivers: ScooterIcon,
  shop: StoreIcon,
};

const STATUS_TONE: Record<MerchantStatus, BadgeTone> = { pending: "amber", approved: "green", rejected: "red", suspended: "red" };

/**
 * /marchand (planung/marchand.md): a shop account. Every member books courier, pickup and
 * ride trips for the shop and follows all of its trips; the merchant also has the
 * backoffice (overview, live, bookings log, statistics, activity, team, drivers, shop). Anyone else
 * sees their shop invites (customers) or nothing.
 */
export function MerchantPanel() {
  const { profile } = useApp();
  if (!isMerchantAccount(profile)) return <NotAMerchant />;
  return <MerchantHome />;
}

function MerchantHome() {
  const { t } = useI18n();
  const m = t.merchant;
  const { backend } = useApp();
  const { data: view, error, reload } = useLiveQuery(() => backend.merchantView());
  const [chosen, setChosen] = useState<Tab | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  if (!view) {
    return error ? (
      <LoadFailed error={error} onRetry={reload} />
    ) : (
      <div className="mx-auto w-full max-w-3xl space-y-3 p-4" aria-busy>
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  const shop = view.merchant;
  const approved = shop.status === "approved";
  const tabs: readonly Tab[] = view.isOwner ? OWNER_TABS : MEMBER_TABS;
  const tab: Tab = chosen && tabs.includes(chosen) ? chosen : view.isOwner ? "overview" : "book";
  const booked = (job: DeliveryJob) => {
    setFocus(job.id);
    setChosen("trips");
  };

  const heading = (
    <div>
      {approved && <div className="hidden text-xs font-medium text-gp-muted lg:block">{`${shop.name} / ${m.tabs[tab]}`}</div>}
      <h1 className="flex flex-wrap items-center gap-2 font-heading text-2xl font-semibold">
        <span className={approved ? "lg:hidden" : ""}>{shop.name}</span>
        {approved && <span className="hidden lg:inline">{m.tabs[tab]}</span>}
        {!approved && <Badge tone={STATUS_TONE[shop.status]}>{m.status[shop.status]}</Badge>}
      </h1>
      <p className="mt-1 text-sm text-gp-muted">
        {format(view.isOwner ? m.introOwner : m.introEmployee, { shop: shop.name, role: view.isOwner ? m.roleOwner : m.roleEmployee })}
      </p>
    </div>
  );

  if (shop.status !== "approved") {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl space-y-4 p-4 sm:p-6">
          {heading}
          <StaleNotice error={error} onRetry={reload} />
          <StatusNotice status={shop.status} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      {/* Wide screens: the sections as a menu in a dark sidebar, as in the owner backoffice. */}
      {view.isOwner && (
        <aside className="hidden w-60 shrink-0 flex-col gap-1 overflow-y-auto bg-gp-forest px-3 py-5 text-white/80 lg:flex dark:border-r dark:border-white/10 dark:bg-black/30">
          <div className="truncate px-3 pb-3 text-sm font-semibold text-white">{shop.name}</div>
          <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-white/45">{m.title}</div>
          <div role="tablist" aria-label={m.title} aria-orientation="vertical" className="space-y-0.5 text-sm">
            {tabs.map((k) => {
              const Icon = TAB_ICON[k];
              return (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={tab === k}
                  aria-controls="merchant-tabpanel"
                  onClick={() => setChosen(k)}
                  className={`flex min-h-10 w-full items-center gap-3 rounded-lg px-3 font-medium transition-colors ${
                    tab === k ? "bg-gp-green text-gp-forest" : "hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <Icon size={18} />
                  {m.tabs[k]}
                </button>
              );
            })}
          </div>
        </aside>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-6 lg:px-8">
          {heading}
          <StaleNotice error={error} onRetry={reload} />
          {/* Phones and tablets (and employees everywhere): the sections as tabs on top. */}
          <div role="tablist" aria-label={m.title} className={`flex gap-1 overflow-x-auto border-b border-gp-border pb-2 ${view.isOwner ? "lg:hidden" : ""}`}>
            {tabs.map((k) => (
              <button
                key={k}
                id={`merchant-tab-${k}`}
                type="button"
                role="tab"
                aria-selected={tab === k}
                aria-controls="merchant-tabpanel"
                onClick={() => setChosen(k)}
                className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-4 text-sm font-semibold ${
                  tab === k ? "bg-gp-forest text-white" : "text-zinc-700 hover:bg-black/5 dark:text-zinc-300 dark:hover:bg-white/10"
                }`}
              >
                {m.tabs[k]}
              </button>
            ))}
          </div>
          <div id="merchant-tabpanel" role="tabpanel" aria-labelledby={`merchant-tab-${tab}`} className="space-y-4">
            <TabContent tab={tab} view={view} focus={focus} onBooked={booked} />
          </div>
        </div>
      </div>
    </div>
  );
}

function TabContent({ tab, view, focus, onBooked }: { tab: Tab; view: MerchantView; focus: string | null; onBooked: (job: DeliveryJob) => void }) {
  switch (tab) {
    case "book":
      return <MerchantBook shop={view.merchant} addresses={view.addresses} onBooked={onBooked} />;
    case "trips":
      return <MerchantTrips live={view.live} focus={focus} />;
    case "overview":
      return <MerchantOverview view={view} />;
    case "live":
      return <MerchantLive view={view} />;
    case "bookings":
      return <MerchantBookings view={view} />;
    case "stats":
      return <MerchantStatistics view={view} />;
    case "activity":
      return <MerchantActivityLog />;
    case "team":
      return <MerchantTeam view={view} />;
    case "drivers":
      return <MerchantDrivers view={view} />;
    case "shop":
      return <MerchantShop shop={view.merchant} addresses={view.addresses} />;
  }
}

/** Pending, rejected or suspended: why nothing can be booked; Map and Stations still work. */
function StatusNotice({ status }: { status: Exclude<MerchantStatus, "approved"> }) {
  const { t } = useI18n();
  const m = t.merchant;
  const text = { pending: [m.pendingTitle, m.pendingText], rejected: [m.rejectedTitle, m.rejectedText], suspended: [m.suspendedTitle, m.suspendedText] }[status];
  return (
    <div
      role="status"
      className={`space-y-2 rounded-2xl p-4 text-sm ${
        status === "pending" ? "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100" : "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-100"
      }`}
    >
      <h2 className="font-semibold">{text[0]}</h2>
      <p>{text[1]}</p>
      <p>{m.mapStillWorks}</p>
    </div>
  );
}
