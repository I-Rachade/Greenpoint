"use client";

import { useRouter } from "next/navigation";
import { Fragment, useEffect, useState, type FormEvent } from "react";
import { HOSTED_DEMO } from "@/lib/backend";
import { CONTACT_EMAIL } from "@/lib/config";
import { useErrorMessage } from "@/lib/hooks";
import { LEGAL_PATHS } from "@/lib/legal/content";
import { parseContact, type Contact } from "@/lib/contact";
import { format } from "@/lib/i18n/format";
import { PIN_LENGTH } from "@/lib/pin";
import type { Profile, UserRole } from "@/lib/types";
import { useApp } from "./app-provider";
import { useI18n } from "./i18n-provider";
import { LegalLinks } from "./legal-links";
import { OtpInput } from "./otp-input";

// On the public site the demo only offers the rider view (anyone could otherwise "log in" as admin).
const DEMO_ROLES: UserRole[] = HOSTED_DEMO ? ["rider"] : ["rider", "operator", "admin"];

/**
 * "pin": everyday login with phone number or e-mail address, and PIN.
 * "register" / "reset": the number or address is confirmed by a code (SMS or
 * e-mail) and a PIN is chosen (same steps for a new account and a forgotten PIN;
 * only the title differs).
 */
type Mode = "pin" | "register" | "reset";

const digits = (value: string, max: number) => value.replace(/\D/g, "").slice(0, max);

