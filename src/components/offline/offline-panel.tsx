"use client";

import { useState } from "react";
import { useOffline, useQueuedSwaps } from "@/lib/offline/hooks";
import { flushQueue, removeQueuedSwap, type QueuedSwap } from "@/lib/offline/swap-queue";
import { useApp } from "../app-provider";
import { useI18n } from "../i18n-provider";
import { Badge, Button, useToast } from "../ui";

/**
 * Above every station screen (WorkShell): says the app works without network, how many swaps
 * wait on this phone, and lists them, with "Send now" and a way to remove one entered by mistake.
 * Renders nothing while online with nothing waiting.
 */
export function OfflinePanel() {
  const { t, locale } = useI18n();
  const o = t.offline;
  const { backend, profile } = useApp();
  const offline = useOffline();
  const queue = useQueuedSwaps();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const mine = queue.filter((q) => q.userId === profile?.id);
  const pending = mine.filter((q) => q.status === "pending");
  const refused = mine.filter((q) => q.status === "refused");
  const others = queue.length - mine.length;
  if (!offline && !queue.length) return null;

  async function sendNow() {
    if (!profile) return;
    setBusy(true);
    try {
      const result = await flushQueue(profile.id, (stationId, input) => backend.recordSwap(stationId, input));
      if (result.sent) toast(o.sent(result.sent));
    } finally {
      setBusy(false);
    }
  }

  const time = (iso: string) => new Date(iso).toLocaleString(locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const reason = (q: QueuedSwap) => (t.errors as Record<string, string>)[q.error ?? ""] ?? t.errors.unknown;

  return (
    <section
      role="status"
      className="space-y-2 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-500/40 dark:bg-amber-900/30 dark:text-amber-50"
    >
      {offline && (
        <p>
          <span className="font-semibold">{o.banner}</span> · {o.bannerHint}
        </p>
      )}
      {pending.length > 0 && <p className="font-semibold">{o.pending(pending.length)}</p>}
      {refused.length > 0 && <p className="font-semibold text-red-700 dark:text-red-300">{o.refused(refused.length)}</p>}
      {others > 0 && <p>{o.others(others)}</p>}
      {mine.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {pending.length > 0 && (
            <Button size="sm" onClick={sendNow} disabled={busy}>
              {busy ? o.sending : o.sendNow}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>
            {open ? o.hide : o.show}
          </Button>
        </div>
      )}
      {open && (
        <ul className="space-y-2">
          {mine.map((q) => (
            <li key={q.input.requestId} className="rounded-xl bg-white/70 p-2 dark:bg-black/20">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={q.status === "refused" ? "red" : "amber"}>{q.status === "refused" ? o.refusedLabel : o.pendingLabel}</Badge>
                <span className="font-semibold">{time(q.input.offlineAt)}</span>
                <span className="text-gp-muted">
                  {t.work.swap.customerTypes[q.input.customerType]}
                  {q.input.batteryOut ? ` · ${q.input.batteryOut}` : ""}
                  {q.input.batteryIn ? ` ← ${q.input.batteryIn}` : ""}
                </span>
              </div>
              {q.status === "refused" && <p className="mt-1 text-red-700 dark:text-red-300">{reason(q)}</p>}
              <button
                type="button"
                className="mt-1 min-h-11 text-sm font-semibold text-red-700 underline dark:text-red-300"
                onClick={() => {
                  if (window.confirm(o.removeConfirm)) removeQueuedSwap(q.input.requestId);
                }}
              >
                {o.remove}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
