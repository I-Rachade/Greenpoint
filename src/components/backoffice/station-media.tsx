"use client";

import { useRef, useState } from "react";
import { useErrorMessage, useLiveQuery, useRelativeTime } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { AMENITIES, MAIN_ACTIVITIES, MAX_STATION_PHOTOS, type Amenity, type MainActivity } from "@/lib/station-extras";
import { useApp } from "../app-provider";
import { shrinkImage } from "../drivers/shared";
import { CameraIcon, StarIcon, TrashIcon } from "../icons";
import { useI18n } from "../i18n-provider";
import { AMENITY_ICONS, Stars } from "../station-look";

/** Backoffice: the station's main activity, its photos (first = cover) and what it offers to rest. */
export function StationMediaFields({
  photos,
  amenities,
  mainActivity,
  autoPicture,
  onPhotos,
  onAmenities,
  onMainActivity,
}: {
  photos: string[];
  amenities: Amenity[];
  /** Null = automatic. */
  mainActivity: MainActivity | null;
  /** The illustration "automatic" stands for, from the station's services. */
  autoPicture: string;
  onPhotos: (photos: string[]) => void;
  onAmenities: (amenities: Amenity[]) => void;
  onMainActivity: (mainActivity: MainActivity | null) => void;
}) {
  const { t } = useI18n();
  const a = t.stationLook.admin;
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setProblem(null);
    try {
      // The demo keeps photos in browser storage, so they are made smaller there.
      const blob = await shrinkImage(file, backend.mode === "demo" ? 900 : 1600);
      const url = await backend.uploadStationPhoto(new File([blob], "station.jpg", { type: "image/jpeg" }));
      onPhotos([...photos, url].slice(0, MAX_STATION_PHOTOS));
    } catch (err) {
      setProblem(err instanceof Error && err.message === "image_too_large" ? t.errors.image_too_large : errorMessage(err));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const choices: { value: MainActivity | null; label: string; picture: string }[] = [
    { value: null, label: a.mainActivityAuto, picture: autoPicture },
    ...MAIN_ACTIVITIES.map((m) => ({ value: m, label: a.mainActivities[m], picture: `/station-photos/${m}.svg` })),
  ];

  return (
    <div className="space-y-4 sm:col-span-2">
      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">{a.mainActivity}</legend>
        <p className="text-xs text-zinc-500">{a.mainActivityHint}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {choices.map((c) => {
            const on = c.value === mainActivity;
            return (
              <label
                key={c.value ?? "auto"}
                className={`cursor-pointer overflow-hidden rounded-lg border-2 text-sm ${
                  on ? "border-gp-green-dark bg-gp-green/10 text-gp-green-dark" : "border-black/10 dark:border-white/15"
                }`}
              >
                <input type="radio" name="main-activity" className="sr-only" checked={on} onChange={() => onMainActivity(c.value)} />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.picture} alt="" className="aspect-[16/9] w-full object-cover" />
                <span className="flex items-center gap-1.5 px-2 py-1.5 font-medium">
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 ${on ? "border-gp-green-dark" : "border-zinc-400"}`}
                    aria-hidden
                  >
                    {on && <span className="h-2 w-2 rounded-full bg-gp-green-dark" />}
                  </span>
                  {c.label}
                </span>
              </label>
            );
          })}
        </div>
        {photos.length > 0 && <p className="text-xs text-zinc-500">{a.mainActivityPhotosFirst}</p>}
      </fieldset>

      <section className="space-y-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <CameraIcon size={16} /> {a.photos}
          </h3>
          <p className="text-xs text-zinc-500">{a.photosHint}</p>
        </div>
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {photos.map((src, i) => (
            <li key={src + i} className="group relative aspect-[16/10] overflow-hidden rounded-lg border border-black/10 dark:border-white/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={src} alt="" className="h-full w-full object-cover" />
              {i === 0 && (
                <span className="absolute left-1.5 top-1.5 rounded-full bg-gp-green-dark px-2 py-0.5 text-[10px] font-semibold text-white">{a.cover}</span>
              )}
              <div className="absolute inset-x-1.5 bottom-1.5 flex gap-1">
                {i > 0 && (
                  <button
                    type="button"
                    onClick={() => onPhotos([src, ...photos.filter((_, j) => j !== i)])}
                    className="rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium text-gp-forest shadow"
                  >
                    {a.makeCover}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onPhotos(photos.filter((_, j) => j !== i))}
                  className="ml-auto rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium text-red-700 shadow"
                >
                  {a.removePhoto}
                </button>
              </div>
            </li>
          ))}
          {photos.length < MAX_STATION_PHOTOS && (
            <li>
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                className="flex aspect-[16/10] w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-gp-green-dark/40 text-sm font-medium text-gp-green-dark disabled:opacity-50"
              >
                <CameraIcon size={22} />
                {uploading ? t.loading : a.addPhoto}
              </button>
              <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => upload(e.target.files?.[0])} />
            </li>
          )}
        </ul>
        {photos.length >= MAX_STATION_PHOTOS && <p className="text-xs text-zinc-500">{format(a.maxPhotos, { n: MAX_STATION_PHOTOS })}</p>}
        {problem && (
          <p role="alert" className="text-sm text-red-600">
            {problem}
          </p>
        )}
      </section>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">{a.amenities}</legend>
        <p className="text-xs text-zinc-500">{a.amenitiesHint}</p>
        <div className="flex flex-wrap gap-2">
          {AMENITIES.map((am) => {
            const Icon = AMENITY_ICONS[am];
            const on = amenities.includes(am);
            return (
              <label
                key={am}
                className={`flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm ${
                  on ? "border-gp-green-dark bg-gp-green/10 text-gp-green-dark" : "border-black/15 dark:border-white/20"
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={on}
                  onChange={(e) => onAmenities(e.target.checked ? [...amenities, am] : amenities.filter((x) => x !== am))}
                />
                <Icon size={16} />
                {t.stationLook.amenities[am]}
              </label>
            );
          })}
        </div>
      </fieldset>
    </div>
  );
}

/** Backoffice: the reviews of a station, with a button to delete abusive ones. */
export function StationReviewsAdmin({ stationId }: { stationId: string }) {
  const { t } = useI18n();
  const a = t.stationLook.admin;
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const relativeTime = useRelativeTime();
  const { data: reviews, reload } = useLiveQuery(() => backend.stationReviews(stationId), stationId);
  const [problem, setProblem] = useState<string | null>(null);

  async function remove(id: string) {
    if (!window.confirm(a.confirmRemove)) return;
    try {
      await backend.deleteReview(id);
      setProblem(null);
      reload();
    } catch (err) {
      setProblem(errorMessage(err));
    }
  }

  return (
    <section className="space-y-2 sm:col-span-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <StarIcon size={16} /> {a.reviews}
        {reviews && reviews.length > 0 && <span className="font-normal text-zinc-500">({reviews.length})</span>}
      </h3>
      {reviews === null ? (
        <p className="text-sm text-zinc-500">{t.loading}</p>
      ) : reviews.length === 0 ? (
        <p className="text-sm text-zinc-500">{a.noReviews}</p>
      ) : (
        <ul className="max-h-72 divide-y divide-black/10 overflow-y-auto rounded-lg border border-black/10 dark:divide-white/10 dark:border-white/10">
          {reviews.map((r) => (
            <li key={r.id} className="flex items-start gap-3 p-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{r.authorName ?? t.stationLook.reviews.anonymous}</span>
                  <Stars value={r.rating} size={12} />
                  <span className="text-xs text-zinc-500">{relativeTime(r.createdAt, new Date())}</span>
                </div>
                {r.comment && <p className="mt-0.5 whitespace-pre-line text-zinc-700 dark:text-zinc-300">{r.comment}</p>}
              </div>
              <button
                type="button"
                onClick={() => remove(r.id)}
                aria-label={a.removeReview}
                title={a.removeReview}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-500 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/40"
              >
                <TrashIcon size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {problem && (
        <p role="alert" className="text-sm text-red-600">
          {problem}
        </p>
      )}
    </section>
  );
}
