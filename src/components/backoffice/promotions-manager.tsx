"use client";

import { useState, type FormEvent } from "react";
import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import { PromoCard } from "@/components/promo-popup";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { isRunning, safeImage, safeLink, type Promotion, type PromotionInput } from "@shared/promo";
import { card, field, Loading, Pill, StaleNotice, useDateTime } from "./shared";

const EMPTY: PromotionInput = {
  title: "",
  body: "",
  imageUrl: null,
  linkUrl: null,
  linkLabel: null,
  isActive: true,
  startsAt: null,
  endsAt: null,
};

/** ISO time -> value of a datetime-local input, in the admin's own timezone. */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

type State = "live" | "scheduled" | "ended" | "off";

function stateOf(p: Promotion, now: Date): State {
  if (!p.isActive) return "off";
  if (isRunning(p, now)) return "live";
  return p.startsAt && new Date(p.startsAt) > now ? "scheduled" : "ended";
}

const TONE: Record<State, "green" | "blue" | "gray"> = { live: "green", scheduled: "blue", ended: "gray", off: "gray" };

/** Backoffice page for the ad shown when the app opens. */
export function PromotionsManager() {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const dateTime = useDateTime();
  const { data: list, error, reload } = useLiveQuery(() => backend.listPromotions());
  const [editing, setEditing] = useState<{ id: string | null; input: PromotionInput } | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  if (!list) return <Loading error={error} onRetry={reload} />;

  const b = t.backoffice.promotions;
  const now = new Date();

  async function run(action: () => Promise<void>, success?: string) {
    try {
      await action();
      setMessage(success ? { ok: true, text: success } : null);
      reload();
      return true;
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
      return false;
    }
  }

  function period(p: Promotion) {
    if (!p.startsAt && !p.endsAt) return b.always;
    return [
      p.startsAt && format(b.from, { date: dateTime(p.startsAt) }),
      p.endsAt && format(b.until, { date: dateTime(p.endsAt) }),
    ]
      .filter(Boolean)
      .join(" ");
  }

  return (
    <div className="space-y-4">
      <StaleNotice error={error} onRetry={reload} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{b.title}</h1>
        {!editing && (
          <button
            type="button"
            onClick={() => {
              setMessage(null);
              setEditing({ id: null, input: EMPTY });
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

      {editing && (
        <PromotionEditor
          key={editing.id ?? "new"}
          initial={editing.input}
          onCancel={() => setEditing(null)}
          onUpload={(file) => backend.uploadPromotionImage(file)}
          onError={(err) => setMessage({ ok: false, text: errorMessage(err) })}
          onSave={async (input) => {
            if (await run(() => backend.savePromotion(editing.id, input), b.saved)) setEditing(null);
          }}
        />
      )}

      {list.length === 0 ? (
        <p className={`${card} text-sm text-zinc-500`}>{b.empty}</p>
      ) : (
        <ul className="space-y-2">
          {list.map((p) => {
            const state = stateOf(p, now);
            const image = safeImage(p.imageUrl);
            return (
              <li key={p.id} className={`${card} flex flex-wrap items-center gap-3`}>
                {image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={image} alt="" className="h-14 w-20 shrink-0 rounded-lg bg-zinc-100 object-cover dark:bg-zinc-800" />
                ) : (
                  <div className="h-14 w-20 shrink-0 rounded-lg bg-gp-green/15" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{p.title}</span>
                    <Pill tone={TONE[state]}>{b.state[state]}</Pill>
                  </div>
                  <div className="text-xs text-zinc-500">
                    {b.period}: {period(p)}
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={p.isActive}
                    onChange={(e) => run(() => backend.savePromotion(p.id, { ...p, isActive: e.target.checked }))}
                  />
                  {b.form.active}
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setMessage(null);
                    setEditing({ id: p.id, input: p });
                  }}
                  className="text-sm text-gp-green-dark hover:underline"
                >
                  {b.edit}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(format(b.confirmDelete, { title: p.title }))) run(() => backend.deletePromotion(p.id));
                  }}
                  className="text-sm text-red-600 hover:underline"
                >
                  {b.remove}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function PromotionEditor({
  initial,
  onSave,
  onCancel,
  onUpload,
  onError,
}: {
  initial: PromotionInput;
  onSave: (input: PromotionInput) => Promise<void>;
  onCancel: () => void;
  onUpload: (file: File) => Promise<string>;
  onError: (err: unknown) => void;
}) {
  const { t } = useI18n();
  const f = t.backoffice.promotions.form;
  const [input, setInput] = useState<PromotionInput>(initial);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (patch: Partial<PromotionInput>) => setInput((prev) => ({ ...prev, ...patch }));

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      set({ imageUrl: await onUpload(file) });
    } catch (err) {
      onError(err);
    } finally {
      setUploading(false);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const clean: PromotionInput = {
      ...input,
      title: input.title.trim(),
      body: input.body.trim(),
      imageUrl: input.imageUrl?.trim() || null,
      linkUrl: input.linkUrl?.trim() || null,
      linkLabel: input.linkLabel?.trim() || null,
    };
    if (clean.linkUrl && !safeLink(clean.linkUrl)) return setProblem(f.invalidLink);
    if (clean.imageUrl && !safeImage(clean.imageUrl)) return setProblem(f.invalidLink);
    if (clean.startsAt && clean.endsAt && clean.endsAt <= clean.startsAt) return setProblem(f.invalidPeriod);
    setProblem(null);
    setBusy(true);
    await onSave(clean);
    setBusy(false);
  }

  const isInline = input.imageUrl?.startsWith("data:");

  return (
    <form onSubmit={submit} className={`${card} grid gap-6 lg:grid-cols-[1fr_22rem]`}>
      <div className="space-y-3">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{f.title}</span>
          <input
            required
            maxLength={120}
            value={input.title}
            onChange={(e) => set({ title: e.target.value })}
            className={`${field} w-full`}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">{f.body}</span>
          <textarea
            rows={3}
            maxLength={1000}
            value={input.body}
            onChange={(e) => set({ body: e.target.value })}
            className={`${field} w-full`}
          />
        </label>
        <div className="space-y-1 text-sm">
          <span className="block font-medium">{f.image}</span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            disabled={uploading}
            onChange={(e) => upload(e.target.files?.[0])}
            className="block w-full text-sm"
          />
          <p className="text-xs text-zinc-500">{uploading ? f.uploading : f.imageHint}</p>
          {!isInline && (
            <input
              type="url"
              placeholder={f.imageUrl}
              value={input.imageUrl ?? ""}
              onChange={(e) => set({ imageUrl: e.target.value || null })}
              className={`${field} w-full`}
            />
          )}
          {input.imageUrl && (
            <button type="button" onClick={() => set({ imageUrl: null })} className="text-xs text-red-600 hover:underline">
              {f.removeImage}
            </button>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{f.linkUrl}</span>
            <input
              type="url"
              placeholder="https://"
              value={input.linkUrl ?? ""}
              onChange={(e) => set({ linkUrl: e.target.value || null })}
              className={`${field} w-full`}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{f.linkLabel}</span>
            <input
              maxLength={40}
              placeholder={f.linkLabelPlaceholder}
              value={input.linkLabel ?? ""}
              onChange={(e) => set({ linkLabel: e.target.value || null })}
              className={`${field} w-full`}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{f.startsAt}</span>
            <input
              type="datetime-local"
              value={toLocalInput(input.startsAt)}
              onChange={(e) => set({ startsAt: fromLocalInput(e.target.value) })}
              className={`${field} w-full`}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{f.endsAt}</span>
            <input
              type="datetime-local"
              value={toLocalInput(input.endsAt)}
              onChange={(e) => set({ endsAt: fromLocalInput(e.target.value) })}
              className={`${field} w-full`}
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={input.isActive} onChange={(e) => set({ isActive: e.target.checked })} />
          {f.active}
        </label>
        {problem && (
          <p role="alert" className="text-sm text-red-600">
            {problem}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={busy || uploading}
            className="rounded-full bg-gp-green-dark px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {t.backoffice.promotions.save}
          </button>
          <button type="button" onClick={onCancel} className="rounded-full px-4 py-1.5 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
            {t.backoffice.promotions.cancel}
          </button>
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">{t.backoffice.promotions.preview}</p>
        <div className="rounded-2xl bg-black/60 p-4">
          <PromoCard promo={{ ...input, title: input.title || "…" }} />
        </div>
      </div>
    </form>
  );
}
