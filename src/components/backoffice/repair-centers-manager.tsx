"use client";

import { useState, type FormEvent } from "react";
import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { REPAIR_ADDRESS_MAX, REPAIR_NAME_MAX, type RepairCenter, type RepairCenterInput } from "@/lib/repair-centers";
import { card, field, Loading, Pill, StaleNotice } from "./shared";

const EMPTY: RepairCenterInput = { operatorId: null, name: "", address: "", lat: 6.1725, lng: 1.2314, phone: null, openingHours: "", isActive: true };

const inputOf = (r: RepairCenter): RepairCenterInput => ({
  operatorId: r.operatorId,
  name: r.name,
  address: r.address,
  lat: r.lat,
  lng: r.lng,
  phone: r.phone,
  openingHours: r.openingHours,
  isActive: r.isActive,
});

/** Backoffice page for repair workshops away from stations (src/lib/repair-centers.ts). */
export function RepairCentersManager() {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const { data: centers, error, reload } = useLiveQuery(() => backend.adminRepairCenters());
  const { data: operators, error: opError, reload: reloadOps } = useLiveQuery(() => backend.listOperators());
  // null = no form; "new" = adding; otherwise the id being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const retry = () => {
    reload();
    reloadOps();
  };
  if (!centers || !operators) return <Loading error={error ?? opError} onRetry={retry} />;

  const b = t.backoffice.repairCenters;
  const brands = [...operators].sort((x, y) => x.name.localeCompare(y.name)).map((o) => ({ id: o.id, name: o.name }));

  async function run(action: () => Promise<void>, success: string) {
    try {
      await action();
      setMessage({ ok: true, text: success });
      reload();
      return true;
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
      return false;
    }
  }

  const form = (center: RepairCenter | null) => (
    <CenterForm
      initial={center ? inputOf(center) : EMPTY}
      brands={brands}
      onCancel={() => setEditing(null)}
      onSave={async (input) => {
        const name = input.name.trim();
        const ok = await run(() => backend.saveRepairCenter(center?.id ?? null, input), format(center ? b.saved : b.added, { name }));
        if (ok) setEditing(null);
      }}
    />
  );

  return (
    <div className="space-y-4">
      <StaleNotice error={error ?? opError} onRetry={retry} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{b.title}</h1>
        {editing === null && (
          <button
            type="button"
            onClick={() => {
              setMessage(null);
              setEditing("new");
            }}
            className="rounded-full bg-gp-green-dark px-4 py-1.5 text-sm font-medium text-white"
          >
            {b.add}
          </button>
        )}
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{b.intro}</p>
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-gp-green-dark" : "text-red-600"}`}>
          {message.text}
        </p>
      )}

      {editing === "new" && form(null)}

      {centers.length === 0 ? (
        <p className={`${card} text-sm text-zinc-500`}>{b.empty}</p>
      ) : (
        <ul className="space-y-2">
          {centers.map((r) =>
            editing === r.id ? (
              <li key={r.id}>{form(r)}</li>
            ) : (
              <li key={r.id} className={`${card} flex flex-wrap items-center justify-between gap-3`}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 font-medium">
                    {r.name}
                    {!r.isActive && <Pill tone="gray">{b.inactive}</Pill>}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {[r.operatorName ?? b.noBrand, r.address, r.phone].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <button
                    type="button"
                    onClick={() => {
                      setMessage(null);
                      setEditing(r.id);
                    }}
                    className="text-gp-green-dark hover:underline"
                  >
                    {b.edit}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(format(b.confirmRemove, { name: r.name }))) {
                        run(() => backend.deleteRepairCenter(r.id), format(b.removed, { name: r.name }));
                      }
                    }}
                    className="text-red-600 hover:underline"
                  >
                    {b.remove}
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function CenterForm({
  initial,
  brands,
  onSave,
  onCancel,
}: {
  initial: RepairCenterInput;
  brands: { id: string; name: string }[];
  onSave: (input: RepairCenterInput) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const b = t.backoffice.repairCenters;
  const f = b.form;
  const [input, setInput] = useState<RepairCenterInput>(initial);
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<RepairCenterInput>) => setInput((prev) => ({ ...prev, ...patch }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await onSave(input);
    } finally {
      setBusy(false);
    }
  }

  const label = "flex flex-col gap-1 text-sm";
  return (
    <form onSubmit={submit} className={`${card} grid gap-3 sm:grid-cols-2`}>
      <label className={label}>
        {f.name}
        <input required maxLength={REPAIR_NAME_MAX} value={input.name} onChange={(e) => set({ name: e.target.value })} className={field} />
      </label>
      <label className={label}>
        {f.brand}
        <select value={input.operatorId ?? ""} onChange={(e) => set({ operatorId: e.target.value || null })} className={field}>
          <option value="">{b.noBrand}</option>
          {brands.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>
      <label className={`${label} sm:col-span-2`}>
        {f.address}
        <input maxLength={REPAIR_ADDRESS_MAX} value={input.address} onChange={(e) => set({ address: e.target.value })} className={field} />
      </label>
      <label className={label}>
        {f.lat}
        <input type="number" required min={-90} max={90} step="any" value={input.lat} onChange={(e) => set({ lat: Number(e.target.value) })} className={field} />
      </label>
      <label className={label}>
        {f.lng}
        <input type="number" required min={-180} max={180} step="any" value={input.lng} onChange={(e) => set({ lng: Number(e.target.value) })} className={field} />
      </label>
      <label className={label}>
        {f.phone}
        <input type="tel" maxLength={40} value={input.phone ?? ""} onChange={(e) => set({ phone: e.target.value || null })} className={field} />
      </label>
      <label className={label}>
        {f.hours}
        <input value={input.openingHours} onChange={(e) => set({ openingHours: e.target.value })} className={field} />
      </label>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" checked={input.isActive} onChange={(e) => set({ isActive: e.target.checked })} className="accent-gp-green-dark" />
        {f.active}
      </label>
      <div className="flex items-end justify-end gap-2 sm:col-span-2">
        <button type="button" onClick={onCancel} className="rounded-full px-4 py-1.5 text-sm text-zinc-700 dark:text-zinc-300">
          {f.cancel}
        </button>
        <button type="submit" disabled={busy} className="rounded-full bg-gp-green-dark px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {f.save}
        </button>
      </div>
    </form>
  );
}
