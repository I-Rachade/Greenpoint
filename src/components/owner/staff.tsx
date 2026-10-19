"use client";

import { useState, type FormEvent } from "react";
import { useApp } from "@/components/app-provider";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { useI18n } from "@/components/i18n-provider";
import { Badge, Button, Input, useToast } from "@/components/ui";
import { useErrorMessage } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import type { OperatorStaff, OwnerView, StaffInvite, StaffReassignment } from "@/lib/operators";
import type { StationView } from "@/lib/types";
import { useLongDate } from "../merchants/shared";
import { Section, useWhen } from "./shared";

type Pending =
  | { kind: "remove"; person: OperatorStaff }
  | { kind: "move"; person: OperatorStaff; to: string }
  | { kind: "cancel"; invite: StaffInvite }
  | null;

/**
 * Staff work at exactly one station (W2): invite someone to a station (they become staff once
 * they accept, migration 0050), move them to another station of the owner, or remove them.
 * Above, the list to re-staff from migration 0033.
 */
export function StaffView({ view, stations, onChanged }: { view: OwnerView; stations: StationView[]; onChanged: () => void }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const o = t.owner;
  const name = (id: string | null) => view.stations.find((s) => s.id === id)?.name ?? "–";

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast(success, { tone: "success" });
      onChanged();
      return true;
    } catch (err) {
      toast(errorMessage(err), { tone: "error" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    if (!pending) return;
    let ok: boolean;
    if (pending.kind === "cancel") {
      const invite = pending.invite;
      ok = await run(() => backend.ownerRevokeStaffInvite(invite.id), o.invites.cancelled);
    } else {
      const p = pending.person;
      ok =
        pending.kind === "remove"
          ? await run(() => backend.ownerRemoveStaff(p.stationId, p.userId), format(o.removed, { user: p.label, station: name(p.stationId) }))
          : await run(() => backend.ownerMoveStaff(p.userId, pending.to), format(o.added, { user: p.label, station: name(pending.to) }));
    }
    if (ok) setPending(null);
  }

  function sheetTitle(p: NonNullable<Pending>): string {
    if (p.kind === "cancel") return format(o.invites.confirmCancel, { user: p.invite.label, station: name(p.invite.stationId) });
    if (p.kind === "move") return format(o.moveConfirm, { user: p.person.label, station: name(p.to) });
    return format(o.confirmRemove, { user: p.person.label, station: name(p.person.stationId) });
  }

  return (
    <div className="space-y-4">
      {view.reassignments.length > 0 && <Reassignments view={view} name={name} busy={busy} run={run} />}
      {stations.map((s) => (
        <StationStaff
          key={s.id}
          station={s}
          staff={view.staff.filter((p) => p.stationId === s.id)}
          invites={view.invites.filter((i) => i.stationId === s.id)}
          others={view.stations.filter((x) => x.id !== s.id)}
          busy={busy}
          onInvite={(contact) => run(() => backend.ownerInviteStaff(s.id, contact), format(o.invited, { user: contact.trim(), station: s.name }))}
          onAsk={setPending}
        />
      ))}
      <ConfirmSheet
        open={!!pending}
        title={pending ? sheetTitle(pending) : ""}
        confirmLabel={pending?.kind === "move" ? o.move : pending?.kind === "cancel" ? o.invites.cancel : o.remove}
        danger={pending?.kind === "remove" || pending?.kind === "cancel"}
        busy={busy}
        onConfirm={() => void confirm()}
        onCancel={() => setPending(null)}
      >
        {pending?.kind !== "cancel" && <p>{pending?.kind === "move" ? o.moveHint : o.removeHint}</p>}
      </ConfirmSheet>
    </div>
  );
}

function StationStaff({
  station,
  staff,
  invites,
  others,
  busy,
  onInvite,
  onAsk,
}: {
  station: StationView;
  staff: OperatorStaff[];
  invites: StaffInvite[];
  others: StationView[];
  busy: boolean;
  onInvite: (contact: string) => Promise<boolean>;
  onAsk: (p: Pending) => void;
}) {
  const { t } = useI18n();
  const o = t.owner;
  const longDate = useLongDate();
  const [contact, setContact] = useState("");
  const [moveTo, setMoveTo] = useState<Record<string, string>>({});

  async function invite(e: FormEvent) {
    e.preventDefault();
    if (await onInvite(contact)) setContact("");
  }

  return (
    <Section title={station.name} aside={<Badge tone="neutral">{format(o.staffCount, { n: staff.length })}</Badge>}>
      {staff.length === 0 ? (
        <p className="text-sm text-gp-muted">{o.noStaff}</p>
      ) : (
        <ul className="divide-y divide-black/5 text-sm dark:divide-white/10">
          {staff.map((p) => (
            <li key={p.userId} className="flex flex-wrap items-center gap-2 py-2">
              <span className="min-w-0 flex-1 font-medium">{p.label}</span>
              {others.length > 0 && (
                <span className="flex items-center gap-1">
                  <label className="sr-only" htmlFor={`move-${p.userId}`}>
                    {o.moveTo}
                  </label>
                  <select
                    id={`move-${p.userId}`}
                    className="min-h-11 max-w-40 rounded-xl border border-gp-border bg-gp-surface px-2 text-base"
                    value={moveTo[p.userId] ?? ""}
                    onChange={(e) => setMoveTo({ ...moveTo, [p.userId]: e.target.value })}
                  >
                    <option value="">{o.moveTo}</option>
                    {others.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <Button variant="secondary" disabled={busy || !moveTo[p.userId]} onClick={() => onAsk({ kind: "move", person: p, to: moveTo[p.userId] })}>
                    {o.move}
                  </Button>
                </span>
              )}
              <Button variant="ghost" className="text-red-600" disabled={busy} onClick={() => onAsk({ kind: "remove", person: p })}>
                {o.remove}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {invites.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">{o.invites.title}</h3>
          <ul className="divide-y divide-black/5 text-sm dark:divide-white/10">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 py-2">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{i.label}</span>
                  <span className="block text-xs text-gp-muted">{format(o.invites.until, { date: longDate(i.expiresAt) })}</span>
                </span>
                <Button variant="ghost" className="text-red-600" disabled={busy} onClick={() => onAsk({ kind: "cancel", invite: i })}>
                  {o.invites.cancel}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <form onSubmit={invite} className="space-y-1">
        <label htmlFor={`add-${station.id}`} className="text-sm">
          {o.staffContact}
        </label>
        <div className="flex gap-2">
          <Input id={`add-${station.id}`} required value={contact} onChange={(e) => setContact(e.target.value)} autoComplete="off" />
          <Button type="submit" busy={busy}>
            {o.invite}
          </Button>
        </div>
        <p className="text-xs text-gp-muted">{o.staffHint}</p>
      </form>
    </Section>
  );
}

function Reassignments({
  view,
  name,
  busy,
  run,
}: {
  view: OwnerView;
  name: (id: string | null) => string;
  busy: boolean;
  run: (action: () => Promise<unknown>, success: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const { backend } = useApp();
  const when = useWhen();
  const r = t.owner.reassign;
  return (
    <section aria-labelledby="reassign-title" className="space-y-2 rounded-2xl border border-amber-400/70 bg-amber-50 p-4 dark:bg-amber-900/20">
      <h2 id="reassign-title" className="font-heading text-lg font-semibold">
        {format(r.title, { n: view.reassignments.length })}
      </h2>
      <p className="text-sm text-amber-900 dark:text-amber-100">{r.intro}</p>
      <ul className="divide-y divide-black/5 text-sm dark:divide-white/10">
        {view.reassignments.map((x: StaffReassignment) => (
          <li key={x.id} className="flex flex-wrap items-center gap-2 py-2">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{format(r.toStaff, { station: name(x.stationId) })}</span>
              <span className="block text-xs text-gp-muted">
                {x.label} · {x.currentStationId ? format(r.now, { station: name(x.currentStationId) }) : r.nowhere} · {when(x.createdAt)}
              </span>
            </span>
            {x.currentStationId && view.stations.some((s) => s.id === x.stationId) && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => run(() => backend.ownerMoveStaff(x.userId, x.stationId), format(t.owner.added, { user: x.label, station: name(x.stationId) }))}
              >
                {r.moveHere}
              </Button>
            )}
            <Button variant="ghost" disabled={busy} onClick={() => run(() => backend.resolveReassignment(x.id), r.resolved)}>
              {r.done}
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