export function LoginForm() {
  const { t } = useI18n();
  const { backend } = useApp();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [mode, setMode] = useState<Mode>("pin");
  const [contactInput, setContactInput] = useState("");
  /** Number or address the code was sent to; set once the code is on its way. */
  const [codeSentTo, setCodeSentTo] = useState<Contact | null>(null);
  const [code, setCode] = useState("");
  const [pin, setPin] = useState("");
  const [pinConfirm, setPinConfirm] = useState("");
  const [demoRole, setDemoRole] = useState<UserRole>("rider");
  /** New accounts must accept the terms and the privacy policy before the SMS code is sent. */
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function switchMode(next: Mode) {
    setMode(next);
    setCodeSentTo(null);
    setCode("");
    setPin("");
    setPinConfirm("");
    setAccepted(false);
    setError(null);
  }

  function contactOrError(): Contact | null {
    const contact = parseContact(contactInput);
    if (!contact) setError(t.login.invalidContact);
    return contact;
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function done(profile: Profile) {
    // Next.js keeps this page's state for back navigation, so start fresh next time.
    setContactInput("");
    switchMode("pin");
    router.push(profile.role === "operator" ? "/operator" : profile.role === "admin" ? "/admin" : "/");
  }

  function signIn(e: FormEvent) {
    e.preventDefault();
    const contact = contactOrError();
    if (!contact) return;
    void run(async () => done(await backend.signIn(contact.value, pin, demoRole)));
  }

  function sendCode(e: FormEvent) {
    e.preventDefault();
    if (mode === "register" && !accepted) {
      setError(t.legal.mustAccept);
      return;
    }
    const contact = contactOrError();
    if (!contact) return;
    void run(async () => {
      await backend.sendCode(contact.value);
      setCodeSentTo(contact);
    });
  }

  function register(e: FormEvent) {
    e.preventDefault();
    if (!codeSentTo) return;
    if (pin !== pinConfirm) {
      setError(t.login.pinMismatch);
      return;
    }
    void run(async () => done(await backend.register(codeSentTo.value, code, pin, demoRole)));
  }

  const input =
    "w-full rounded-xl border border-gp-border bg-gp-surface px-4 py-3 text-base outline-none focus:border-gp-green-dark dark:border-white/15";
  const button = "w-full rounded-full bg-gp-green-dark px-4 py-3 font-semibold text-white shadow-sm disabled:opacity-50";
  const link = "w-full text-sm font-medium text-gp-green-dark dark:text-gp-green";

  // One field for both: anything with "@" is an e-mail address (see lib/contact.ts).
  const contactField = (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{t.login.contact}</span>
      <input
        className={input}
        type="text"
        inputMode="email"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        placeholder={t.login.contactPlaceholder}
        value={contactInput}
        onChange={(e) => setContactInput(e.target.value)}
        required
      />
    </label>
  );

  const pinField = (label: string, value: string, onChange: (v: string) => void, autoComplete: string) => (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      <input
        className={`${input} tracking-[0.4em]`}
        type="password"
        inputMode="numeric"
        autoComplete={autoComplete}
        maxLength={PIN_LENGTH}
        value={value}
        onChange={(e) => onChange(digits(e.target.value, PIN_LENGTH))}
        required
      />
    </label>
  );

  const legalLink = (href: string, label: string) => (
    // A new tab keeps the number typed so far.
    <a href={href} target="_blank" rel="noopener" className="font-medium text-gp-green-dark underline dark:text-gp-green">
      {label}
    </a>
  );
  const acceptText = t.legal.accept.split(/(\{terms\}|\{privacy\})/).map((part, i) => (
    <Fragment key={i}>
      {part === "{terms}"
        ? legalLink(LEGAL_PATHS.terms, t.legal.acceptTerms)
        : part === "{privacy}"
          ? legalLink(LEGAL_PATHS.privacy, t.legal.acceptPrivacy)
          : part}
    </Fragment>
  ));

  const roleField = backend.mode === "demo" && DEMO_ROLES.length > 1 && (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{t.demo.role}</span>
      <select className={input} value={demoRole} onChange={(e) => setDemoRole(e.target.value as UserRole)}>
        {DEMO_ROLES.map((r) => (
          <option key={r} value={r}>
            {t.roles[r]}
          </option>
        ))}
      </select>
    </label>
  );

  const tab = (target: Mode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === target}
      onClick={() => mode !== target && switchMode(target)}
      className={`flex-1 rounded-full py-2 text-sm font-semibold transition-colors ${
        mode === target ? "bg-gp-surface text-gp-forest shadow-sm dark:text-zinc-50" : "text-gp-muted dark:text-zinc-400"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      {/* Brand band at the top, like the splash screen. */}
      <div className="flex flex-col items-center gap-3 bg-gp-forest px-6 pb-14 pt-10 text-center text-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo.svg" alt="" width={64} height={64} className="h-16 w-16" />
        <h1 className="text-2xl font-bold">
          {codeSentTo ? t.ui.auth.otpTitle : mode === "reset" ? t.login.resetTitle : t.ui.auth.welcome}
        </h1>
        <p className="max-w-xs text-sm text-white/75">
          {codeSentTo
            ? format(codeSentTo.kind === "email" ? t.login.codeSentEmail : t.login.codeSentSms, { contact: codeSentTo.value })
            : mode === "pin"
              ? t.ui.auth.welcomeText
              : t.login.codeIntro}
        </p>
      </div>

      <div className="mx-auto -mt-8 w-full max-w-sm flex-1 space-y-4 rounded-t-3xl bg-background px-6 pb-8 pt-6">
        {!codeSentTo && mode !== "reset" && (
          <div role="tablist" className="flex rounded-full bg-gp-border/60 p-1 dark:bg-white/10">
            {tab("pin", t.ui.auth.tabLogin)}
            {tab("register", t.ui.auth.tabRegister)}
          </div>
        )}

        {mode === "pin" ? (
          <form onSubmit={signIn} className="space-y-4">
            {contactField}
            {pinField(t.login.pin, pin, setPin, "current-password")}
            {roleField}
            <div className="text-right">
              <button type="button" className="text-sm font-medium text-gp-green-dark dark:text-gp-green" onClick={() => switchMode("reset")}>
                {t.login.forgotPin}
              </button>
            </div>
            <button type="submit" className={button} disabled={busy || pin.length < PIN_LENGTH}>
              {t.login.signIn}
            </button>
          </form>
        ) : !codeSentTo ? (
          <form onSubmit={sendCode} className="space-y-4">
            {contactField}
            {mode === "register" && (
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 shrink-0 accent-gp-green-dark"
                  checked={accepted}
                  onChange={(e) => setAccepted(e.target.checked)}
                  required
                />
                <span>{acceptText}</span>
              </label>
            )}
            <button type="submit" className={button} disabled={busy || (mode === "register" && !accepted)}>
              {t.login.sendCode}
            </button>
            {mode === "reset" && (
              <button type="button" className={link} onClick={() => switchMode("pin")}>
                {t.login.backToLogin}
              </button>
            )}
          </form>
        ) : (
          <form onSubmit={register} className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">{t.ui.auth.otpHint}</p>
              <OtpInput length={6} value={code} onChange={setCode} label={t.login.code} autoFocus />
              <ResendCode onResend={() => backend.sendCode(codeSentTo.value)} />
            </div>
            <h2 className="pt-2 text-base font-semibold">{t.ui.auth.choosePin}</h2>
            {pinField(t.login.newPin, pin, setPin, "new-password")}
            {pinField(t.login.confirmPin, pinConfirm, setPinConfirm, "new-password")}
            <p className="text-xs text-gp-muted">{t.login.pinHint}</p>
            {roleField}
            <button
              type="submit"
              className={button}
              disabled={busy || code.length < 6 || pin.length < PIN_LENGTH || pinConfirm.length < PIN_LENGTH}
            >
              {t.login.confirm}
            </button>
            <button
              type="button"
              className={link}
              onClick={() => {
                setCodeSentTo(null);
                setCode("");
              }}
            >
              {t.login.changeContact}
            </button>
          </form>
        )}

        {error && (
          <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </p>
        )}
        <p className="pt-4 text-center text-xs text-zinc-500">
          <a href={`mailto:${CONTACT_EMAIL}`} className="hover:underline">
            {CONTACT_EMAIL}
          </a>
        </p>
        <LegalLinks />
      </div>
    </div>
  );
}

/** Seconds before a new code may be asked for. */
const RESEND_SECONDS = 30;

/** "Resend code" link with a countdown, under the code boxes. */
function ResendCode({ onResend }: { onResend: () => Promise<void> }) {
  const { t } = useI18n();
  const errorMessage = useErrorMessage();
  const [left, setLeft] = useState(RESEND_SECONDS);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (left <= 0) return;
    const id = window.setTimeout(() => setLeft(left - 1), 1000);
    return () => window.clearTimeout(id);
  }, [left]);

  return (
    <p className="flex flex-wrap items-center justify-between gap-2 text-sm">
      {left > 0 ? (
        <span className="text-gp-muted">{format(t.ui.auth.resendIn, { s: left })}</span>
      ) : (
        <button
          type="button"
          className="font-medium text-gp-green-dark dark:text-gp-green"
          onClick={() => {
            setLeft(RESEND_SECONDS);
            setNote(null);
            onResend().then(
              () => setNote(t.ui.auth.resent),
              (err) => setNote(errorMessage(err)),
            );
          }}
        >
          {t.ui.auth.resend}
        </button>
      )}
      {note && <span className="text-gp-muted">{note}</span>}
    </p>
  );
}
