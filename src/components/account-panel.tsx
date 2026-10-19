"use client";

import { MyCode } from "./charging/charging";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import type { CodeChannel } from "@/lib/backend/backend";
import { CONTACT_EMAIL } from "@/lib/config";
import { normalizeEmail } from "@/lib/contact";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { normalizeTogoPhone } from "@/lib/phone";
import { LEGAL_PATHS } from "@/lib/legal/content";
import { useApp } from "./app-provider";
import { useWalletShown } from "./header";
import { useAlerts } from "./use-alerts";
import { BellIcon, ChevronIcon, GearIcon, HeartIcon, HelpIcon, LeafIcon, LogoutIcon, PlugIcon, ScooterIcon, ShieldIcon, StoreIcon, TicketIcon, UserIcon, WalletIcon } from "./icons";
import { useI18n } from "./i18n-provider";
import { MenuButton, MenuGroup, MenuLink } from "./menu";
import { PageTitle } from "./page-title";
import { isStationStaff, runsOperator, worksAtStations } from "@/lib/operators";
import { ownsPoints } from "@/lib/point-partners";
import { managesFleet } from "@/lib/fleet";
import { isDriverAccount } from "@/lib/drivers";
import { isMerchantAccount } from "@/lib/merchants";
import { MerchantInvitesCard } from "./merchants/merchant-invites";
import { StaffInvitesCard } from "./staff-invites";

const CODE_LENGTH = 6;
const digits = (value: string) => value.replace(/\D/g, "").slice(0, CODE_LENGTH);

const input =
  "w-full rounded-xl border border-gp-border bg-gp-surface px-3 py-2.5 text-base dark:border-white/15";
const codeInput = `${input} tracking-[0.4em]`;
const link = "text-sm text-gp-green-dark underline disabled:opacity-50 dark:text-gp-green";

/**
 * "My account": the phone number and e-mail address of the account (the missing
 * one can be added), and self-service deletion confirmed by a code sent by SMS
 * or e-mail. Also the public page Google Play links to
 * (app.poinderecharge.com/compte): logged-out visitors learn how to delete.
 */
