"use client";

import { useState, type FormEvent } from "react";
import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import { Loaded, ResponsiveRows, Section, useWhen, useXof } from "@/components/owner/shared";
import { Badge, EmptyState, type BadgeTone } from "@/components/ui";
import {
  BATTERY_LIST_MAX,
  BATTERY_STATUSES,
  parseSerials,
  type BatteryDetail,
  type BatteryHistoryEntry,
  type BatteryStatus,
  type BatteryView,
} from "@/lib/batteries";
import { batteryTypeLabel, groupByBrand } from "@/lib/battery-types";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";

export const STATUS_TONE: Record<BatteryStatus, BadgeTone> = { in_service: "green", repair: "amber", lost: "red", retired: "neutral" };

const chip = (active: boolean) =>
  `inline-flex min-h-10 items-center whitespace-nowrap rounded-full border px-4 text-sm font-semibold ${
    active ? "border-gp-forest bg-gp-forest text-white" : "border-gp-border bg-gp-surface hover:bg-black/5 dark:hover:bg-white/10"
  }`;
const input = "min-h-11 rounded-xl border border-gp-border bg-gp-surface px-3 text-base sm:text-sm";

/**
 * The battery register (src/lib/batteries.ts): batteries per brand with their own history.
 * Admins (/admin/batteries) register numbers and change a status; owners (backoffice tab)
 * read the batteries of their stations. `stationId`: only those that went through it.
 */
