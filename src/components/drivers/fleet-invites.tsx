"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { FLEET_VEHICLE_TYPES, type DriverApplication, type FleetVehicleType } from "@/lib/drivers";
import type { MyFleetInvite } from "@/lib/fleet";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { useApp } from "../app-provider";
import { ConfirmSheet } from "../confirm-sheet";
import { useI18n } from "../i18n-provider";
import { Button, Card, Input, useToast } from "../ui";

function useLongDate() {
  const { locale } = useI18n();
  const fmt = new Intl.DateTimeFormat(locale === "fr" ? "fr-TG" : "en-GB", { day: "numeric", month: "long" });
  return (iso: string) => fmt.format(new Date(iso));
}

/** Pending invites of a customer account (empty for every other role, R11/R15). */
function useMyInvites() {
  const { backend, profile } = useApp();
  const isCustomer = profile?.role === "customer";
  return useLiveQuery(() => (isCustomer ? backend.myFleetInvites() : Promise.resolve<MyFleetInvite[]>([])), `${profile?.id ?? ""}:${isCustomer}`);
}

/**
 * Banner above every page while a customer has a pending fleet invite (W6). The decision
 * itself is taken on /chauffeur, where the consequences are explained.
 */
export function FleetInviteBanner() {
  const { t } = useI18n();
  const pathname = usePathname();
  const { features } = useApp();
  const { data } = useMyInvites();
  // Accepting needs the driver module (as in the Worker).
  if (!features.drivers || !data || data.length === 0 || pathname?.startsWith("/chauffeur")) return null;
  const text = data.length === 1 ? format(t.fleet.invitation.banner, { fleet: data[0].fleetName }) : format(t.fleet.invitation.bannerMany, { n: data.length });
  return (
    <div role="status" className="flex items-center gap-3 bg-gp-green/15 px-4 py-2 text-sm text-gp-forest dark:text-zinc-100">
      <span className="flex-1">{text}</span>
      <Link href="/chauffeur" className="flex min-h-11 items-center font-semibold text-gp-green-dark underline dark:text-gp-green">
        {t.fleet.invitation.see}
      </Link>
    </div>
  );
}

const EMPTY_APPLICATION: DriverApplication = { fullName: "", idNumber: "", licenseNumber: "", wantedType: "moto" };

function applicationComplete(a: DriverApplication) {
  return a.fullName.trim().length >= 2 && a.idNumber.trim().length >= 3 && a.licenseNumber.trim().length >= 3;
}

function InviteItem({ invite, highlighted }: { invite: MyFleetInvite; highlighted: boolean }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const longDate = useLongDate();
  const [sheet, setSheet] = useState<"accept" | "decline" | null>(null);
  const [busy, setBusy] = useState(false);
  const [application, setApplication] = useState<DriverApplication>(EMPTY_APPLICATION);
  const inv = t.fleet.invitation;
  const page = t.drivers.page;
  const set = (key: keyof DriverApplication) => (e: { target: { value: string } }) => setApplication((a) => ({ ...a, [key]: e.target.value }));

  async function decide(action: () => Promise<void>, success: string) {
    setBusy(true);
    try {
      await action();
      toast(success, { tone: "success", duration: 6000 });
      setSheet(null);
    } catch (err) {
      toast(errorMessage(err), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={`space-y-3 rounded-xl border p-3 ${highlighted ? "border-gp-green-dark dark:border-gp-green" : "border-gp-border"}`}>
      <div>
        <p className="font-semibold">{format(inv.from, { fleet: invite.fleetName })}</p>
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
        title={format(inv.acceptTitle, { fleet: invite.fleetName })}
        confirmLabel={inv.accept}
        busy={busy}
        onCancel={() => setSheet(null)}
        onConfirm={() => {
          if (invite.needsApplication && !applicationComplete(application)) {
            toast(inv.applicationHint, { tone: "error" });
            return;
          }
          void decide(() => backend.acceptFleetInvite(invite.token, invite.needsApplication ? application : undefined), inv.accepted);
        }}
      >
        <p className="text-sm">{inv.acceptText}</p>
        {invite.needsApplication && (
          <div className="mt-3 grid gap-3">
            <p className="text-sm font-medium">{inv.applicationHint}</p>
            <label className="space-y-1 text-sm">
              <span>{page.fullName}</span>
              <Input required minLength={2} maxLength={80} value={application.fullName} onChange={set("fullName")} />
            </label>
            <label className="space-y-1 text-sm">
              <span>{page.idNumber}</span>
              <Input required minLength={3} maxLength={40} value={application.idNumber} onChange={set("idNumber")} />
            </label>
            <label className="space-y-1 text-sm">
              <span>{page.licenseNumber}</span>
              <Input required minLength={3} maxLength={40} value={application.licenseNumber} onChange={set("licenseNumber")} />
            </label>
            <label className="space-y-1 text-sm">
              <span>{page.wantedType}</span>
              <select
                className="min-h-11 w-full rounded-xl border border-gp-border bg-gp-surface px-4 py-2.5 text-base"
                value={application.wantedType}
                onChange={(e) => setApplication((a) => ({ ...a, wantedType: e.target.value as FleetVehicleType }))}
              >
                {FLEET_VEHICLE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {t.drivers.vehicle[type]}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}
      </ConfirmSheet>

      <ConfirmSheet
        open={sheet === "decline"}
        title={format(inv.declineTitle, { fleet: invite.fleetName })}
        confirmLabel={inv.decline}
        danger
        busy={busy}
        onCancel={() => setSheet(null)}
        onConfirm={() => void decide(() => backend.declineFleetInvite(invite.token), inv.declined)}
      />
    </li>
  );
}

/**
 * On /chauffeur, for customer accounts: the fleet invites sent to this number, and a field
 * for the code the manager passed on (also read from /chauffeur?invitation=CODE). The code
 * only finds an invite made for this account's number (R12).
 */
export function FleetInvitesCard() {
  const { t } = useI18n();
  const { profile } = useApp();
  const { data } = useMyInvites();
  const [code, setCode] = useState("");
  const [wanted, setWanted] = useState<string | null>(null);
  const inv = t.fleet.invitation;

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
  const notFound = wanted !== null && !data.some((i) => i.token === wanted);
  function lookUp(e: FormEvent) {
    e.preventDefault();
    setWanted(code.trim().toUpperCase());
  }

  return (
    <Card className="space-y-3 p-4">
      <h2 className="font-semibold">{inv.title}</h2>
      {data.length > 0 && (
        <ul className="space-y-3">
          {data.map((i) => (
            <InviteItem key={i.token} invite={i} highlighted={i.token === wanted} />
          ))}
        </ul>
      )}
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
    </Card>
  );
}