export function AccountPanel() {
  const { t } = useI18n();
  const { backend, profile, ready, features } = useApp();
  const walletShown = useWalletShown();
  const driver = isDriverAccount(profile);
  // Fleet managers are not customers either (plan phase 7): no customer code, reservations or wallet.
  const fleet = profile?.role === "fleet_manager";
  // Shop accounts (merchant and employees) are not customers either (R11): no code, greenpoints, reservations or wallet.
  const merchant = isMerchantAccount(profile);
  const { unread } = useAlerts();
  const [deleted, setDeleted] = useState(false);
  const a = t.ui.account;

  if (!ready) return <p className="p-6 text-sm text-gp-muted">{t.loading}</p>;

  const name = profile?.fullName || profile?.phone || profile?.email || a.guest;
  const initials = profile?.fullName
    ? profile.fullName
        .split(/\s+/)
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : null;

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 space-y-6 overflow-y-auto px-4 pb-6 pt-4">
      <PageTitle title={t.account.title} />

      {/* Profile card */}
      <div className="flex items-center gap-4 rounded-2xl bg-gp-forest p-4 text-white shadow-sm">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gp-green text-lg font-bold text-gp-forest">
          {initials ?? <UserIcon size={28} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-semibold">{deleted ? a.guest : name}</p>
          <p className="truncate text-sm text-white/70">{profile && !deleted ? t.roles[profile.role] : a.guestText}</p>
        </div>
        {!profile && (
          <Link href="/login" className="rounded-full bg-gp-green px-4 py-2 text-sm font-semibold text-gp-forest">
            {t.nav.login}
          </Link>
        )}
      </div>

      {deleted ? (
        <p className="rounded-2xl bg-gp-green/10 p-4 text-sm">{t.account.deleted}</p>
      ) : profile ? (
        <>
          <section className="space-y-2">
            <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-gp-muted">{a.details}</h2>
            <div className="space-y-3 rounded-2xl border border-gp-border bg-gp-surface p-4 shadow-sm dark:border-white/10">
              <ContactRow kind="phone" value={profile.phone} />
              <ContactRow kind="email" value={profile.email} />
            </div>
          </section>

          {/* The customer's own code (swaps, wallet); drivers show their driver QR on /chauffeur instead. */}
          {(profile.phone || profile.email) && !driver && !fleet && !merchant && <MyCode contact={(profile.phone ?? profile.email)!} />}

          {/* A customer invited into a shop's team accepts or declines here (or on /marchand). */}
          <MerchantInvitesCard />
          {/* Someone an owner invited to work at a station accepts or declines here (migration 0050). */}
          <StaffInvitesCard />

          <MenuGroup title={a.menu} top={isStationStaff(profile) || driver || fleet || merchant ? undefined : <GreenpointHighlight />}>
            {driver && <MenuLink href="/chauffeur" icon={ScooterIcon} label={t.nav.driver} />}
            {merchant && <MenuLink href="/marchand" icon={StoreIcon} label={t.merchant.title} />}
            <MenuLink href="/favoris" icon={HeartIcon} label={t.ui.tabs.favorites} />
            <MenuLink href="/notifications" icon={BellIcon} label={t.ui.tabs.alerts} value={unread > 0 ? unread : undefined} />
            {/* Drivers are never customers (plan phase 5): no reservations, wallet or greenpoints. */}
            {!driver && !fleet && !merchant && <MenuLink href="/reservations" icon={TicketIcon} label={t.nav.reservations} />}
            {walletShown && features.wallet && !fleet && !merchant && <MenuLink href="/portefeuille" icon={WalletIcon} label={t.nav.wallet} />}
            {/* Customers apply once the driver module is on, and keep their application page. */}
            {profile.role === "customer" && features.parcels && (features.drivers || !!profile.driverStatus) && (
              <MenuLink href="/chauffeur" icon={ScooterIcon} label={profile.driverStatus ? t.nav.driver : t.account.becomeDriver} />
            )}
            {features.parcels && managesFleet(profile) && <MenuLink href="/flotte" icon={ScooterIcon} label={t.nav.fleet} />}
            {runsOperator(profile) && <MenuLink href="/exploitant" icon={StoreIcon} label={t.nav.owner} />}
            {ownsPoints(profile) && <MenuLink href="/proprietaire" icon={PlugIcon} label={t.nav.points} />}
            {worksAtStations(profile) && <MenuLink href="/operator" icon={StoreIcon} label={t.ui.tabs.myStation} />}
            {profile.role === "admin" && <MenuLink href="/admin" icon={ShieldIcon} label={t.nav.admin} />}
          </MenuGroup>

          <MenuGroup>
            <MenuLink href="/parametres" icon={GearIcon} label={a.settings} />
            <MenuLink href={LEGAL_PATHS.privacy} icon={ShieldIcon} label={a.privacy} />
            <MenuLink href="/contact" icon={HelpIcon} label={a.help} />
            <MenuButton icon={LogoutIcon} label={t.nav.logout} onClick={() => void backend.signOut()} danger />
          </MenuGroup>

          <section className="space-y-2">
            <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-gp-muted">{a.danger}</h2>
            <DeleteAccount phone={profile.phone} email={profile.email} onDeleted={() => setDeleted(true)} />
          </section>
        </>
      ) : (
        <>
          <MenuGroup>
            <MenuLink href="/favoris" icon={HeartIcon} label={t.ui.tabs.favorites} />
            <MenuLink href="/parametres" icon={GearIcon} label={a.settings} />
            <MenuLink href={LEGAL_PATHS.privacy} icon={ShieldIcon} label={a.privacy} />
            <MenuLink href="/contact" icon={HelpIcon} label={a.help} />
          </MenuGroup>
          <section className="space-y-2 rounded-2xl border border-gp-border bg-gp-surface p-4 dark:border-white/10">
            <h2 className="font-semibold">{t.account.deleteTitle}</h2>
            <p className="text-sm text-gp-muted">
              {format(t.account.loggedOutText, { email: CONTACT_EMAIL })}
            </p>
          </section>
        </>
      )}
    </div>
  );
}

/** Shows the phone number or e-mail address, or a small form to add it (confirmed by a code). */
/** greenpoint first in "Mon espace", standing out: the leaf, the points and the level. */
function GreenpointHighlight() {
  const { t } = useI18n();
  const { backend } = useApp();
  const { data } = useLiveQuery(() => backend.myGreenpoint());
  return (
    <Link
      href="/greenpoint"
      className="flex items-center gap-4 rounded-2xl bg-gradient-to-br from-gp-green to-gp-green-dark p-4 text-white shadow-md active:scale-[0.99]"
    >
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-gp-green-dark">
        <LeafIcon size={26} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-lg font-bold leading-tight">{t.nav.greenpoint}</span>
        <span className="block text-sm text-white/85">
          {data
            ? format(t.ui.account.greenpointPoints, { points: data.points, level: t.greenpoint.levels[data.level] })
            : t.ui.account.greenpointHint}
        </span>
      </span>
      <ChevronIcon size={20} />
    </Link>
  );
}

