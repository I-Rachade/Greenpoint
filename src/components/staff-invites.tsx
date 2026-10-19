"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import type { MyStaffInvite } from "@/lib/operators";
import { useApp } from "./app-provider";
import { ConfirmSheet } from "./confirm-sheet";
import { useI18n } from "./i18n-provider";
import { useAction, useLongDate } from "./merchants/shared";
import { Button, Card } from "./ui";

function InviteItem({ invite }: { invite: MyStaffInvite }) {
  const { t } = useI18n();
  const inv = t.owner.invitation;
  const { backend } = useApp();
  const router = useRouter();
  const longDate = useLongDate();
  const { busy, run } = useAction();
  const [sheet, setSheet] = useState<"accept" | "decline" | null>(null);
  const station = invite.stationName;

  return (
    <li className="space-y-3 rounded-xl border border-gp-border p-3">
      <div>
        <p className="font-semibold">{format(inv.from, { operator: invite.operatorName, station })}</p>
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
        title={format(inv.acceptTitle, { station })}
        confirmLabel={inv.accept}
        busy={busy}
        onCancel={() => setSheet(null)}
        onConfirm={() =>
          // The client refreshes the profile: the account is a staff account now.
          void run(() => backend.acceptStaffInvite(invite.id), format(inv.accepted, { station })).then((ok) => {
            if (!ok) return;
            setSheet(null);
            router.push("/operator");
          })
        }
      >
        <p className="text-sm">{inv.acceptText}</p>
      </ConfirmSheet>
      <ConfirmSheet
        open={sheet === "decline"}
        title={format(inv.declineTitle, { station })}
        confirmLabel={inv.decline}
        danger
        busy={busy}
        onCancel={() => setSheet(null)}
        onConfirm={() =>
          void run(() => backend.declineStaffInvite(invite.id), inv.declined).then((ok) => {
            if (ok) setSheet(null);
          })
        }
      />
    </li>
  );
}

/**
 * Invites to work at a station, made for this account's phone number or e-mail address
 * (migration 0050). Nothing changes until the person accepts here; hidden without invites.
 */
export function StaffInvitesCard() {
  const { t } = useI18n();
  const { backend, profile } = useApp();
  const { data } = useLiveQuery(() => (profile ? backend.myStaffInvites() : Promise.resolve<MyStaffInvite[]>([])), profile?.id ?? "");
  if (!profile || !data?.length) return null;
  return (
    <Card className="space-y-3 p-4">
      <h2 className="font-semibold">{t.owner.invitation.title}</h2>
      <ul className="space-y-3">
        {data.map((i) => (
          <InviteItem key={i.id} invite={i} />
        ))}
      </ul>
    </Card>
  );
}
