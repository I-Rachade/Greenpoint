"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CONTACT_EMAIL } from "@/lib/config";
import { LEGAL_PATHS } from "@/lib/legal/content";
import { useOnboarding, useTheme, type Theme } from "@/lib/prefs";
import { disableWebPush, enableWebPush, webPushState, type WebPushState } from "@/lib/web-push";
import { useApp } from "./app-provider";
import { BellIcon, GlobeIcon, HelpIcon, InfoIcon, MoonIcon, ShieldIcon, TicketIcon } from "./icons";
import { useI18n, type Locale } from "./i18n-provider";
import { MenuButton, MenuGroup, MenuItem, MenuLink, Segmented } from "./menu";
import { PageTitle } from "./page-title";

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "";

/**
 * Notices in this browser (web app, worker/web-push.ts). Shown to signed-in people where the
 * browser supports Web Push; the app on a phone signs up by itself (push-registrar.tsx).
 */
function WebPushRow() {
  const { backend, profile } = useApp();
  const { t } = useI18n();
  const s = t.ui.settings;
  const [state, setState] = useState<WebPushState>("unsupported");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void webPushState().then((next) => active && setState(next), () => undefined);
    return () => {
      active = false;
    };
  }, [profile?.id]);

  if (!profile || state === "unsupported") return null;
  const change = (want: "on" | "off") => {
    if (busy || want === state) return;
    setBusy(true);
    (want === "on" ? enableWebPush(backend, true) : disableWebPush(backend))
      .then(setState, () => setState("off"))
      .finally(() => setBusy(false));
  };
  return (
    <MenuItem icon={BellIcon} label={s.pushThisDevice}>
      {state === "blocked" ? (
        <span className="text-xs text-gp-muted dark:text-zinc-400">{s.pushBlocked}</span>
      ) : (
        <Segmented<"on" | "off">
          label={s.pushThisDevice}
          value={state === "on" ? "on" : "off"}
          onChange={change}
          options={[
            { value: "on", label: s.pushOn },
            { value: "off", label: s.pushOff },
          ]}
        />
      )}
    </MenuItem>
  );
}

/** Settings screen: language, appearance, notices in the browser, introduction, legal pages, version. */
export function SettingsScreen() {
  const { t, locale, setLocale } = useI18n();
  const router = useRouter();
  const [theme, setTheme] = useTheme();
  const [, setOnboarded] = useOnboarding();
  const s = t.ui.settings;

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 space-y-6 overflow-y-auto px-4 pb-6 pt-4">
      <PageTitle title={s.title} back={true} />

      <MenuGroup title={s.general}>
        <MenuItem icon={GlobeIcon} label={s.language}>
          <Segmented<Locale>
            label={s.language}
            value={locale}
            onChange={setLocale}
            options={[
              { value: "fr", label: "Français" },
              { value: "en", label: "English" },
            ]}
          />
        </MenuItem>
        <MenuItem icon={MoonIcon} label={s.appearance}>
          <Segmented<Theme>
            label={s.appearance}
            value={theme}
            onChange={setTheme}
            options={[
              { value: "system", label: s.themeSystem },
              { value: "light", label: s.themeLight },
              { value: "dark", label: s.themeDark },
            ]}
          />
        </MenuItem>
        <WebPushRow />
        <MenuButton
          icon={InfoIcon}
          label={s.replayIntro}
          onClick={() => {
            setOnboarded(false);
            router.push("/");
          }}
        />
      </MenuGroup>

      <MenuGroup title={s.legal}>
        <MenuLink href={LEGAL_PATHS.privacy} icon={ShieldIcon} label={t.legal.privacy} />
        <MenuLink href={LEGAL_PATHS.terms} icon={TicketIcon} label={t.legal.terms} />
        <MenuLink href={LEGAL_PATHS.notice} icon={InfoIcon} label={t.legal.notice} />
      </MenuGroup>

      <MenuGroup title={s.about}>
        <MenuLink href="/contact" icon={HelpIcon} label={t.ui.account.help} value={CONTACT_EMAIL} />
        <MenuItem icon={InfoIcon} label={s.version}>
          <span className="text-sm text-gp-muted">
            {t.appName} {APP_VERSION}
          </span>
        </MenuItem>
      </MenuGroup>
    </div>
  );
}
