"use client";

import { useState } from "react";
import { DEFAULT_PHONE_COUNTRY, PHONE_COUNTRIES, phoneWithCountry } from "@/lib/countries";
import { useErrorMessage } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { canInviteMore, type MerchantInvite, type MerchantInviteStatus, type MerchantMember, type MerchantView } from "@/lib/merchants";
import { useApp } from "../app-provider";
import { ConfirmSheet } from "../confirm-sheet";
import { CountryPicker } from "../country-picker";
import { useI18n } from "../i18n-provider";
import { Badge, Button, Input, useToast, type BadgeTone } from "../ui";
import { Block, useAction, useLongDate } from "./shared";

const INVITE_TONE: Record<MerchantInviteStatus, BadgeTone> = { pending: "amber", accepted: "green", declined: "neutral", revoked: "neutral", expired: "neutral" };

/** Team: the merchant and employees, open invites, invite by phone (with the limit), revoke, remove. */
export function MerchantTeam({ view }: { view: MerchantView }) {
  const { t } = useI18n();
  const m = t.merchant.team;
  const [inviting, setInviting] = useState(false);
  const shop = view.merchant;
  const canInvite = canInviteMore(shop.tier, shop.used);
  const pending = view.invites.filter((i) => i.status === "pending");
  const answered = view.invites.filter((i) => i.status !== "pending").slice(0, 10);
  const counter = shop.employeeLimit === null ? format(m.noLimit, { used: shop.used }) : format(m.limit, { used: shop.used, limit: shop.employeeLimit });

  return (
    <div className="space-y-4">
      <Block
        title={m.members}
        hint={counter}
        action={
          <Button size="md" disabled={!canInvite} onClick={() => setInviting(true)}>
            {m.invite}
          </Button>
        }
      >
        {!canInvite && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">{m.limitReached}</p>}
        <ul className="space-y-2">
          {view.members.map((member) => (
            <MemberRow key={member.userId} member={member} />
          ))}
        </ul>
      </Block>
      <Block title={m.invites}>
        {pending.length + answered.length === 0 ? (
          <p className="text-sm text-gp-muted">{m.noInvites}</p>
        ) : (
          <ul className="space-y-2">
            {[...pending, ...answered].map((i) => (
              <InviteRow key={i.id} invite={i} />
            ))}
          </ul>
        )}
      </Block>
      <InviteSheet open={inviting} onClose={() => setInviting(false)} />
    </div>
  );
}

function MemberRow({ member }: { member: MerchantMember }) {
  const { t } = useI18n();
  const m = t.merchant.team;
  const { backend } = useApp();
  const longDate = useLongDate();
  const { busy, run } = useAction();
  const [confirm, setConfirm] = useState(false);
  const name = member.fullName ?? member.phone ?? member.email ?? "?";
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-xl border border-black/10 p-3 text-sm dark:border-white/10">
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 font-semibold">
          {name}
          <Badge tone={member.isOwner ? "green" : "neutral"}>{member.isOwner ? m.owner : m.employee}</Badge>
        </p>
        <p className="text-xs text-gp-muted">
          {[member.phone, member.email].filter(Boolean).join(" · ")}
          {` · ${format(m.since, { date: longDate(member.since) })}`}
        </p>
      </div>
      {/* The merchant cannot be removed from their own shop; an admin changes the owner. */}
      {!member.isOwner && (
        <>
          <Button variant="ghost" size="md" onClick={() => setConfirm(true)}>
            {m.remove}
          </Button>
          <ConfirmSheet
            open={confirm}
            title={format(m.removeTitle, { name })}
            confirmLabel={m.remove}
            danger
            busy={busy}
            onCancel={() => setConfirm(false)}
            onConfirm={() =>
              void run(() => backend.removeMerchantEmployee(member.userId), m.removed).then((ok) => {
                if (ok) setConfirm(false);
              })
            }
          >
            <p className="text-sm">{m.removeText}</p>
          </ConfirmSheet>
        </>
      )}
    </li>
  );
}

function InviteRow({ invite }: { invite: MerchantInvite }) {
  const { t } = useI18n();
  const m = t.merchant.team;
  const { backend } = useApp();
  const toast = useToast();
  const longDate = useLongDate();
  const { busy, run } = useAction();
  const [confirm, setConfirm] = useState(false);

  function copyLink() {
    const link = `${window.location.origin}/marchand?invitation=${invite.token}`;
    const copied = navigator.clipboard?.writeText(link);
    if (!copied) {
      toast(link, { tone: "info", duration: 8000 });
      return;
    }
    copied.then(
      () => toast(m.linkCopied, { tone: "success" }),
      () => toast(link, { tone: "info", duration: 8000 }),
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-xl border border-black/10 p-3 text-sm dark:border-white/10">
      <span className="font-medium">{invite.phone}</span>
      <Badge tone={INVITE_TONE[invite.status]}>{m.inviteStatus[invite.status]}</Badge>
      {invite.status === "pending" && (
        <>
          <span className="font-mono text-xs">{format(m.inviteCode, { code: invite.token })}</span>
          <span className="text-xs text-gp-muted">{format(m.expiresOn, { date: longDate(invite.expiresAt) })}</span>
          <span className="flex-1" />
          <Button variant="secondary" size="md" onClick={copyLink}>
            {m.copyLink}
          </Button>
          <Button variant="ghost" size="md" onClick={() => setConfirm(true)}>
            {m.revoke}
          </Button>
          <ConfirmSheet
            open={confirm}
            title={format(m.revokeTitle, { phone: invite.phone })}
            confirmLabel={m.revokeConfirm}
            cancelLabel={m.keep}
            danger
            busy={busy}
            onCancel={() => setConfirm(false)}
            onConfirm={() =>
              void run(() => backend.revokeMerchantInvite(invite.id), m.revoked).then((ok) => {
                if (ok) setConfirm(false);
              })
            }
          />
        </>
      )}
    </li>
  );
}

/** The sheet to invite an employee by phone number, with the country picker of the login. */
function InviteSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const m = t.merchant.team;
  const { backend } = useApp();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [country, setCountry] = useState(DEFAULT_PHONE_COUNTRY);
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    const full = phoneWithCountry(country, phone);
    if (!full) {
      setError(t.login.invalidPhone);
      return;
    }
    setError("");
    setBusy(true);
    try {
      const invite = await backend.inviteMerchantEmployee(full);
      toast(format(m.invited, { code: invite.token }), { tone: "success", duration: 6000 });
      setPhone("");
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ConfirmSheet open={open} title={m.invite} confirmLabel={m.inviteSend} busy={busy} onConfirm={() => void send()} onCancel={onClose}>
      <p className="text-sm">{m.inviteText}</p>
      <label htmlFor="merchant-invite-phone" className="mt-3 block text-sm font-medium">
        {m.invitePhone}
      </label>
      <div className="mt-1 flex gap-2">
        <CountryPicker countries={PHONE_COUNTRIES} value={country} onChange={setCountry} />
        <Input
          id="merchant-invite-phone"
          className="min-w-0 flex-1"
          type="tel"
          inputMode="tel"
          placeholder={country.example}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-300">
          {error}
        </p>
      )}
    </ConfirmSheet>
  );
}