function ContactRow({ kind, value }: { kind: "phone" | "email"; value: string | null }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const [open, setOpen] = useState(false);
  const [raw, setRaw] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = kind === "phone" ? t.account.phone : t.account.email;

  function reset() {
    setOpen(false);
    setRaw("");
    setSentTo(null);
    setCode("");
    setError(null);
  }

  function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    action()
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setBusy(false));
  }

  function send(e: FormEvent) {
    e.preventDefault();
    const contact = kind === "phone" ? normalizeTogoPhone(raw) : normalizeEmail(raw);
    if (!contact) {
      setError(kind === "phone" ? t.login.invalidPhone : t.login.invalidEmail);
      return;
    }
    run(async () => {
      await backend.sendContactCode(contact);
      setSentTo(contact);
    });
  }

  function confirm(e: FormEvent) {
    e.preventDefault();
    if (!sentTo) return;
    // The profile updates through onAuthChange; this row then shows the value.
    run(async () => {
      await backend.addContact(sentTo, code);
      reset();
    });
  }

  if (value) {
    return (
      <p className="text-sm">
        <span className="text-gp-muted">{label} : </span>
        <span className="font-medium break-all">{value}</span>
      </p>
    );
  }
  if (!open) {
    return (
      <button type="button" className={link} onClick={() => setOpen(true)}>
        {kind === "phone" ? t.account.addPhone : t.account.addEmail}
      </button>
    );
  }
  return (
    <form onSubmit={sentTo ? confirm : send} className="space-y-2 rounded-lg border border-black/10 p-3 dark:border-white/15">
      <p className="text-sm font-medium">{kind === "phone" ? t.account.addPhone : t.account.addEmail}</p>
      <p className="text-xs text-gp-muted">{t.account.addHint}</p>
      {!sentTo ? (
        <input
          className={input}
          type={kind === "phone" ? "tel" : "email"}
          inputMode={kind === "phone" ? "tel" : "email"}
          autoComplete={kind === "phone" ? "tel-national" : "email"}
          placeholder={kind === "phone" ? t.account.phonePlaceholder : t.account.emailPlaceholder}
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          required
        />
      ) : (
        <>
          <p className="text-sm">
            {format(kind === "email" ? t.login.codeSentEmail : t.login.codeSentSms, { contact: sentTo })}
          </p>
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t.account.code}</span>
            <input
              className={codeInput}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH}
              value={code}
              onChange={(e) => setCode(digits(e.target.value))}
              required
            />
          </label>
        </>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={busy || (!!sentTo && code.length < CODE_LENGTH)}
          className="rounded-full bg-gp-green-dark px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {sentTo ? t.account.add : t.account.sendCode}
        </button>
        <button type="button" className={link} onClick={reset}>
          {t.account.cancel}
        </button>
      </div>
    </form>
  );
}

/** Deletion: a code goes by SMS or e-mail (the person picks when the account has both), then confirms. */
function DeleteAccount({
  phone,
  email,
  onDeleted,
}: {
  phone: string | null;
  email: string | null;
  onDeleted: () => void;
}) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const [channel, setChannel] = useState<CodeChannel>(phone ? "sms" : "email");
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const channels: { value: CodeChannel; label: string }[] = [];
  if (phone) channels.push({ value: "sms", label: format(t.account.deleteBySms, { phone }) });
  if (email) channels.push({ value: "email", label: format(t.account.deleteByEmail, { email }) });

  function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    action()
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setBusy(false));
  }

  function send(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      await backend.sendDeleteCode(channel);
      setSent(true);
    });
  }

  function remove(e: FormEvent) {
    e.preventDefault();
    run(async () => {
      await backend.deleteAccount(channel, code);
      onDeleted();
    });
  }

  return (
    <form onSubmit={sent ? remove : send} className="space-y-3 rounded-2xl border border-red-200 bg-gp-surface p-4 dark:border-red-900">
      <h2 className="font-semibold text-red-700 dark:text-red-400">{t.account.deleteTitle}</h2>
      <p className="text-sm text-gp-muted">{t.account.deleteText}</p>

      <fieldset className="space-y-1" disabled={sent}>
        <legend className="text-sm font-medium">{t.account.deleteChannel}</legend>
        {channels.map((c) => (
          <label key={c.value} className="flex items-center gap-2 text-sm break-all">
            <input
              type="radio"
              name="delete-channel"
              value={c.value}
              checked={channel === c.value}
              onChange={() => setChannel(c.value)}
            />
            {c.label}
          </label>
        ))}
      </fieldset>

      {sent && (
        <>
          <p className="text-sm">
            {format(channel === "email" ? t.login.codeSentEmail : t.login.codeSentSms, {
              contact: (channel === "email" ? email : phone) ?? "",
            })}
          </p>
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t.account.deleteCode}</span>
            <input
              className={codeInput}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH}
              value={code}
              onChange={(e) => setCode(digits(e.target.value))}
              required
            />
          </label>
        </>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {sent ? (
        <button
          type="submit"
          disabled={busy || code.length < CODE_LENGTH}
          className="w-full rounded-full bg-red-600 px-4 py-2 font-medium text-white disabled:opacity-50"
        >
          {t.account.deleteButton}
        </button>
      ) : (
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-full border border-red-600 px-4 py-2 font-medium text-red-700 disabled:opacity-50 dark:text-red-400"
        >
          {t.account.sendCode}
        </button>
      )}
    </form>
  );
}
