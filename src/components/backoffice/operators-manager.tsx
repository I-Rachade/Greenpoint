"use client";

import { useState, type FormEvent } from "react";
import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { OPERATOR_NAME_MAX, type AdminOperator, type OperatorInput, type OperatorStation } from "@shared/operators";
import { card, field, Loading, Pill, StaleNotice } from "./shared";

const button = "rounded-full bg-gp-green-dark px-3 py-1 text-xs text-white disabled:opacity-30";
const outline = "rounded-full border border-black/15 px-3 py-1 text-xs dark:border-white/20";

function OperatorForm({
  operator,
  onDone,
  onCancel,
}: {
  operator: AdminOperator | null;
  onDone: (msg: string, ok: boolean) => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const [form, setForm] = useState<OperatorInput>({ name: operator?.name ?? "", contactPhone: operator?.contactPhone ?? "" });

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await backend.saveOperator(operator?.id ?? null, { name: form.name, contactPhone: form.contactPhone?.trim() || null });
      onDone(t.operators.saved, true);
    } catch (err) {
      onDone(errorMessage(err), false);
    }
  }

  return (
    <form onSubmit={submit} className={`${card} grid gap-3 sm:grid-cols-2`}>
      <label className="space-y-1 text-sm">
        <span>{t.operators.name}</span>
        <input
          className={`${field} w-full`}
          required
          maxLength={OPERATOR_NAME_MAX}
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
      </label>
      <label className="space-y-1 text-sm">
        <span>{t.operators.contactPhone}</span>
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
          {t.operators.save}
        </button>
        <button type="button" onClick={onCancel} className="rounded-full border border-black/15 px-4 py-1.5 text-sm dark:border-white/20">
          {t.operators.cancel}
        </button>
      </div>
    </form>
  );
}

/** Stations shown before "Show all". */
const STATIONS_PREVIEW = 5;

function StationList({ stations }: { stations: OperatorStation[] }) {
  const { t } = useI18n();
  const [all, setAll] = useState(false);
  if (!stations.length) return <p className="text-zinc-500">{t.operators.noStations}</p>;
  const shown = all ? stations : stations.slice(0, STATIONS_PREVIEW);
  return (
    <>
      <ul className={`divide-y divide-black/5 dark:divide-white/10 ${all ? "max-h-80 overflow-y-auto pr-1" : ""}`}>
        {shown.map((s) => (
          <li key={s.id} className="flex items-center gap-2 py-1.5">
            <span className="min-w-0 flex-1">
              <span className={s.isActive ? "" : "text-zinc-500"}>{s.name}</span>
              {s.address && <span className="block truncate text-xs text-zinc-500">{s.address}</span>}
            </span>
            {s.isActive ? (
              <Pill tone="green">{t.operators.stationActive}</Pill>
            ) : (
              <Pill tone={s.pausedWithOperator ? "amber" : "gray"}>{s.pausedWithOperator ? t.operators.stationPaused : t.operators.stationInactive}</Pill>
            )}
          </li>
        ))}
      </ul>
      {stations.length > STATIONS_PREVIEW && (
        <button type="button" className="text-xs font-medium text-gp-green-dark underline dark:text-gp-green" onClick={() => setAll((v) => !v)}>
          {all ? t.operators.hideStations : format(t.operators.showStations, { n: stations.length })}
        </button>
      )}
    </>
  );
}

