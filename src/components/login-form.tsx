"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { HOSTED_DEMO } from "@/lib/backend";
import { CONTACT_EMAIL } from "@/lib/config";
import { useErrorMessage } from "@/lib/hooks";
import { normalizeTogoPhone } from "@/lib/phone";
import type { UserRole } from "@/lib/types";
import { useApp } from "./app-provider";
import { useI18n } from "./i18n-provider";

// On the public site the demo only offers the rider view (anyone could otherwise "log in" as admin).
const DEMO_ROLES: UserRole[] = HOSTED_DEMO ? ["rider"] : ["rider", "operator", "admin"];

export function LoginForm() {
  const { t } = useI18n();
  const { backend } = useApp();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [phoneInput, setPhoneInput] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [demoRole, setDemoRole] = useState<UserRole>("rider");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizeTogoPhone(phoneInput);
    if (!normalized) {
      setError(t.login.invalidPhone);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await backend.sendCode(normalized);
      setPhone(normalized);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!phone) return;
    setBusy(true);
    setError(null);
    try {
      const profile = await backend.verifyCode(phone, code, demoRole);
      // Next.js keeps this page's state for back navigation, so start fresh next time.
      setPhone(null);
      setPhoneInput("");
      setCode("");
      setBusy(false);
      router.push(profile.role === "operator" ? "/operator" : profile.role === "admin" ? "/admin" : "/");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  const input =
    "w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-base dark:border-white/20 dark:bg-zinc-900";
  const button = "w-full rounded-full bg-gp-green-dark px-4 py-2 font-medium text-white disabled:opacity-50";

  return (
    <div className="mx-auto w-full max-w-sm space-y-4 p-6">
      <h1 className="text-2xl font-semibold">{t.login.title}</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.login.intro}</p>

      {!phone ? (
        <form onSubmit={sendCode} className="space-y-3">
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
          <button type="submit" className={button} disabled={busy}>
            {t.login.sendCode}
          </button>
        </form>
      ) : (
        <form onSubmit={verify} className="space-y-3">
          <p className="text-sm font-medium">{phone}</p>
          <label className="block space-y-1">
            <span className="text-sm font-medium">{t.login.code}</span>
            <input
              className={`${input} tracking-[0.4em]`}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              required
            />
          </label>
          {backend.mode === "demo" && DEMO_ROLES.length > 1 && (
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
          )}
          <button type="submit" className={button} disabled={busy || code.length < 6}>
            {t.login.verify}
          </button>
          <button
            type="button"
            className="w-full text-sm text-zinc-600 underline dark:text-zinc-400"
            onClick={() => {
              setPhone(null);
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
    </div>
  );
}
