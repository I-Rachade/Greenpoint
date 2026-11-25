"use client";

import { useState, type FormEvent } from "react";
import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import type { ChargeCard } from "@shared/charge-cards";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format, formatXof } from "@/lib/i18n/format";
import { card, field, Pill, StaleNotice, Table, td, th, useDateTime, userLabel } from "./shared";

type Message = { ok: boolean; text: string } | null;

const smallBtn = "rounded-full border border-black/15 px-3 py-1 text-xs font-medium dark:border-white/20";

/**
 * Backoffice "Recharges" > charging cards: link a card to a customer's account by its number
 * (typed, or taken from a card swiped at a socket); an account may have several cards, all
 * paying with its Green Credit. Block a lost card, refund an old card credit, delete a card
 * without credit. Cards are not topped up: the customer loads Green Credit with their QR code.
 */
export function ChargeCardsManager() {
  const { t, locale } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const when = useDateTime();
  const { data, error, reload } = useLiveQuery(() => backend.adminChargeCards());
  const [idTag, setIdTag] = useState("");
  const [contact, setContact] = useState("");
  const [label, setLabel] = useState("");
  const [message, setMessage] = useState<Message>(null);
  const [adjusting, setAdjusting] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const c = t.charging.admin.cards;
  const xof = (n: number) => formatXof(n, locale);

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

  /** Puts a card into the form, to name it or link it to a customer. */
  function pick(x: ChargeCard) {
    setIdTag(x.idTag);
    setLabel(x.label ?? "");
    setContact(x.customer?.phone ?? x.customer?.email ?? "");
    setMessage(null);
  }

  function adjust(e: FormEvent, tag: string) {
    e.preventDefault();
    const value = Number(amount);
    void run(async () => {
      await backend.adjustChargeCard(tag, value, reason.trim());
      setAdjusting(null);
      setAmount("");
      setReason("");
    }, format(c.adjusted, { tag, amount: xof(value) }));
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
              <th className={th}>{c.columns.balance}</th>
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
              <td className={`${td} whitespace-nowrap ${x.balanceXof < 0 ? "text-red-600" : ""}`}>
                {xof(x.balanceXof)}
                {adjusting === x.idTag && (
                  <form onSubmit={(e) => adjust(e, x.idTag)} className="mt-2 flex flex-wrap items-center gap-1">
                    <input
                      className={`${field} w-24`}
                      type="number"
                      step={5}
                      required
                      placeholder={c.adjustAmount}
                      aria-label={c.adjustAmount}
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                    <input
                      className={`${field} w-40`}
                      required
                      maxLength={120}
                      placeholder={c.adjustReason}
                      aria-label={c.adjustReason}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                    <button type="submit" className={smallBtn}>
                      {c.adjustSave}
                    </button>
                  </form>
                )}
              </td>
              <td className={td}>{x.customer ? userLabel(x.customer) : <span className="text-red-600">{c.noCustomer}</span>}</td>
              <td className={td}>{x.lastSwipedAt ? format(c.swiped, { when: when(x.lastSwipedAt), device: x.lastDevice ?? "?" }) : c.neverSwiped}</td>
              <td className={td}>{x.blocked ? <Pill tone="red">{c.blocked}</Pill> : <Pill tone="green">{c.active}</Pill>}</td>
              <td className={`${td} whitespace-nowrap text-right`}>
                <span className="inline-flex gap-1">
                  <button type="button" className={smallBtn} onClick={() => pick(x)}>
                    {c.edit}
                  </button>
                  {/* Only an old card credit is left to correct or refund (cards are no longer topped up). */}
                  {(x.balanceXof !== 0 || adjusting === x.idTag) && (
                    <button
                      type="button"
                      className={smallBtn}
                      onClick={() => {
                        setAdjusting(adjusting === x.idTag ? null : x.idTag);
                        setAmount("");
                        setReason("");
                      }}
                    >
                      {c.adjust}
                    </button>
                  )}
                  <button type="button" className={smallBtn} onClick={() => void run(() => backend.setChargeCardBlocked(x.idTag, !x.blocked))}>
                    {x.blocked ? c.unblock : c.block}
                  </button>
                  {x.balanceXof === 0 && (
                    <button
                      type="button"
                      className={`${smallBtn} text-red-700 dark:text-red-300`}
                      onClick={() => window.confirm(format(c.confirmRemove, { tag: x.idTag })) && void run(() => backend.deleteChargeCard(x.idTag))}
                    >
                      {c.remove}
                    </button>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </section>
  );
}
