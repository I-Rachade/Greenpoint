"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import type { CodeChannel } from "@/lib/backend/backend";
import { CONTACT_EMAIL } from "@/lib/config";
import { normalizeEmail } from "@/lib/contact";
import { useErrorMessage } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { normalizeTogoPhone } from "@/lib/phone";
import { useApp } from "./app-provider";
import { useI18n } from "./i18n-provider";

const CODE_LENGTH = 6;
const digits = (value: string) => value.replace(/\D/g, "").slice(0, CODE_LENGTH);

const input =
  "w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-base dark:border-white/20 dark:bg-zinc-900";
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
  const { profile, ready } = useApp();
  const [deleted, setDeleted] = useState(false);

  if (!ready) return <p className="p-6 text-sm text-zinc-500">{t.loading}</p>;

  return (
    <div className="mx-auto w-full max-w-sm space-y-6 p-6">
      <h1 className="text-2xl font-semibold">{t.account.title}</h1>

      {deleted ? (
        <p className="rounded-lg bg-gp-green/10 p-3 text-sm">{t.account.deleted}</p>
      ) : !profile ? (
        <section className="space-y-2">
          <h2 className="font-semibold">{t.account.deleteTitle}</h2>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {format(t.account.loggedOutText, { email: CONTACT_EMAIL })}
          </p>
        </section>
      ) : (
        <>
          <section className="space-y-3">
            <ContactRow kind="phone" value={profile.phone} />
            <ContactRow kind="email" value={profile.email} />
          </section>
          <Link href="/chauffeur" className="block text-sm text-gp-green-dark underline dark:text-gp-green">
            {profile.driverStatus ? t.nav.driver : t.account.becomeDriver}
          </Link>
          <DeleteAccount phone={profile.phone} email={profile.email} onDeleted={() => setDeleted(true)} />
        </>
      )}
    </div>
  );
}

/** Shows the phone number or e-mail address, or a small form to add it (confirmed by a code). */
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
      setError(t.login.invalidContact);
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
        <span className="text-zinc-500">{label} : </span>
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
      <p className="text-xs text-zinc-500">{t.account.addHint}</p>
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
    <form onSubmit={sent ? remove : send} className="space-y-3 rounded-lg border border-red-200 p-4 dark:border-red-900">
      <h2 className="font-semibold text-red-700 dark:text-red-400">{t.account.deleteTitle}</h2>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.account.deleteText}</p>

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
