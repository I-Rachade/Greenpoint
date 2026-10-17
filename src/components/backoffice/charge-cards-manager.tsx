"use client";

import { useState, type FormEvent } from "react";
import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import type { ChargeCard } from "@/lib/charge-cards";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { card, field, Pill, StaleNotice, Table, td, th, useDateTime, userLabel } from "./shared";

type Message = { ok: boolean; text: string } | null;

const smallBtn = "rounded-full border border-black/15 px-3 py-1 text-xs font-medium dark:border-white/20";

/**
 * Backoffice "Recharges" > charging cards: link a card to a customer by its number (typed,
 * or taken from a card swiped at a socket), block a lost card, delete one.
 */
export function ChargeCardsManager() {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const when = useDateTime();
  const { data, error, reload } = useLiveQuery(() => backend.adminChargeCards());
  const [idTag, setIdTag] = useState("");
  const [contact, setContact] = useState("");
  const [label, setLabel] = useState("");
  const [message, setMessage] = useState<Message>(null);
  const c = t.charging.admin.cards;

  async function run(action: () => Promise<void>, done?: string) {
    try {
      await action();
      setMessage(done ? { ok: true, text: done } : null);
      reload();
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const tag = idTag.trim().toUpperCase();
    void run(async () => {
      await backend.saveChargeCard({ idTag: tag, contact: contact.trim(), label: label.trim() || null });
      setIdTag("");
      setContact("");
      setLabel("");
    }, format(c.saved, { tag }));
  }

  /** Puts a card's number into the form, to link it. */
  function pick(x: ChargeCard) {
    setIdTag(x.idTag);
    setLabel(x.label ?? "");
    setMessage(null);
  }

  return (
    <section className={`${card} space-y-3`}>
      <h2 className="font-semibold">{c.title}</h2>
      <p className="text-xs text-zinc-500">{c.intro}</p>
      <StaleNotice error={data ? error : undefined} onRetry={reload} />
      <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-xs">
          <span className="block text-zinc-500">{c.number}</span>
          <input className={`${field} w-40 font-mono uppercase`} required maxLength={24} value={idTag} onChange={(e) => setIdTag(e.target.value)} />
        </label>
        <label className="space-y-1 text-xs">
          <span className="block text-zinc-500">{c.contact}</span>
          <input className={`${field} w-56`} required value={contact} onChange={(e) => setContact(e.target.value)} />
        </label>
        <label className="space-y-1 text-xs">
          <span className="block text-zinc-500">{c.label}</span>
          <input className={`${field} w-40`} maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
        <button type="submit" className="rounded-full bg-gp-green-dark px-4 py-1.5 text-sm font-medium text-white">
          {c.save}
        </button>
      </form>
      {message && <p className={`text-sm ${message.ok ? "text-gp-green-dark dark:text-gp-green" : "text-red-600"}`}>{message.text}</p>}
      {!data ? (
        <p className="text-sm text-zinc-500">{error ? errorMessage(error) : t.loading}</p>
      ) : data.length === 0 ? (
        <p className="text-sm text-zinc-500">{c.none}</p>
      ) : (
        <Table
          head={
            <>
              <th className={th}>{c.columns.card}</th>
              <th className={th}>{c.columns.customer}</th>
              <th className={th}>{c.columns.swiped}</th>
              <th className={th}>{c.columns.status}</th>
              <th className={th} />
            </>
          }
        >
          {data.map((x) => (
            <tr key={x.idTag}>
              <td className={td}>
                <span className="font-mono">{x.idTag}</span>
                {x.label && <div className="text-xs text-zinc-500">{x.label}</div>}
              </td>
              <td className={td}>{x.customer ? userLabel(x.customer) : <Pill tone="amber">{c.notLinked}</Pill>}</td>
              <td className={td}>{x.lastSwipedAt ? format(c.swiped, { when: when(x.lastSwipedAt), device: x.lastDevice ?? "?" }) : c.neverSwiped}</td>
              <td className={td}>{x.blocked ? <Pill tone="red">{c.blocked}</Pill> : x.customer ? <Pill tone="green">{c.active}</Pill> : null}</td>
              <td className={`${td} whitespace-nowrap text-right`}>
                <span className="inline-flex gap-1">
                  <button type="button" className={smallBtn} onClick={() => pick(x)}>
                    {c.link}
                  </button>
                  {x.customer && (
                    <button type="button" className={smallBtn} onClick={() => void run(() => backend.setChargeCardBlocked(x.idTag, !x.blocked))}>
                      {x.blocked ? c.unblock : c.block}
                    </button>
                  )}
                  <button
                    type="button"
                    className={`${smallBtn} text-red-700 dark:text-red-300`}
                    onClick={() => window.confirm(format(c.confirmRemove, { tag: x.idTag })) && void run(() => backend.deleteChargeCard(x.idTag))}
                  >
                    {c.remove}
                  </button>
                </span>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </section>
  );
}
