"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import type { Partner, PartnerEventLog, PartnerInput } from "@/lib/partners";
import { ParcelsModuleSwitch } from "./parcels-manager";
import { card, field, Loading, Pill, Table, td, th, useDateTime } from "./shared";

const button = "rounded-full bg-gp-green-dark px-3 py-1 text-xs text-white disabled:opacity-30";
const outline = "rounded-full border border-black/15 px-3 py-1 text-xs dark:border-white/20";

const blank: PartnerInput = { name: "", contactEmail: "", contactPhone: "", isActive: true, webhookUrl: "", sharePickupCode: false };

function PartnerForm({ partner, onDone, onCancel }: { partner: Partner | null; onDone: (msg: string, ok: boolean) => void; onCancel: () => void }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const [form, setForm] = useState<PartnerInput>(
    partner
      ? {
          name: partner.name,
          contactEmail: partner.contactEmail ?? "",
          contactPhone: partner.contactPhone,
          isActive: partner.isActive,
          webhookUrl: partner.webhookUrl ?? "",
          sharePickupCode: partner.sharePickupCode,
        }
      : blank,
  );
  const set = (key: "name" | "contactEmail" | "contactPhone" | "webhookUrl") => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await backend.savePartner(partner?.id ?? null, form);
      onDone(t.partners.saved, true);
    } catch (err) {
      onDone(errorMessage(err), false);
    }
  }

  const label = "space-y-1 text-sm";
  return (
    <form onSubmit={submit} className={`${card} grid gap-3 sm:grid-cols-2`}>
      <label className={label}>
        <span>{t.partners.name}</span>
        <input className={`${field} w-full`} required maxLength={80} value={form.name} onChange={set("name")} />
      </label>
      <label className={label}>
        <span>{t.partners.contactPhone}</span>
        <input className={`${field} w-full`} type="tel" required value={form.contactPhone} onChange={set("contactPhone")} placeholder="90 12 34 56" />
      </label>
      <label className={label}>
        <span>{t.partners.contactEmail}</span>
        <input className={`${field} w-full`} type="email" value={form.contactEmail} onChange={set("contactEmail")} />
      </label>
      <label className={label}>
        <span>{t.partners.webhookUrl}</span>
        <input className={`${field} w-full`} type="url" value={form.webhookUrl} onChange={set("webhookUrl")} placeholder="https://" />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />
        {t.partners.active}
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={form.sharePickupCode} onChange={(e) => setForm((f) => ({ ...f, sharePickupCode: e.target.checked }))} />
        <span>
          {t.partners.sharePickupCode}
          <span className="block text-xs text-zinc-500">{t.partners.sharePickupCodeHint}</span>
        </span>
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className="rounded-full bg-gp-green-dark px-4 py-1.5 text-sm text-white">
          {t.partners.save}
        </button>
        <button type="button" onClick={onCancel} className="rounded-full border border-black/15 px-4 py-1.5 text-sm dark:border-white/20">
          {t.partners.cancel}
        </button>
      </div>
    </form>
  );
}

