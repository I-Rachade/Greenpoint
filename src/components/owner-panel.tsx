"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import type { OperatorStaff } from "@/lib/operators";
import type { StationView } from "@/lib/types";
import { useApp } from "./app-provider";
import { useI18n } from "./i18n-provider";
import { LoadFailed } from "./load-state";
import { StaleNotice } from "./stale-notice";

const card = "space-y-3 rounded-xl border border-black/10 p-4 dark:border-white/10";
const field = "rounded-lg border border-black/15 bg-white px-3 py-1.5 text-sm dark:border-white/20 dark:bg-zinc-900";
const button = "rounded-full bg-gp-green-dark px-4 py-1.5 text-sm text-white disabled:opacity-30";
const outline = "rounded-full border border-black/15 px-3 py-1 text-xs dark:border-white/20";

function StationCard({
  station,
  staff,
  onChanged,
  onMessage,
}: {
  station: StationView;
  staff: OperatorStaff[];
  onChanged: () => void;
  onMessage: (text: string, ok: boolean) => void;
}) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const [contact, setContact] = useState("");
  const [hours, setHours] = useState(station.openingHours);
  const [phone, setPhone] = useState(station.phone ?? "");
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    try {
      await action();
      if (success) onMessage(success, true);
      onChanged();
      return true;
    } catch (err) {
      onMessage(errorMessage(err), false);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function addStaff(e: FormEvent) {
    e.preventDefault();
    const ok = await run(
      () => backend.ownerAddStaff(station.id, contact),
      format(t.owner.added, { user: contact.trim(), station: station.name }),
    );
    if (ok) setContact("");
  }

  function saveDetails(e: FormEvent) {
    e.preventDefault();
    run(() => backend.ownerSaveStation(station.id, { openingHours: hours, phone: phone.trim() || null }), t.owner.saved);
  }

  return (
    <section className={card}>
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-lg font-semibold">{station.name}</h2>
        <span className="text-sm text-zinc-500">{station.address}</span>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">{t.owner.staff}</h3>
        {staff.length === 0 ? (
          <p className="text-sm text-zinc-500">{t.owner.noStaff}</p>
        ) : (
          <ul className="divide-y divide-black/5 text-sm dark:divide-white/10">
            {staff.map((s) => (
              <li key={s.userId} className="flex items-center gap-2 py-1.5">
                <span className="flex-1">{s.label}</span>
                <button
                  type="button"
                  className={outline}
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(format(t.owner.confirmRemove, { user: s.label, station: station.name }))) {
                      run(() => backend.ownerRemoveStaff(station.id, s.userId));
                    }
                  }}
                >
                  {t.owner.remove}
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={addStaff} className="space-y-1">
          <label className="block text-sm">
            <span className="sr-only">{t.owner.staffContact}</span>
            <div className="flex gap-2">
              <input
                className={`${field} min-w-0 flex-1`}
                required
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder={t.owner.staffContact}
              />
              <button type="submit" className={button} disabled={busy}>
                {t.owner.add}
              </button>
            </div>
          </label>
          <p className="text-xs text-zinc-500">{t.owner.staffHint}</p>
        </form>
      </div>

      <form onSubmit={saveDetails} className="space-y-2">
        <h3 className="text-sm font-medium">{t.owner.details}</h3>
        <label className="block space-y-1 text-sm">
          <span>{t.station.openingHours}</span>
          <input className={`${field} w-full`} required maxLength={200} value={hours} onChange={(e) => setHours(e.target.value)} />
        </label>
        <label className="block space-y-1 text-sm">
          <span>{t.owner.phone}</span>
          <input className={`${field} w-full`} type="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </label>
        <button type="submit" className={button} disabled={busy}>
          {t.owner.save}
        </button>
      </form>
    </section>
  );
}

/** /exploitant: the stations of the operators the signed-in account runs, their staff and details. */
export function OwnerPanel() {
  const { t } = useI18n();
  const { backend } = useApp();
  const { data, error, reload } = useLiveQuery(() => backend.ownerView());
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  // A failed refresh keeps the last data on screen; only nothing at all is an error page.
  if (!data) return error ? <LoadFailed error={error} onRetry={reload} /> : <p className="p-6 text-sm text-zinc-500">{t.loading}</p>;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 overflow-y-auto p-6">
      <h1 className="text-2xl font-semibold">{t.owner.title}</h1>
      <StaleNotice error={error} onRetry={reload} />
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {format(t.owner.intro, { operators: data.operators.map((o) => o.name).join(", ") })}
      </p>
      {data.stations.length > 0 && (
        <Link href="/operator" className="inline-block text-sm text-gp-green-dark underline dark:text-gp-green">
          {t.owner.statusLink}
        </Link>
      )}
      {message && (
        <p role="status" className={`text-sm ${message.ok ? "text-gp-green-dark dark:text-gp-green" : "text-red-600"}`}>
          {message.text}
        </p>
      )}
      {data.stations.length === 0 && <p className="text-sm">{t.owner.noStations}</p>}
      {data.stations.map((s) => (
        <StationCard
          key={s.id}
          station={s}
          staff={data.staff.filter((p) => p.stationId === s.id)}
          onChanged={reload}
          onMessage={(text, ok) => setMessage({ text, ok })}
        />
      ))}
    </div>
  );
}
