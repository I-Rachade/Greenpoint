"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useErrorMessage, useLiveQuery, useRelativeTime } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { loginHref } from "@/lib/next-path";
import { MAX_REVIEW_COMMENT, ratingOf, starCounts, type StationReview } from "@/lib/station-extras";
import type { StationView } from "@/lib/types";
import { useApp } from "./app-provider";
import { StarIcon, TrashIcon } from "./icons";
import { useI18n } from "./i18n-provider";
import { stationHref } from "./station-card";
import { StarInput, Stars } from "./station-look";

/** Reviews shown before "See all reviews". */
const FIRST_REVIEWS = 3;

/** Initials in a coloured circle, in place of a profile photo. */
function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const hue = [...name].reduce((n, c) => n + c.charCodeAt(0), 0) % 4;
  const colors = ["bg-gp-green/20 text-gp-green-dark", "bg-gp-yellow/30 text-gp-forest", "bg-gp-info/15 text-gp-info", "bg-gp-closed/15 text-gp-closed"];
  return (
    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${colors[hue]}`} aria-hidden>
      {initials}
    </span>
  );
}

function ReviewItem({ review, onDelete }: { review: StationReview; onDelete?: () => void }) {
  const { t } = useI18n();
  const relativeTime = useRelativeTime();
  const name = review.authorName ?? t.stationLook.reviews.anonymous;
  return (
    <li className="rounded-2xl border border-gp-border bg-gp-surface p-3 shadow-sm dark:border-white/10">
      <div className="flex items-center gap-3">
        <Avatar name={name} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{name}</div>
          <div className="flex items-center gap-2 text-xs text-gp-muted dark:text-zinc-400">
            <Stars value={review.rating} size={13} />
            <span>{relativeTime(review.createdAt, new Date())}</span>
          </div>
        </div>
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            aria-label={t.stationLook.reviews.delete}
            className="flex h-9 w-9 items-center justify-center rounded-full text-gp-muted hover:bg-black/5 hover:text-gp-closed dark:hover:bg-white/10"
          >
            <TrashIcon size={18} />
          </button>
        )}
      </div>
      {review.comment && <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-gp-forest/90 dark:text-zinc-200">{review.comment}</p>}
    </li>
  );
}

/** Average, star bars, the signed-in customer's own review form and the latest reviews. */
export function StationReviews({ station, onChanged }: { station: StationView; onChanged: () => void }) {
  const { t } = useI18n();
  const r = t.stationLook.reviews;
  const { backend, profile } = useApp();
  const errorMessage = useErrorMessage();
  const { data: reviews, reload } = useLiveQuery(() => backend.stationReviews(station.id), `${station.id}:${profile?.id ?? ""}`);
  const mine = reviews?.find((x) => x.isMine) ?? null;
  const others = (reviews ?? []).filter((x) => !x.isMine);
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [showAll, setShowAll] = useState(false);

  const summary = ratingOf(reviews ?? []);
  const counts = starCounts(reviews ?? []);
  const formOpen = !!profile && (!mine || editing);

  function startEdit() {
    setRating(mine?.rating ?? 0);
    setComment(mine?.comment ?? "");
    setEditing(true);
    setMessage(null);
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (rating < 1) return;
    setBusy(true);
    setMessage(null);
    try {
      await backend.saveReview(station.id, { rating, comment });
      setEditing(false);
      setMessage({ ok: true, text: r.thanks });
      reload();
      onChanged();
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    try {
      await backend.deleteReview(id);
      setRating(0);
      setComment("");
      setMessage(null);
      reload();
      onChanged();
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    }
  }

  const shown = showAll ? others : others.slice(0, FIRST_REVIEWS);

  return (
    <section aria-labelledby="reviews-title" className="space-y-3">
      <div className="flex items-baseline justify-between">
        <h2 id="reviews-title" className="font-heading text-lg font-semibold">
          {r.title}
        </h2>
        {summary.count > 0 && <span className="text-sm text-gp-muted dark:text-zinc-400">{format(r.count, { n: summary.count })}</span>}
      </div>

      {summary.count > 0 && (
        <div className="flex items-center gap-5 rounded-2xl border border-gp-border bg-gp-surface p-4 shadow-sm dark:border-white/10">
          <div className="text-center">
            <div className="font-heading text-4xl font-bold leading-none">{summary.average.toFixed(1)}</div>
            <Stars value={summary.average} size={14} className="mt-1.5" />
          </div>
          <ul className="min-w-0 flex-1 space-y-1">
            {counts.map((n, i) => (
              <li key={i} className="flex items-center gap-2 text-xs text-gp-muted dark:text-zinc-400">
                <span className="flex w-6 items-center gap-0.5">
                  {5 - i}
                  <StarIcon size={11} filled className="text-gp-yellow" />
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-gp-border dark:bg-white/10">
                  <span className="block h-full rounded-full bg-gp-yellow" style={{ width: `${summary.count ? (n / summary.count) * 100 : 0}%` }} />
                </span>
                <span className="w-5 text-right">{n}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!profile ? (
        <Link
          href={loginHref(stationHref(station.id))}
          className="flex items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-gp-green-dark/40 px-4 py-4 text-sm font-semibold text-gp-green-dark dark:text-gp-green"
        >
          <StarIcon size={18} />
          {r.login}
        </Link>
      ) : formOpen ? (
        <form onSubmit={submit} className="space-y-3 rounded-2xl border border-gp-green-dark/30 bg-gp-green/5 p-4">
          <div className="text-sm font-semibold">{mine ? r.yours : r.rate}</div>
          <StarInput value={rating} onChange={setRating} />
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            maxLength={MAX_REVIEW_COMMENT}
            rows={3}
            placeholder={r.placeholder}
            className="w-full resize-none rounded-xl border border-gp-border bg-gp-surface px-3 py-2 text-sm outline-none focus:border-gp-green-dark dark:border-white/15"
          />
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={busy || rating < 1}
              className="rounded-full bg-gp-green-dark px-5 py-2 text-sm font-semibold text-white shadow-sm disabled:opacity-40"
            >
              {r.send}
            </button>
            {mine && (
              <button type="button" onClick={() => setEditing(false)} className="rounded-full px-4 py-2 text-sm underline">
                {r.cancel}
              </button>
            )}
            <span className="ml-auto text-xs text-gp-muted">
              {comment.length}/{MAX_REVIEW_COMMENT}
            </span>
          </div>
        </form>
      ) : (
        mine && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">{r.yours}</span>
              <button type="button" onClick={startEdit} className="text-sm font-semibold text-gp-green-dark hover:underline dark:text-gp-green">
                {r.edit}
              </button>
            </div>
            <ul>
              <ReviewItem review={mine} onDelete={() => remove(mine.id)} />
            </ul>
          </div>
        )
      )}

      {message && (
        <p
          role="status"
          className={`rounded-xl px-3 py-2 text-sm ${
            message.ok ? "bg-gp-green/15 text-gp-forest dark:text-gp-green" : "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300"
          }`}
        >
          {message.text}
        </p>
      )}

      {reviews !== null && reviews.length === 0 && <p className="text-sm text-gp-muted dark:text-zinc-400">{r.none}</p>}

      {shown.length > 0 && (
        <ul className="space-y-2">
          {shown.map((review) => (
            <ReviewItem key={review.id} review={review} onDelete={profile?.role === "admin" ? () => remove(review.id) : undefined} />
          ))}
        </ul>
      )}
      {others.length > FIRST_REVIEWS && (
        <button
          type="button"
          onClick={() => setShowAll(!showAll)}
          className="w-full rounded-full border border-gp-border py-2 text-sm font-semibold text-gp-green-dark dark:border-white/15 dark:text-gp-green"
        >
          {showAll ? r.showLess : r.viewAll}
        </button>
      )}
    </section>
  );
}