export function BatteryRegistry({ stationId = null }: { stationId?: string | null }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const b = t.batteries;
  const [brand, setBrand] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<BatteryStatus | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);
  const { data, error, reload } = useLiveQuery(
    () => backend.listBatteries({ brand, q: q.trim() || null, status, stationId }),
    `${brand ?? "*"}:${q.trim()}:${status ?? ""}:${stationId ?? ""}`,
  );

  if (open) return <BatteryHistory id={open} onBack={() => setOpen(null)} />;

  const brandName = (x: string) => x || b.unknownBrand;
  const total = data?.brands.reduce((n, x) => n + x.count, 0) ?? 0;

  return (
    <div className="space-y-4">
      <Loaded data={data} error={error} reload={reload}>
        {(list) => (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-gp-muted">{list.canEdit ? b.intro : b.introOwner}</p>
              {list.canEdit && !registering && (
                <button type="button" onClick={() => setRegistering(true)} className="min-h-11 rounded-full bg-gp-green-dark px-4 text-sm font-semibold text-white">
                  {b.register.button}
                </button>
              )}
            </div>
            {registering && <RegisterForm onClose={() => setRegistering(false)} onDone={reload} />}

            <div role="tablist" aria-label={b.title} className="flex gap-2 overflow-x-auto pb-1">
              <button type="button" role="tab" aria-selected={brand === null} className={chip(brand === null)} onClick={() => setBrand(null)}>
                {format(b.all, { n: total })}
              </button>
              {list.brands.map((x) => (
                <button key={x.brand} type="button" role="tab" aria-selected={brand === x.brand} className={chip(brand === x.brand)} onClick={() => setBrand(x.brand)}>
                  {format(b.brandCount, { brand: brandName(x.brand), n: x.count })}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <label className="min-w-0 flex-1 sm:max-w-xs">
                <span className="sr-only">{b.search}</span>
                <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={b.search} className={`${input} w-full font-mono uppercase placeholder:font-sans placeholder:normal-case`} />
              </label>
              <label>
                <span className="sr-only">{b.status}</span>
                <select value={status ?? ""} onChange={(e) => setStatus((e.target.value || null) as BatteryStatus | null)} className={input}>
                  <option value="">{b.anyStatus}</option>
                  {BATTERY_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {b.statuses[s]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {list.batteries.length === 0 ? (
              <EmptyState text={total === 0 ? b.emptyAll : b.empty} />
            ) : (
              <Section title={brand === null ? b.title : brandName(brand)} aside={<span className="text-sm text-gp-muted">{format(b.swapsCount, { n: list.batteries.reduce((n, x) => n + x.swaps, 0) })}</span>}>
                <BatteryRows batteries={list.batteries} onOpen={setOpen} />
                {list.batteries.length >= BATTERY_LIST_MAX && <p className="text-xs text-gp-muted">{format(b.more, { n: BATTERY_LIST_MAX })}</p>}
              </Section>
            )}
          </>
        )}
      </Loaded>
    </div>
  );
}

function useWhere() {
  const { t } = useI18n();
  const w = t.batteries.where;
  return (x: Pick<BatteryView, "location" | "stationName" | "holder">) =>
    x.location === "station"
      ? format(w.station, { station: x.stationName ?? "–" })
      : x.location === "customer"
        ? x.holder
          ? format(w.customer, { person: x.holder })
          : w.customerUnknown
        : w.unknown;
}

function BatteryRows({ batteries, onOpen }: { batteries: BatteryView[]; onOpen: (id: string) => void }) {
  const { t } = useI18n();
  const b = t.batteries;
  const when = useWhen();
  const where = useWhere();
  const serial = (x: BatteryView) => (
    <button type="button" onClick={() => onOpen(x.id)} className="font-mono font-semibold text-gp-green-dark underline-offset-2 hover:underline dark:text-gp-green" aria-label={`${b.open} ${x.serial}`}>
      {x.serial}
    </button>
  );
  const flags = (x: BatteryView) => (
    <span className="inline-flex flex-wrap gap-1">
      <Badge tone={STATUS_TONE[x.status]}>{b.statuses[x.status]}</Badge>
      {x.source === "swap" && <Badge tone="blue">{b.addedAtSwap}</Badge>}
    </span>
  );
  return (
    <ResponsiveRows<BatteryView>
      rows={batteries}
      rowKey={(x) => x.id}
      card={(x) => (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            {serial(x)}
            <span className="text-xs tabular-nums text-gp-muted">{x.lastSwapAt ? when(x.lastSwapAt) : b.never}</span>
          </div>
          <div className="text-gp-muted">{[x.typeLabel ?? (x.brand || b.unknownBrand), where(x), format(b.swapsCount, { n: x.swaps })].join(" · ")}</div>
          {flags(x)}
        </div>
      )}
      columns={[
        { label: b.columns.serial, cell: serial },
        { label: b.columns.model, cell: (x) => x.typeLabel ?? <span className="text-gp-muted">{x.brand || b.unknownBrand}</span> },
        { label: b.columns.status, cell: flags },
        { label: b.columns.where, cell: where },
        { label: b.columns.swaps, cell: (x) => x.swaps, className: "text-right tabular-nums" },
        { label: b.columns.last, cell: (x) => (x.lastSwapAt ? when(x.lastSwapAt) : <span className="text-gp-muted">{b.never}</span>), className: "tabular-nums whitespace-nowrap" },
      ]}
    />
  );
}

function RegisterForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const r = t.batteries.register;
  const { data: types } = useLiveQuery(() => backend.listBatteryTypes());
  const [typeId, setTypeId] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const active = (types ?? []).filter((x) => x.isActive);
  const parsed = parseSerials(text);
  const chosen = typeId || active[0]?.id || "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!chosen || parsed.serials.length === 0) return;
    setBusy(true);
    try {
      const res = await backend.registerBatteries({ batteryTypeId: chosen, serials: parsed.serials });
      const invalid = [...parsed.invalid, ...res.invalid];
      setMessage({
        ok: true,
        lines: [
          format(r.done, { n: res.added }),
          ...(res.existing.length ? [format(r.existing, { list: res.existing.join(", ") })] : []),
          ...(invalid.length ? [format(r.invalid, { list: invalid.join(", ") })] : []),
        ],
      });
      setText("");
      onDone();
    } catch (err) {
      setMessage({ ok: false, lines: [errorMessage(err)] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={r.title}>
      {types && active.length === 0 ? (
        <p className="text-sm text-gp-muted">{r.noTypes}</p>
      ) : (
        <form onSubmit={submit} className="space-y-3">
          <label className="block space-y-1 text-sm">
            <span className="block font-medium">{r.type}</span>
            <select value={chosen} onChange={(e) => setTypeId(e.target.value)} className={`${input} w-full sm:w-auto`}>
              {groupByBrand(active).map(([brandName, models]) => (
                <optgroup key={brandName} label={brandName}>
                  {models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {batteryTypeLabel(m)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-sm">
            <span className="block font-medium">{r.serials}</span>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} className="w-full rounded-xl border border-gp-border bg-gp-surface p-3 font-mono text-base uppercase sm:text-sm" />
            <span className="block text-xs text-gp-muted">
              {r.serialsHint} {parsed.serials.length > 0 && format(r.count, { n: parsed.serials.length })}
            </span>
          </label>
          {message && (
            <div role={message.ok ? "status" : "alert"} className={`space-y-0.5 text-sm ${message.ok ? "text-gp-green-dark dark:text-gp-green" : "text-red-600"}`}>
              {message.lines.map((l) => (
                <p key={l}>{l}</p>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="min-h-11 rounded-full px-4 text-sm font-medium">
              {r.cancel}
            </button>
            <button type="submit" disabled={busy || parsed.serials.length === 0 || !chosen} className="min-h-11 rounded-full bg-gp-green-dark px-5 text-sm font-semibold text-white disabled:opacity-50">
              {r.submit}
            </button>
          </div>
        </form>
      )}
    </Section>
  );
}

function BatteryHistory({ id, onBack }: { id: string; onBack: () => void }) {
  const { t, locale } = useI18n();
  const { backend } = useApp();
  const b = t.batteries;
  const where = useWhere();
  const { data, error, reload } = useLiveQuery(() => backend.batteryDetail(id), id);
  const dateFmt = new Intl.DateTimeFormat(locale === "fr" ? "fr-TG" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center text-sm font-semibold text-gp-green-dark underline-offset-2 hover:underline dark:text-gp-green">
        ← {b.back}
      </button>
      {!data && error ? (
        <EmptyState text={b.detail.notFound} />
      ) : (
        <Loaded data={data} error={error} reload={reload}>
          {(x: BatteryDetail) => (
            <>
              <Section title={x.serial} aside={<Badge tone={STATUS_TONE[x.status]}>{b.statuses[x.status]}</Badge>}>
                <dl className="grid gap-3 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-gp-muted">{b.detail.model}</dt>
                    <dd className="font-medium">{x.typeLabel ?? (x.brand || b.unknownBrand)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gp-muted">{b.columns.where}</dt>
                    <dd className="font-medium">{where(x)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-gp-muted">{b.detail.source}</dt>
                    <dd className="font-medium">{b.detail.sources[x.source]}</dd>
                    <dd className="text-xs text-gp-muted">{format(b.detail.since, { date: dateFmt.format(new Date(x.createdAt)) })}</dd>
                  </div>
                </dl>
              </Section>
              <StatusForm battery={x} onSaved={reload} />
              <Section title={b.detail.history} aside={<span className="text-sm text-gp-muted">{format(b.swapsCount, { n: x.swaps })}</span>}>
                {x.history.length === 0 ? <p className="text-sm text-gp-muted">{b.detail.noHistory}</p> : <Timeline entries={x.history} />}
              </Section>
            </>
          )}
        </Loaded>
      )}
    </div>
  );
}

const DOT: Record<BatteryHistoryEntry["type"], string> = {
  registered: "bg-gp-info",
  added_at_swap: "bg-gp-info",
  out: "bg-gp-green-dark",
  in: "bg-gp-green",
  status: "bg-gp-low",
};

function Timeline({ entries }: { entries: BatteryHistoryEntry[] }) {
  const { t } = useI18n();
  const b = t.batteries;
  const e = b.events;
  const when = useWhen();
  const xof = useXof();
  const title = (h: BatteryHistoryEntry) =>
    h.type === "out"
      ? h.holder
        ? format(e.out, { person: h.holder })
        : h.payment === "cash"
          ? e.outCash
          : e.outSomeone
      : h.type === "status"
        ? format(e.status, { status: h.status ? b.statuses[h.status] : "" })
        : e[h.type];
  return (
    <ol className="relative space-y-4 border-l-2 border-gp-border pl-5">
      {entries.map((h) => (
        <li key={h.id} className="relative">
          <span className={`absolute -left-[27px] top-1.5 h-3 w-3 rounded-full ring-4 ring-gp-surface ${DOT[h.type]}`} aria-hidden />
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className="font-medium">{title(h)}</span>
            <time className="text-xs tabular-nums text-gp-muted" dateTime={h.createdAt}>
              {when(h.createdAt)}
            </time>
          </div>
          <div className="text-sm text-gp-muted">
            {[
              h.stationName,
              h.type === "in" && h.holder ? h.holder : null,
              h.amountXof !== null && (h.type === "out" || h.type === "in") && h.payment ? `${t.work.swap.payments[h.payment as keyof typeof t.work.swap.payments] ?? h.payment} ${xof(h.amountXof)}` : null,
              h.person ? format(b.by, { person: `${h.person} (${b.roles[h.role]})` }) : h.stationId ? e.hidden : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
          {h.reason && <div className="text-sm italic text-gp-muted">« {h.reason} »</div>}
        </li>
      ))}
    </ol>
  );
}

function StatusForm({ battery, onSaved }: { battery: BatteryDetail; onSaved: () => void }) {
  const { t } = useI18n();
  const { backend, profile } = useApp();
  const errorMessage = useErrorMessage();
  const b = t.batteries;
  const [status, setStatus] = useState<BatteryStatus>(battery.status);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  if (profile?.role !== "admin") return null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await backend.setBatteryStatus(battery.id, { status, reason: reason.trim() || null });
      setReason("");
      setMessage({ ok: true, text: b.detail.saved });
      onSaved();
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title={b.detail.changeStatus}>
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-sm">
          <span className="block">{b.status}</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as BatteryStatus)} className={input}>
            {BATTERY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {b.statuses[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-0 flex-1 space-y-1 text-sm">
          <span className="block">{b.detail.reason}</span>
          <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} className={`${input} w-full`} />
        </label>
        <button type="submit" disabled={busy} className="min-h-11 rounded-full bg-gp-green-dark px-5 text-sm font-semibold text-white disabled:opacity-50">
          {b.detail.save}
        </button>
      </form>
      {message && (
        <p role={message.ok ? "status" : "alert"} className={`text-sm ${message.ok ? "text-gp-green-dark dark:text-gp-green" : "text-red-600"}`}>
          {message.text}
        </p>
      )}
    </Section>
  );
}