function PartnerCard({ partner, onChanged, onMessage }: { partner: Partner; onChanged: () => void; onMessage: (msg: string, ok: boolean) => void }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const when = useDateTime();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  async function act(action: () => Promise<unknown>) {
    try {
      await action();
      onChanged();
    } catch (err) {
      onMessage(errorMessage(err), false);
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

  return (
    <div className={`${card} space-y-3`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{partner.name}</h2>
        <Pill tone={partner.isActive ? "green" : "gray"}>{partner.isActive ? t.partners.active : t.partners.inactive}</Pill>
        <span className="flex-1" />
        <button type="button" className={outline} onClick={() => setEditing(true)}>
          {t.partners.edit}
        </button>
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {[partner.contactPhone, partner.contactEmail].filter(Boolean).join(" · ")}
        <br />
        {format(t.partners.stats, { n: partner.parcels30d, amount: partner.amount30d, open: partner.openBookings })}
      </p>
      <div className="space-y-1 text-sm">
        <div className="font-medium">Webhook</div>
        <div className="break-all font-mono text-xs">{partner.webhookUrl ?? <span className="text-zinc-500">{t.partners.noWebhook}</span>}</div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span>{t.partners.secret} :</span>
          <code className="break-all">{showSecret ? partner.webhookSecret : "whsec_••••••••"}</code>
          {!showSecret && (
            <button type="button" className={outline} onClick={() => setShowSecret(true)}>
              {t.partners.show}
            </button>
          )}
          <button
            type="button"
            className={outline}
            onClick={() => window.confirm(t.partners.confirmRotate) && void act(() => backend.rotatePartnerSecret(partner.id).then(() => setShowSecret(true)))}
          >
            {t.partners.rotate}
          </button>
        </div>
      </div>
      <div className="space-y-2">
        <div className="text-sm font-medium">{t.partners.keys}</div>
        {newKey && (
          <div role="status" className="space-y-1 rounded-lg bg-amber-50 p-2 text-xs dark:bg-amber-950/40">
            <p>{t.partners.newKey}</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="break-all font-mono text-sm">{newKey}</code>
              <button
                type="button"
                className={outline}
                onClick={() => void navigator.clipboard?.writeText(newKey).then(() => setCopied(true))}
              >
                {copied ? t.partners.copied : t.partners.copy}
              </button>
            </div>
          </div>
        )}
        {partner.keys.length === 0 ? (
          <p className="text-xs text-zinc-500">{t.partners.noKeys}</p>
        ) : (
          <ul className="space-y-1 text-xs">
            {partner.keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-2">
                <code className={k.revokedAt ? "text-zinc-400 line-through" : ""}>{k.prefix}…</code>
                <span>{k.label}</span>
                <span className="text-zinc-500">
                  {k.revokedAt ? t.partners.revoked : k.lastUsedAt ? format(t.partners.lastUsed, { date: when(k.lastUsedAt) }) : t.partners.neverUsed}
                </span>
                {!k.revokedAt && (
                  <button
                    type="button"
                    className={outline}
                    onClick={() => window.confirm(t.partners.confirmRevoke) && void act(() => backend.revokePartnerKey(partner.id, k.id))}
                  >
                    {t.partners.revoke}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void act(async () => {
              const created = await backend.createPartnerKey(partner.id, label);
              setNewKey(created.key);
              setCopied(false);
              setLabel("");
            });
          }}
        >
          <input className={field} value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} placeholder={t.partners.keyLabel} aria-label={t.partners.keyLabel} />
          <button type="submit" className={button}>
            {t.partners.createKey}
          </button>
        </form>
      </div>
    </div>
  );
}

function EventState({ e }: { e: PartnerEventLog }) {
  const { t } = useI18n();
  if (e.deliveredAt) return <Pill tone="green">{t.partners.delivered}</Pill>;
  if (e.nextAttemptAt) return <Pill tone="amber">{t.partners.pending}</Pill>;
  if (e.attempts > 0) return <Pill tone="red">{t.partners.failed}</Pill>;
  return <Pill tone="gray">{t.partners.noWebhook}</Pill>;
}

export function PartnersManager() {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const when = useDateTime();
  const { data, error, reload } = useLiveQuery(() => backend.adminPartners());
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  if (!data) return <Loading error={error} />;
  const name = (id: string) => data.partners.find((p) => p.id === id)?.name ?? id;
  const onMessage = (text: string, ok: boolean) => setMessage({ text, ok });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t.partners.title}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.partners.intro}</p>
        <Link href="/developpeurs" className="text-sm text-gp-green-dark underline dark:text-gp-green">
          {t.partners.docs}
        </Link>
      </div>
      <ParcelsModuleSwitch />
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
          {t.partners.add}
        </button>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {data.partners.map((p) => (
          <PartnerCard key={p.id} partner={p} onChanged={reload} onMessage={onMessage} />
        ))}
      </div>
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">{t.partners.events}</h2>
        {data.events.length === 0 ? (
          <p className="text-sm text-zinc-500">{t.partners.noEvents}</p>
        ) : (
          <Table
            head={
              <>
                <th className={th}>{t.partners.name}</th>
                <th className={th}>Type</th>
                <th className={th} />
                <th className={th} />
              </>
            }
          >
            {data.events.map((e) => (
              <tr key={e.id}>
                <td className={td}>{name(e.partnerId)}</td>
                <td className={`${td} font-mono text-xs`}>
                  {e.type}
                  <div className="text-zinc-500">{when(e.createdAt)}</div>
                </td>
                <td className={td}>
                  <EventState e={e} />
                  <div className="text-xs text-zinc-500">
                    {e.attempts > 0 && format(t.partners.attempts, { n: e.attempts })} {e.lastError ?? ""}
                  </div>
                </td>
                <td className={td}>
                  {!e.deliveredAt && e.attempts > 0 && (
                    <button
                      type="button"
                      className={outline}
                      onClick={() => void backend.retryPartnerEvent(e.id).then(reload, (err) => onMessage(errorMessage(err), false))}
                    >
                      {t.partners.retry}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </section>
    </div>
  );
}
