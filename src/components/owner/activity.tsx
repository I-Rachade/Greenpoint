"use client";

import { useState } from "react";
import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { ACTIVITY_KINDS, type ActivityEntry, type ActivityKind } from "@shared/owner-activity";
import { LoadFailed } from "@/components/load-state";
import { SkeletonCard } from "@/components/ui";
import { ResponsiveRows, Section, useWhen } from "./shared";

const chip = (active: boolean) =>
  `inline-flex min-h-10 items-center whitespace-nowrap rounded-full border px-4 text-sm font-semibold ${
    active ? "border-gp-forest bg-gp-forest text-white" : "border-gp-border bg-gp-surface hover:bg-black/5 dark:hover:bg-white/10"
  }`;

/**
 * The Activity tab of My stations (shared/owner-activity.ts): every action at the stations and
 * every change to them, newest first, for one station or all, by kind, page by page.
 */
export function ActivityView({ stationId }: { stationId: string | null }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const a = t.owner.activity;
  const when = useWhen();
  const describe = useDescribe();
  const [kind, setKind] = useState<ActivityKind | null>(null);
  const key = `${stationId ?? ""}:${kind ?? ""}`;
  const { data, error: loadError, reload } = useLiveQuery(() => backend.ownerActivity({ stationId, kind }), key);
  // Pages loaded with "Show more", for the filter they were loaded under.
  const [extra, setExtra] = useState<{ key: string; entries: ActivityEntry[]; next: string | null } | null>(null);
  const [moreError, setMoreError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const mine = extra?.key === key ? extra : null;
  const entries = data ? [...data.entries, ...(mine?.entries ?? [])] : null;
  const next = mine ? mine.next : (data?.next ?? null);

  async function more() {
    if (!next) return;
    setLoading(true);
    setMoreError(null);
    try {
      const page = await backend.ownerActivity({ stationId, kind, before: next });
      setExtra({ key, entries: [...(mine?.entries ?? []), ...page.entries], next: page.next });
    } catch (err) {
      setMoreError(err);
    } finally {
      setLoading(false);
    }
  }

  const who = (e: ActivityEntry) => (e.person ? `${e.person}${e.role ? ` (${t.batteries.roles[e.role]})` : ""}` : e.role === "admin" ? a.poinderecharge : a.system);

  return (
    <div className="space-y-4">
      <p className="text-sm text-gp-muted">{a.intro}</p>
      <div role="tablist" aria-label={t.owner.tabs.activity} className="flex gap-2 overflow-x-auto pb-1">
        <button type="button" role="tab" aria-selected={kind === null} className={chip(kind === null)} onClick={() => setKind(null)}>
          {a.kinds.all}
        </button>
        {ACTIVITY_KINDS.map((k) => (
          <button key={k} type="button" role="tab" aria-selected={kind === k} className={chip(kind === k)} onClick={() => setKind(k)}>
            {a.kinds[k]}
          </button>
        ))}
      </div>
      {entries === null ? (
        loadError ? (
          <LoadFailed error={loadError} onRetry={reload} />
        ) : (
          <SkeletonCard />
        )
      ) : (
        <Section title={t.owner.tabs.activity}>
          {entries.length === 0 ? (
            <p className="text-sm text-gp-muted">{a.none}</p>
          ) : (
            <ResponsiveRows<ActivityEntry>
              rows={entries}
              rowKey={(e) => e.id}
              card={(e) => (
                <div className="space-y-1">
                  <div className="font-medium">{describe(e).title}</div>
                  {describe(e).detail && <div className="text-gp-muted">{describe(e).detail}</div>}
                  <div className="text-xs tabular-nums text-gp-muted">
                    {when(e.at)} · {e.stationName} · {who(e)}
                  </div>
                </div>
              )}
              columns={[
                { label: a.when, cell: (e) => <span className="whitespace-nowrap tabular-nums">{when(e.at)}</span> },
                { label: a.station, cell: (e) => e.stationName },
                {
                  label: a.what,
                  cell: (e) => (
                    <span>
                      <span className="font-medium">{describe(e).title}</span>
                      {describe(e).detail && <span className="block text-xs text-gp-muted">{describe(e).detail}</span>}
                    </span>
                  ),
                },
                { label: a.who, cell: who },
              ]}
            />
          )}
          {moreError !== null && <p className="text-sm text-red-600">{errorMessage(moreError)}</p>}
          {next && (
            <button
              type="button"
              disabled={loading}
              onClick={() => void more()}
              className="min-h-11 rounded-full border border-gp-border px-5 text-sm font-semibold hover:bg-black/5 disabled:opacity-60 dark:hover:bg-white/10"
            >
              {a.more}
            </button>
          )}
        </Section>
      )}
    </div>
  );
}

/** A title and a line of detail for an entry, in plain words. */
function useDescribe() {
  const { t } = useI18n();
  const a = t.owner.activity;
  const fields = a.fields as Record<string, string>;
  const value = (key: string, v: unknown) => {
    if (v === null || v === undefined || v === "") return "–";
    if (/^is_/.test(key) && (v === 0 || v === 1 || typeof v === "boolean")) return v ? a.yes : a.no;
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  };
  return (e: ActivityEntry): { title: string; detail: string } => {
    if (e.action !== undefined) {
      const head = e.action.split("/")[0] ?? "";
      return { title: (a.actions as Record<string, string>)[head] ?? e.action, detail: "" };
    }
    const names = (a.changes as Record<string, Record<string, string>>)[e.table ?? ""];
    const title = names?.[e.change ?? "update"] ?? e.table ?? "";
    const detail = Object.entries(e.changes ?? {})
      .filter(([k]) => k in fields)
      .map(([k, v]) =>
        Array.isArray(v) && v.length === 2 ? `${fields[k]} : ${value(k, v[0])} → ${value(k, v[1])}` : `${fields[k]} : ${value(k, v)}`,
      )
      .join(" · ");
    return { title, detail };
  };
}
