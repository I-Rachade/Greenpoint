"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Parcel } from "@/lib/parcels";
import type { StationView } from "@/lib/types";
import type { Dictionary } from "@/lib/i18n/fr";
import { useApp } from "../app-provider";
import { useErrorMessage } from "@/lib/hooks";
import { useI18n } from "../i18n-provider";
import { drawLabel, drawSlip, labelFileName, slipFileName } from "./slip";

const button = "min-h-11 rounded-full px-4 py-2 text-sm font-medium";

/**
 * A parcel document as an image, with ways to get it onto paper: share (WhatsApp, or a
 * Bluetooth receipt printer app), download, or print. A native <dialog> opened with
 * showModal (like ConfirmSheet), so Escape and the back gesture close it and focus stays
 * inside while it is open. onOutput is told when one of the three was used.
 */
function ImageDialog({
  title,
  draw,
  fileName,
  primary,
  onOutput,
  onClose,
  children,
}: {
  title: string;
  draw: (t: Dictionary) => Promise<HTMLCanvasElement>;
  fileName: string;
  /** Label of the print button, which then comes first and stands out. */
  primary?: string;
  onOutput?: () => void;
  onClose: () => void;
  /** Below the buttons, e.g. the confirmation that the label is stuck on. */
  children?: ReactNode;
}) {
  const { t } = useI18n();
  const [blob, setBlob] = useState<Blob | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  const drawRef = useRef(draw);

  useEffect(() => {
    close.current = onClose;
    drawRef.current = draw;
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
    void drawRef.current(t).then((canvas) =>
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
  }, [fileName, t]);

  const file = blob ? new File([blob], fileName, { type: "image/png" }) : null;
  const canShare = !!file && typeof navigator !== "undefined" && !!navigator.canShare?.({ files: [file] });

  function download() {
    if (!url) return;
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    onOutput?.();
  }

  function print() {
    window.print();
    onOutput?.();
  }

  const outline = `${button} border border-black/15 dark:border-white/20`;
  return (
    <dialog
      ref={ref}
      aria-label={title}
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
        <h2 className="font-semibold print:hidden">{title}</h2>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {url ? <img src={url} alt={title} className="print-slip w-full border border-black/10" /> : <p className="text-sm text-zinc-500">{t.loading}</p>}
        <div className="flex flex-wrap gap-2 print:hidden">
          {primary && (
            <button type="button" className={`${button} bg-gp-green-dark text-white`} onClick={print} disabled={!url}>
              {primary}
            </button>
          )}
          {canShare && (
            <button
              type="button"
              className={primary ? outline : `${button} bg-gp-green-dark text-white`}
              onClick={() => {
                if (!file) return;
                onOutput?.();
                navigator.share({ files: [file], title }).catch(() => undefined);
              }}
            >
              {t.parcels.slipActions.share}
            </button>
          )}
          <button type="button" className={outline} onClick={download} disabled={!url}>
            {t.parcels.slipActions.download}
          </button>
          {!primary && (
            <button type="button" className={outline} onClick={print} disabled={!url}>
              {t.parcels.slipActions.print}
            </button>
          )}
          <button type="button" autoFocus={!primary} className={`${button} ml-auto text-zinc-600 dark:text-zinc-400`} onClick={onClose}>
            {t.parcels.slipActions.close}
          </button>
        </div>
        {children && <div className="print:hidden">{children}</div>}
      </div>
    </dialog>
  );
}

/** The drop-off slip, the sender's receipt: everything about the parcel, never the pickup code. */
export function SlipDialog({ parcel, stations, onClose }: { parcel: Parcel; stations: StationView[]; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <ImageDialog
      title={`${t.parcels.slip} ${parcel.trackingNo}`}
      draw={(dict) => drawSlip(parcel, stations, dict)}
      fileName={slipFileName(parcel)}
      onClose={onClose}
    />
  );
}

/**
 * The shipping label staff stick on the parcel (planung/colis-etiquette-envoi.md). Once it
 * is printed (or shared to the printer app, or downloaded), staff confirm it is stuck on;
 * that lets the parcel go on a collection run. A reprint is confirmed the same way.
 */
export function LabelDialog({
  parcel,
  stations,
  stationId,
  onClose,
  onStuck,
}: {
  parcel: Parcel;
  stations: StationView[];
  /** The station staff work at, which records the label. */
  stationId: string;
  onClose: () => void;
  onStuck: (parcel: Parcel) => void;
}) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const [printed, setPrinted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const l = t.parcels.labelActions;

  async function stuck() {
    setBusy(true);
    setError("");
    try {
      onStuck(await backend.markParcelLabel(stationId, parcel.id));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ImageDialog
      title={`${t.parcels.label} ${parcel.trackingNo}`}
      draw={(dict) => drawLabel(parcel, stations, dict)}
      fileName={labelFileName(parcel)}
      primary={l.print}
      onOutput={() => setPrinted(true)}
      onClose={onClose}
    >
      <div className="space-y-2 border-t border-black/10 pt-3 dark:border-white/10">
        <p className="text-xs text-zinc-500">{l.hint}</p>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <button
          type="button"
          className={`${button} w-full bg-gp-green-dark text-white disabled:opacity-40`}
          disabled={!printed || busy}
          onClick={() => void stuck()}
        >
          {l.stuck}
        </button>
      </div>
    </ImageDialog>
  );
}
