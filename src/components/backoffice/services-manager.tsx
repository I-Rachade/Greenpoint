"use client";

import { useState } from "react";
import { useApp } from "@/components/app-provider";
import { ConfirmSheet } from "@/components/confirm-sheet";
import { useI18n } from "@/components/i18n-provider";
import { SERVICE_TONE } from "@/components/owner-panel";
import { Badge, Button, Card, EmptyState, Input, useToast } from "@/components/ui";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { serviceDisplay, type StationServiceInfo } from "@shared/station-services";
import { Loading, StaleNotice, useDateTime } from "./shared";

const key = (s: Pick<StationServiceInfo, "stationId" | "service">) => `${s.stationId}:${s.service}`;

/**
 * /admin/services: owners' pending requests to decide, and every station's services to
 * switch on or off. A service runs only while its global switch is on too (worker/services.ts).
 */
export function ServicesManager() {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const toast = useToast();
  const when = useDateTime();
  const { data, error, reload } = useLiveQuery(() => backend.stationServices());
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [confirmOff, setConfirmOff] = useState<StationServiceInfo | null>(null);
  if (!data) return <Loading error={error} onRetry={reload} />;

  const s = t.services;
  const names = (info: StationServiceInfo) => ({ service: s.names[info.service], station: info.stationName });

  async function run(info: StationServiceInfo, action: () => Promise<void>, success: string) {
    setBusy(key(info));
    try {
      await action();
      toast(format(success, names(info)), { tone: "success" });
      reload();
      return true;
    } catch (err) {
      toast(errorMessage(err), { tone: "error" });
      return false;
    } finally {
      setBusy(null);
    }
  }

  const pending = data.filter((r) => r.status === "pending");
  const query = search.trim().toLowerCase();
  const stations = [...new Map(data.map((r) => [r.stationId, r.stationName])).entries()].filter(([, name]) => name.toLowerCase().includes(query));

  return (
    <div className="space-y-4">
      <StaleNotice error={error} onRetry={reload} />
      <h1 className="text-2xl font-semibold">{s.adminTitle}</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{s.adminIntro}</p>

      <Card className="space-y-3 p-4">
        <h2 className="font-semibold">{s.pendingTitle}</h2>
        {pending.length === 0 ? (
          <p className="text-sm text-zinc-500">{s.noPending}</p>
        ) : (
          <ul className="divide-y divide-black/5 dark:divide-white/10">
            {pending.map((r) => (
              <li key={key(r)} className="flex flex-wrap items-center gap-2 py-2">
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-medium">
                    {r.stationName} · {s.names[r.service]}
                  </p>
                  <p className="text-xs text-zinc-500">{format(s.requestedBy, { user: r.requestedBy ?? "?", date: when(r.requestedAt) })}</p>
                </div>
                <Button
                  busy={busy === key(r)}
                  disabled={busy !== null}
                  onClick={() => run(r, () => backend.decideStationService(r.stationId, r.service, true), s.approved)}
                >
                  {s.approve}
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy !== null}
                  onClick={() => run(r, () => backend.decideStationService(r.stationId, r.service, false), s.rejectedDone)}
                >
                  {s.reject}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={s.search} aria-label={s.search} />
      {stations.length === 0 && <EmptyState text={s.noStations} />}
      <div className="grid gap-3 md:grid-cols-2">
        {stations.map(([stationId, name]) => (
          <Card key={stationId} className="space-y-2 p-4">
            <h2 className="font-semibold">{name}</h2>
            <ul className="divide-y divide-black/5 dark:divide-white/10">
              {data
                .filter((r) => r.stationId === stationId)
                .map((r) => {
                  const display = serviceDisplay(r);
                  return (
                    <li key={r.service} className="flex min-h-11 flex-wrap items-center gap-2 py-1.5 text-sm">
                      <div className="min-w-0 flex-1">
                        <p>{s.names[r.service]}</p>
                        {!r.globalOn && <p className="text-xs text-zinc-500">{s.globalOffHint}</p>}
                      </div>
                      <Badge tone={SERVICE_TONE[display]}>{s.status[display]}</Badge>
                      {r.unlocked ? (
                        <Button variant="secondary" disabled={busy !== null} busy={busy === key(r)} onClick={() => setConfirmOff(r)}>
                          {s.lock}
                        </Button>
                      ) : (
                        <Button
                          disabled={busy !== null}
                          busy={busy === key(r)}
                          onClick={() => run(r, () => backend.setStationService(r.stationId, r.service, true), s.unlockedDone)}
                        >
                          {s.unlock}
                        </Button>
                      )}
                    </li>
                  );
                })}
            </ul>
          </Card>
        ))}
      </div>

      <ConfirmSheet
        open={confirmOff !== null}
        title={confirmOff ? format(s.confirmLockTitle, names(confirmOff)) : ""}
        confirmLabel={s.lock}
        danger
        busy={confirmOff !== null && busy === key(confirmOff)}
        onCancel={() => setConfirmOff(null)}
        onConfirm={async () => {
          if (!confirmOff) return;
          await run(confirmOff, () => backend.setStationService(confirmOff.stationId, confirmOff.service, false), s.lockedDone);
          setConfirmOff(null);
        }}
      >
        <p className="text-sm">{s.confirmLockText}</p>
      </ConfirmSheet>
    </div>
  );
}
