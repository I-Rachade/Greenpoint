"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import type { MyMerchantInvite } from "@shared/merchants";
import { useApp } from "../app-provider";
import { ConfirmSheet } from "../confirm-sheet";
import { useI18n } from "../i18n-provider";
import { Button, Card, Input } from "../ui";
import { useAction, useLongDate } from "./shared";

/** Open shop invites of a customer account (empty for every other role, R11). */
function useMyShopInvites() {
  const { backend, profile } = useApp();
  const isCustomer = profile?.role === "customer";
  return useLiveQuery(
    () => (isCustomer ? backend.myMerchantInvites() : Promise.resolve<MyMerchantInvite[]>([])),
    `${profile?.id ?? ""}:${isCustomer}`,
  );
}

function InviteItem({ invite, highlighted }: { invite: MyMerchantInvite; highlighted: boolean }) {
  const { t } = useI18n();
  const inv = t.merchant.invitation;
  const { backend } = useApp();
  const router = useRouter();
  const longDate = useLongDate();
  const { busy, run } = useAction();
  const [sheet, setSheet] = useState<"accept" | "decline" | null>(null);

  return (
    <li className={`space-y-3 rounded-xl border p-3 ${highlighted ? "border-gp-green-dark dark:border-gp-green" : "border-gp-border"}`}>
      <div>
        <p className="font-semibold">{format(inv.from, { shop: invite.merchantName })}</p>
        <p className="text-xs text-gp-muted">{format(inv.validUntil, { date: longDate(invite.expiresAt) })}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setSheet("accept")}>{inv.accept}</Button>
        <Button variant="secondary" onClick={() => setSheet("decline")}>
          {inv.decline}
        </Button>
      </div>
      <ConfirmSheet
        open={sheet === "accept"}
        title={format(inv.acceptTitle, { shop: invite.merchantName })}
        confirmLabel={inv.accept}
        busy={busy}
        onCancel={() => setSheet(null)}
        onConfirm={() =>
          // The client refreshes the profile: the account is a merchant employee now.
          void run(() => backend.acceptMerchantInvite(invite.token), inv.accepted).then((ok) => {
            if (!ok) return;
            setSheet(null);
            router.push("/marchand");
          })
        }
      >
        <p className="text-sm">{inv.acceptText}</p>
      </ConfirmSheet>
      <ConfirmSheet
        open={sheet === "decline"}
        title={format(inv.declineTitle, { shop: invite.merchantName })}
        confirmLabel={inv.decline}
        danger
        busy={busy}
        onCancel={() => setSheet(null)}
        onConfirm={() =>
          void run(() => backend.declineMerchantInvite(invite.token), inv.declined).then((ok) => {
            if (ok) setSheet(null);
          })
        }
      />
    </li>
  );
}

/**
 * For customer accounts: the shop invites sent to this number, and a field for the code the
 * merchant passed on (also read from /marchand?invitation=CODE). The code only finds an
 * invite made for this account's number. `always`: show the card even without invites.
 */
export function MerchantInvitesCard({ always = false }: { always?: boolean }) {
  const { t } = useI18n();
  const inv = t.merchant.invitation;
  const { profile } = useApp();
  const { data } = useMyShopInvites();
  const [code, setCode] = useState("");
  const [wanted, setWanted] = useState<string | null>(null);

  useEffect(() => {
    // Static page: the code comes from the address bar.
    const fromLink = new URLSearchParams(window.location.search).get("invitation");
    if (fromLink) {
      const clean = fromLink.trim().toUpperCase();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from the URL
      setCode(clean);
      setWanted(clean);
    }
  }, []);

  if (profile?.role !== "customer" || !data) return null;
  if (!always && data.length === 0) return null;
  const notFound = wanted !== null && !data.some((i) => i.token === wanted);
  function lookUp(e: FormEvent) {
    e.preventDefault();
    setWanted(code.trim().toUpperCase());
  }

  return (
    <Card className="space-y-3 p-4">
      <h2 className="font-semibold">{inv.title}</h2>
      {data.length > 0 ? (
        <ul className="space-y-3">
          {data.map((i) => (
            <InviteItem key={i.token} invite={i} highlighted={i.token === wanted} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-gp-muted">{inv.none}</p>
      )}
      {always && (
        <form onSubmit={lookUp} className="space-y-2">
          <label className="block space-y-1 text-sm">
            <span>{inv.code}</span>
            <div className="flex gap-2">
              <Input
                className="min-w-0 flex-1 uppercase tracking-widest"
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                maxLength={16}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              <Button type="submit" variant="secondary" disabled={code.trim().length < 6}>
                {inv.see}
              </Button>
            </div>
          </label>
          <p className="text-xs text-gp-muted">{notFound ? inv.notForYou : inv.codeHint}</p>
        </form>
      )}
    </Card>
  );
}

/** /marchand for someone who is not in a shop: their invites, or how to register a shop. */
export function NotAMerchant() {
  const { t } = useI18n();
  const { profile } = useApp();
  const m = t.merchant;
  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 overflow-y-auto p-4 sm:p-6">
      <h1 className="font-heading text-2xl font-semibold">{m.title}</h1>
      {profile?.role === "customer" ? (
        <>
          <MerchantInvitesCard always />
          <p className="text-sm text-gp-muted">{m.notMember}</p>
          <Link href="/marchand/inscription" className="inline-flex min-h-11 items-center text-sm font-semibold text-gp-green-dark underline dark:text-gp-green">
            {m.registerLink}
          </Link>
        </>
      ) : (
        <p className="text-sm text-red-600">{t.errors.forbidden}</p>
      )}
    </div>
  );
}
