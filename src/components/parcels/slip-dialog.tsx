"use client";

import { useEffect, useRef, useState } from "react";
import type { Parcel } from "@/lib/parcels";
import type { StationView } from "@/lib/types";
import { useI18n } from "../i18n-provider";
import { drawSlip, slipFileName } from "./slip";

/**
 * The drop-off slip as an image, with ways to get it to the customer: share
 * (WhatsApp, or a Bluetooth receipt printer app), download, or print. A native
 * <dialog> opened with showModal (like ConfirmSheet), so Escape and the back gesture
 * close it and focus stays inside while it is open.
 */
export function SlipDialog({ parcel, stations, onClose }: { parcel: Parcel; stations: StationView[]; onClose: () => void }) {
  const { t } = useI18n();
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);

  useEffect(() => {
    close.current = onClose;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  useEffect(() => {
    let objectUrl: string | null = null;
    let active = true;
    void drawSlip(parcel, stations, t).then((canvas) =>
      canvas.toBlob((b) => {
        if (!b || !active) return;
        objectUrl = URL.createObjectURL(b);
        setBlob(b);
        setUrl(objectUrl);
      }, "image/png"),
    );
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [parcel, stations, t]);

  const file = blob ? new File([blob], slipFileName(parcel), { type: "image/png" }) : null;
  const canShare = !!file && typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [file] });

  function download() {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = slipFileName(parcel);
    a.click();
  }

  const button = "min-h-11 rounded-full px-4 py-2 text-sm font-medium";
  return (
    <dialog
      ref={ref}
      aria-label={t.parcels.slip}
      onCancel={(e) => {
        e.preventDefault();
        close.current();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close.current();
      }}
      className="gp-sheet m-auto w-[calc(100%-2rem)] max-w-sm rounded-xl bg-white p-0 text-gp-forest shadow-xl backdrop:bg-black/50 dark:bg-zinc-900 dark:text-zinc-100 print:static print:max-w-none print:shadow-none"
    >
      <div className="flex max-h-[90dvh] w-full flex-col gap-3 overflow-y-auto p-4 print:max-h-none print:overflow-visible print:p-0">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url ? <img src={url} alt={`${t.parcels.slip} ${parcel.trackingNo}`} className="print-slip w-full border border-black/10" /> : <p className="text-sm text-zinc-500">{t.loading}</p>}
        <div className="flex flex-wrap gap-2 print:hidden">
          {canShare && (
            <button
              type="button"
              className={`${button} bg-gp-green-dark text-white`}
              onClick={() => file && navigator.share({ files: [file], title: `${t.parcels.slip} ${parcel.trackingNo}` }).catch(() => undefined)}
            >
              {t.parcels.slipActions.share}
            </button>
          )}
          <button type="button" className={`${button} border border-black/15 dark:border-white/20`} onClick={download} disabled={!url}>
            {t.parcels.slipActions.download}
          </button>
          <button type="button" className={`${button} border border-black/15 dark:border-white/20`} onClick={() => window.print()} disabled={!url}>
            {t.parcels.slipActions.print}
          </button>
          <button type="button" autoFocus className={`${button} ml-auto text-zinc-600 dark:text-zinc-400`} onClick={onClose}>
            {t.parcels.slipActions.close}
          </button>
        </div>
      </div>
    </dialog>
  );
}
