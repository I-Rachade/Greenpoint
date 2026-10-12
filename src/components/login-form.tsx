"use client";

import { useRouter } from "next/navigation";
import { Fragment, useState, type FormEvent } from "react";
import { HOSTED_DEMO } from "@/lib/backend";
import { CONTACT_EMAIL } from "@/lib/config";
import { useErrorMessage } from "@/lib/hooks";
import { LEGAL_PATHS } from "@/lib/legal/content";
import { normalizeTogoPhone } from "@/lib/phone";
import { PIN_LENGTH } from "@/lib/pin";
import type { Profile, UserRole } from "@/lib/types";
import { useApp } from "./app-provider";
import { useI18n } from "./i18n-provider";
import { LegalLinks } from "./legal-links";

// On the public site the demo only offers the rider view (anyone could otherwise "log in" as admin).
const DEMO_ROLES: UserRole[] = HOSTED_DEMO ? ["rider"] : ["rider", "operator", "admin"];

/**
 * "pin": everyday login with number and PIN.
 * "register" / "reset": the number is confirmed by SMS code and a PIN is chosen
 * (same steps for a new account and a forgotten PIN; only the title differs).
 */
type Mode = "pin" | "register" | "reset";

const digits = (value: string, max: number) => value.replace(/\D/g, "").slice(0, max);

export function LoginForm() {
  const { t } = useI18n();
  const { backend } = useApp();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [mode, setMode] = useState<Mode>("pin");
  const [phoneInput, setPhoneInput] = useState("");
  /** Number the SMS code was sent to; set once the code is on its way. */
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
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

  function phoneOrError(): string | null {
    const normalized = normalizeTogoPhone(phoneInput);
    if (!normalized) setError(t.login.invalidPhone);
    return normalized;
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
    setPhoneInput("");
    switchMode("pin");
    router.push(profile.role === "operator" ? "/operator" : profile.role === "admin" ? "/admin" : "/");
  }

  function signIn(e: FormEvent) {
    e.preventDefault();
    const phone = phoneOrError();
    if (!phone) return;
    void run(async () => done(await backend.signIn(phone, pin, demoRole)));
  }

  function sendCode(e: FormEvent) {
    e.preventDefault();
    if (mode === "register" && !accepted) {
      setError(t.legal.mustAccept);
      return;
    }
    const phone = phoneOrError();
    if (!phone) return;
    void run(async () => {
      await backend.sendCode(phone);
      setCodeSentTo(phone);
    });
  }

  function register(e: FormEvent) {
    e.preventDefault();
    if (!codeSentTo) return;
    if (pin !== pinConfirm) {
      setError(t.login.pinMismatch);
      return;
    }
    void run(async () => done(await backend.register(codeSentTo, code, pin, demoRole)));
  }

  const input =
    "w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-base dark:border-white/20 dark:bg-zinc-900";
  const button = "w-full rounded-full bg-gp-green-dark px-4 py-2 font-medium text-white disabled:opacity-50";
  const link = "w-full text-sm text-zinc-600 underline dark:text-zinc-400";

  const phoneField = (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{t.login.phone}</span>
      <div className="flex items-center gap-2">
        <span className="rounded-lg bg-zinc-100 px-3 py-2 dark:bg-zinc-800">+228</span>
        <input
          className={input}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder={t.login.phonePlaceholder}
          value={phoneInput}
          onChange={(e) => setPhoneInput(e.target.value)}
          required
        />
      </div>
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

  return (
    <div className="mx-auto w-full max-w-sm space-y-4 p-6">
      <h1 className="text-2xl font-semibold">
        {mode === "pin" ? t.login.title : mode === "register" ? t.login.registerTitle : t.login.resetTitle}
      </h1>

      {mode === "pin" ? (
        <form onSubmit={signIn} className="space-y-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.login.intro}</p>
          {phoneField}
          {pinField(t.login.pin, pin, setPin, "current-password")}
          {roleField}
          <button type="submit" className={button} disabled={busy || pin.length < PIN_LENGTH}>
            {t.login.signIn}
          </button>
          <button type="button" className={link} onClick={() => switchMode("register")}>
            {t.login.noAccount}
          </button>
          <button type="button" className={link} onClick={() => switchMode("reset")}>
            {t.login.forgotPin}
          </button>
        </form>
      ) : !codeSentTo ? (
        <form onSubmit={sendCode} className="space-y-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.login.smsIntro}</p>
          {phoneField}
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
          <button type="button" className={link} onClick={() => switchMode("pin")}>
            {t.login.backToLogin}
          </button>
        </form>
      ) : (
        <form onSubmit={register} className="space-y-3">
          <p className="text-sm font-medium">{codeSentTo}</p>
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t.login.code}</span>
            <input
              className={`${input} tracking-[0.4em]`}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(digits(e.target.value, 6))}
              required
            />
          </label>
          {pinField(t.login.newPin, pin, setPin, "new-password")}
          {pinField(t.login.confirmPin, pinConfirm, setPinConfirm, "new-password")}
          <p className="text-xs text-zinc-500">{t.login.pinHint}</p>
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
            {t.login.changeNumber}
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="text-sm text-red-600">
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
  );
}
