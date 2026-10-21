"use client";

import { useState, type FormEvent } from "react";
import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { POINT_PARTNER_NAME_MAX, type AdminPointPartner, type PointPartnerInput } from "@/lib/point-partners";
import { card, field, indexSnapshot, Loading, Pill, StaleNotice, useAdminSnapshot } from "./shared";

const button = "rounded-full bg-gp-green-dark px-3 py-1 text-xs text-white disabled:opacity-30";
const outline = "rounded-full border border-black/15 px-3 py-1 text-xs dark:border-white/20";

function PartnerForm({
  partner,
  onDone,
  onCancel,
}: {
  partner: AdminPointPartner | null;
  onDone: (msg: string, ok: boolean) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const p = t.pointPartners;
  const [form, setForm] = useState<PointPartnerInput>({ name: partner?.name ?? "", contactPhone: partner?.contactPhone ?? "" });

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await backend.savePointPartner(partner?.id ?? null, { name: form.name, contactPhone: form.contactPhone?.trim() || null });
      onDone(p.saved, true);
    } catch (err) {
      onDone(errorMessage(err), false);
    }
  }

  return (
    <form onSubmit={submit} className={`${card} grid gap-3 sm:grid-cols-2`}>
      <label className="space-y-1 text-sm">
        <span>{p.name}</span>
        <input
          className={`${field} w-full`}
          required
          maxLength={POINT_PARTNER_NAME_MAX}
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
      </label>
      <label className="space-y-1 text-sm">
        <span>{p.contactPhone}</span>
        <input
          className={`${field} w-full`}
          type="tel"
          value={form.contactPhone ?? ""}
          onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))}
          placeholder="90 12 34 56"
        />
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className="rounded-full bg-gp-green-dark px-4 py-1.5 text-sm text-white">
          {p.save}
        </button>
        <button type="button" onClick={onCancel} className="rounded-full border border-black/15 px-4 py-1.5 text-sm dark:border-white/20">
          {p.cancel}
        </button>
      </div>
    </form>
  );
}

function PartnerCard({
  partner,
  stationName,
  onChanged,
  onMessage,
}: {
  partner: AdminPointPartner;
  stationName: (id: string) => string;
  onChanged: () => void;
  onMessage: (msg: string, ok: boolean) => void;
}) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const p = t.pointPartners;
  const [editing, setEditing] = useState(false);
  const [contact, setContact] = useState("");
  const active = partner.status === "active";

  async function act(action: () => Promise<unknown>) {
    try {
      await action();
      onChanged();
      return true;
    } catch (err) {
      onMessage(errorMessage(err), false);
      return false;
    }
  }

  if (editing) {
    return (
      <PartnerForm
        partner={partner}
        onCancel={() => setEditing(false)}
        onDone={(msg, ok) => {
          onMessage(msg, ok);
          if (ok) {
            setEditing(false);
            onChanged();
          }
        }}
      />
    );
  }

  async function addAccount(e: FormEvent) {
    e.preventDefault();
    if (await act(() => backend.addPointPartnerAccount(partner.id, contact))) setContact("");
  }

  return (
    <div className={`${card} space-y-3`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{partner.name}</h2>
        <Pill tone={active ? "green" : "red"}>{active ? p.active : p.suspended}</Pill>
        <span className="flex-1" />
        <button type="button" className={outline} onClick={() => setEditing(true)}>
          {p.edit}
        </button>
        <button
          type="button"
          className={outline}
          onClick={() => {
            if (!active || window.confirm(format(p.confirmSuspend, { partner: partner.name }))) act(() => backend.setPointPartnerActive(partner.id, !active));
          }}
        >
          {active ? p.suspend : p.activate}
        </button>
      </div>
      {partner.contactPhone && <p className="text-sm text-zinc-600 dark:text-zinc-400">{partner.contactPhone}</p>}
      <div className="space-y-1 text-sm">
        <h3 className="font-medium">{p.devices}</h3>
        {partner.devices.length === 0 ? (
          <p className="text-zinc-500">{p.noDevices}</p>
        ) : (
          <ul className="divide-y divide-black/5 dark:divide-white/10">
            {partner.devices.map((d) => (
              <li key={d.externalId} className="flex flex-wrap items-center gap-x-2 py-1.5">
                <span className="font-mono">{d.externalId}</span>
                <span className="text-zinc-500">
                  {stationName(d.stationId)} · {format(p.outlets, { n: d.outlets })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="space-y-1 text-sm">
        <h3 className="font-medium">{p.accounts}</h3>
        {partner.accounts.length === 0 ? (
          <p className="text-zinc-500">{p.noAccounts}</p>
        ) : (
          <ul className="divide-y divide-black/5 dark:divide-white/10">
            {partner.accounts.map((a) => (
              <li key={a.userId} className="flex items-center gap-2 py-1.5">
                <span className="flex-1">{a.label}</span>
                <button
                  type="button"
                  className={outline}
                  onClick={() => {
                    if (window.confirm(format(p.confirmRemove, { user: a.label, partner: partner.name }))) {
                      act(() => backend.removePointPartnerAccount(partner.id, a.userId));
                    }
                  }}
                >
                  {p.remove}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <form onSubmit={addAccount} className="space-y-1">
        <div className="flex gap-2">
          <input
            className={`${field} min-w-0 flex-1`}
            required
            aria-label={p.accountContact}
            placeholder={p.accountContact}
            value={contact}
            onChange={(e) => setContact(e.target.value)}
          />
          <button type="submit" className={button}>
            {p.addAccount}
          </button>
        </div>
        <p className="text-xs text-zinc-500">{p.accountHint}</p>
      </form>
    </div>
  );
}

/** Backoffice: point partners, who own charging sockets, and the accounts that see them. */
export function PointPartnersManager() {
  const { t } = useI18n();
  const { backend } = useApp();
  const { data, error, reload } = useLiveQuery(() => backend.adminPointPartners());
  const { data: snap, error: snapError, reload: reloadSnap } = useAdminSnapshot();
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);
  const retry = () => {
    reload();
    reloadSnap();
  };

  if (!data || !snap) return <Loading error={error ?? snapError} onRetry={retry} />;
  const p = t.pointPartners;
  const idx = indexSnapshot(snap);
  const onMessage = (text: string, ok: boolean) => setMessage({ text, ok });

  return (
    <div className="space-y-6">
      <StaleNotice error={error ?? snapError} onRetry={retry} />
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{p.title}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{p.intro}</p>
      </div>
      {message && (
        <p role="status" className={`text-sm ${message.ok ? "text-gp-green-dark dark:text-gp-green" : "text-red-600"}`}>
          {message.text}
        </p>
      )}
      {adding ? (
        <PartnerForm
          partner={null}
          onCancel={() => setAdding(false)}
          onDone={(msg, ok) => {
            onMessage(msg, ok);
            if (ok) {
              setAdding(false);
              reload();
            }
          }}
        />
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="rounded-full bg-gp-green-dark px-4 py-1.5 text-sm text-white">
          {p.add}
        </button>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {data.map((partner) => (
          <PartnerCard key={partner.id} partner={partner} stationName={idx.stationName} onChanged={reload} onMessage={onMessage} />
        ))}
      </div>
    </div>
  );
}