function OperatorCard({
  operator,
  onChanged,
  onMessage,
}: {
  operator: AdminOperator;
  onChanged: () => void;
  onMessage: (msg: string, ok: boolean) => void;
}) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const [editing, setEditing] = useState(false);
  const [contact, setContact] = useState("");

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
      <OperatorForm
        operator={operator}
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

  async function toggleActive() {
    const active = !operator.isActive;
    if (!active) {
      const n = operator.stations.filter((s) => s.isActive).length;
      if (!window.confirm(format(t.operators.confirmDeactivate, { operator: operator.name, n }))) return;
    }
    if (await act(() => backend.setOperatorActive(operator.id, active))) {
      onMessage(format(active ? t.operators.activated : t.operators.deactivated, { operator: operator.name }), true);
    }
  }

  async function addOwner(e: FormEvent) {
    e.preventDefault();
    if (await act(() => backend.addOperatorOwner(operator.id, contact))) setContact("");
  }

  return (
    <div className={`${card} space-y-3`}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{operator.name}</h2>
        <Pill tone={operator.isOwn ? "green" : "gray"}>{operator.isOwn ? t.operators.own : t.operators.partner}</Pill>
        {!operator.isActive && <Pill tone="red">{t.operators.inactive}</Pill>}
        <div className="ml-auto flex gap-2">
          <button
            type="button"
            className={operator.isActive ? outline : button}
            aria-pressed={operator.isActive}
            onClick={toggleActive}
          >
            {operator.isActive ? t.operators.deactivate : t.operators.activate}
          </button>
          <button type="button" className={outline} onClick={() => setEditing(true)}>
            {t.operators.edit}
          </button>
        </div>
      </div>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {[operator.contactPhone, format(t.operators.stations, { n: operator.stationCount })].filter(Boolean).join(" · ")}
      </p>
      {!operator.isActive && <p className="text-sm text-red-700 dark:text-red-300">{t.operators.inactiveHint}</p>}
      <div className="space-y-1 text-sm">
        <h3 className="font-medium">{t.operators.stationList}</h3>
        <StationList stations={operator.stations} />
      </div>
      <div className="space-y-1 text-sm">
        <h3 className="font-medium">{t.operators.owners}</h3>
        {operator.owners.length === 0 ? (
          <p className="text-zinc-500">{t.operators.noOwners}</p>
        ) : (
          <ul className="divide-y divide-black/5 dark:divide-white/10">
            {operator.owners.map((o) => (
              <li key={o.userId} className="flex flex-wrap items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1">
                  {o.label}
                  <span className="block text-xs text-zinc-500">{t.operators.accessHint[o.access]}</span>
                </span>
                <Pill tone={o.access === "manage" ? "green" : "gray"}>{t.operators.access[o.access]}</Pill>
                <button
                  type="button"
                  className={outline}
                  onClick={() => {
                    const access = o.access === "read" ? "manage" : "read";
                    if (access === "manage" && !window.confirm(format(t.operators.confirmManage, { user: o.label, operator: operator.name }))) return;
                    act(() => backend.setOperatorOwnerAccess(operator.id, o.userId, access));
                  }}
                >
                  {o.access === "read" ? t.operators.makeManage : t.operators.makeRead}
                </button>
                <button
                  type="button"
                  className={outline}
                  onClick={() => {
                    if (window.confirm(format(t.operators.confirmRemove, { user: o.label, operator: operator.name }))) {
                      act(() => backend.removeOperatorOwner(operator.id, o.userId));
                    }
                  }}
                >
                  {t.operators.remove}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <form onSubmit={addOwner} className="space-y-1">
        <div className="flex gap-2">
          <input
            className={`${field} min-w-0 flex-1`}
            required
            aria-label={t.operators.ownerContact}
            placeholder={t.operators.ownerContact}
            value={contact}
            onChange={(e) => setContact(e.target.value)}
          />
          <button type="submit" className={button}>
            {t.operators.addOwner}
          </button>
        </div>
        <p className="text-xs text-zinc-500">{t.operators.ownerHint}</p>
      </form>
    </div>
  );
}

/** Backoffice: operators (the companies stations belong to) and the accounts that run them. */
export function OperatorsManager() {
  const { t } = useI18n();
  const { backend } = useApp();
  const { data, error, reload } = useLiveQuery(() => backend.adminOperators());
  const [adding, setAdding] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  if (!data) return <Loading error={error} onRetry={reload} />;
  const onMessage = (text: string, ok: boolean) => setMessage({ text, ok });

  return (
    <div className="space-y-6">
      <StaleNotice error={error} onRetry={reload} />
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t.operators.title}</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.operators.intro}</p>
      </div>
      {message && (
        <p role="status" className={`text-sm ${message.ok ? "text-gp-green-dark dark:text-gp-green" : "text-red-600"}`}>
          {message.text}
        </p>
      )}
      {adding ? (
        <OperatorForm
          operator={null}
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
          {t.operators.add}
        </button>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {data.map((o) => (
          <OperatorCard key={o.id} operator={o} onChanged={reload} onMessage={onMessage} />
        ))}
      </div>
    </div>
  );
}
