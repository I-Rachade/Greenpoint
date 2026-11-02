"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n-provider";
import { SuccessCheck, useReducedMotion } from "../ui";

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

declare global {
  interface Window {
    BarcodeDetector?: (new (options: { formats: string[] }) => Detector) & { getSupportedFormats?: () => Promise<string[]> };
  }
}

/** Codes a battery's number can be printed as: QR, or the 1D and 2D barcodes battery makers use. */
export const BATTERY_CODE_FORMATS = ["qr_code", "code_128", "code_39", "code_93", "ean_13", "ean_8", "upc_a", "upc_e", "itf", "codabar", "data_matrix"];

/** Any browser with a camera: the browser's own detector where it has one, else jsQR (Safari, iPhone app). */
export function canScanQr(): boolean {
  return typeof window !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

/** jsQR on one video frame, for browsers without BarcodeDetector. Loaded only when needed. */
async function jsQrDetector(): Promise<Detector> {
  const { default: jsQR } = await import("jsqr");
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return {
    async detect(source) {
      const w = source.videoWidth;
      const h = source.videoHeight;
      if (!ctx || !w || !h) return [];
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(source, 0, 0, w, h);
      const code = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
      return code?.data ? [{ rawValue: code.data }] : [];
    },
  };
}

/**
 * The middle of the picture searched for a barcode on browsers without BarcodeDetector. It covers the
 * aiming frame whether the camera gives a landscape or a portrait picture (the preview crops it to 4:3).
 */
const BAND = { w: 0.8, h: 0.5 };

/**
 * Camera settings for battery barcodes: a sharp, large picture (a barcode needs about 2.5 pixels per
 * bar, which the default 640×480 does not give at arm's length), continuous focus, and some zoom
 * where the phone allows it, so the code fills the frame without coming closer than the lens can focus.
 */
const BARCODE_VIDEO: MediaTrackConstraints = { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } };

async function tuneForBarcodes(track: MediaStreamTrack | undefined) {
  if (!track?.getCapabilities) return;
  const caps = track.getCapabilities() as MediaTrackCapabilities & { focusMode?: string[]; zoom?: { min: number; max: number } };
  const advanced: Record<string, unknown>[] = [];
  if (caps.focusMode?.includes("continuous")) advanced.push({ focusMode: "continuous" });
  if (caps.zoom && caps.zoom.max >= 1.5) advanced.push({ zoom: Math.min(2, caps.zoom.max) });
  if (advanced.length) await track.applyConstraints({ advanced } as MediaTrackConstraints).catch(() => undefined);
}

/** A barcode is taken once the same number is read twice in a row: a single 1D read can be wrong. */
const BARCODE_READS = 2;

/** ZXing for barcodes on browsers without BarcodeDetector (Safari, iPhone app). Loaded only when needed. */
async function zxingDetector(): Promise<Detector> {
  const zx = await import("@zxing/library");
  const F = zx.BarcodeFormat;
  const reader = new zx.MultiFormatReader();
  const hints = new Map<import("@zxing/library").DecodeHintType, unknown>([
    [zx.DecodeHintType.POSSIBLE_FORMATS, [F.QR_CODE, F.CODE_128, F.CODE_39, F.CODE_93, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.ITF, F.CODABAR, F.DATA_MATRIX]],
    [zx.DecodeHintType.TRY_HARDER, true],
  ]);
  reader.setHints(hints);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return {
    async detect(source) {
      const vw = source.videoWidth;
      const vh = source.videoHeight;
      if (!ctx || !vw || !vh) return [];
      // The aiming band only (BAND below): less to search, and no pixel lost to scaling.
      const w = Math.round(vw * BAND.w);
      const h = Math.round(vh * BAND.h);
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(source, Math.round((vw - w) / 2), Math.round((vh - h) / 2), w, h, 0, 0, w, h);
      try {
        const bitmap = new zx.BinaryBitmap(new zx.HybridBinarizer(new zx.HTMLCanvasElementLuminanceSource(canvas)));
        const text = reader.decodeWithState(bitmap).getText();
        return text ? [{ rawValue: text }] : [];
      } catch {
        return []; // nothing readable in this frame
      } finally {
        reader.reset();
      }
    },
  };
}

/** The browser's own detector for these formats (only the ones it supports), or null to use a library. */
async function nativeDetector(formats: string[]): Promise<Detector | null> {
  const Native = window.BarcodeDetector;
  if (!Native) return null;
  const supported = (await Native.getSupportedFormats?.().catch(() => null)) ?? formats;
  const usable = formats.filter((f) => supported.includes(f));
  return usable.length ? new Native({ formats: usable }) : null;
}

/** How long the green check stays before the result is used (shorter with reduced motion). */
const SUCCESS_MS = 600;
const SUCCESS_MS_REDUCED = 300;

/**
 * Reads a QR code with the back camera, using the browser's own detector
 * (Chrome and the Android app). With `barcodes`, also reads barcodes (battery numbers). On a read it stops the camera, shows a green check
 * and vibrates briefly (plan phase 7, Atlas finding), then calls `onResult` once.
 */
export function QrScanner({
  onResult,
  onClose,
  barcodes = false,
}: {
  onResult: (text: string) => void;
  onClose: () => void;
  /** Also read 1D barcodes and Data Matrix, not only QR codes. */
  barcodes?: boolean;
}) {
  const { t } = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const [success, setSuccess] = useState(false);
  const reduced = useReducedMotion();
  const done = useRef(onResult);
  const pause = useRef(SUCCESS_MS);

  useEffect(() => {
    done.current = onResult;
    pause.current = reduced ? SUCCESS_MS_REDUCED : SUCCESS_MS;
  });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let stopped = false;
    const stop = () => stream?.getTracks().forEach((track) => track.stop());
    const formats = barcodes ? BATTERY_CODE_FORMATS : ["qr_code"];
    const detecting: Promise<Detector> = nativeDetector(formats)
      .catch(() => null)
      .then((native) => native ?? (barcodes ? zxingDetector() : jsQrDetector()));
    detecting.catch(() => undefined); // handled where it is awaited
    navigator.mediaDevices
      .getUserMedia({ video: barcodes ? BARCODE_VIDEO : { facingMode: "environment" } })
      .then(async (s) => {
        stream = s;
        if (barcodes) await tuneForBarcodes(s.getVideoTracks()[0]);
        const detector = await detecting;
        if (stopped || !video.current) return;
        video.current.srcObject = s;
        await video.current.play();
        let last = "";
        let reads = 0;
        const tick = async () => {
          if (stopped || !video.current) return;
          const codes = await detector.detect(video.current).catch(() => []);
          const read = codes[0]?.rawValue?.replace(/[\x00-\x1f]+/g, " ").trim() ?? "";
          reads = read && read === last ? reads + 1 : read ? 1 : 0;
          last = read;
          const value = reads >= (barcodes ? BARCODE_READS : 1) ? read : "";
          if (value) {
            stopped = true;
            stop();
            setSuccess(true);
            navigator.vibrate?.(80);
            timer = window.setTimeout(() => done.current(value), pause.current);
            return;
          }
          timer = window.setTimeout(tick, barcodes ? 120 : 250);
        };
        void tick();
      })
      .catch(() => {
        stop();
        setFailed(true);
      });
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stop();
    };
  }, [barcodes]);

  return (
    <div className="space-y-2">
      {failed ? (
        <p className="text-sm text-amber-700 dark:text-amber-300">{t.parcels.staff.scanUnsupported}</p>
      ) : (
        <div className={`relative w-full overflow-hidden rounded-lg ${barcodes ? "max-w-md" : "max-w-xs"}`}>
          <video ref={video} muted playsInline className={`${barcodes ? "aspect-[4/3]" : "aspect-square"} w-full rounded-lg bg-black object-cover`} />
          {barcodes && !success && (
            <div
              aria-hidden
              className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md border-2 border-white/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]"
              style={{ width: "80%", height: "40%" }}
            />
          )}
          {success && (
            <div role="status" aria-label={t.parcels.staff.scanned} className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40">
              <SuccessCheck size={88} />
            </div>
          )}
        </div>
      )}
      {barcodes && !failed && <p className="text-xs text-gp-muted">{t.parcels.staff.scanBarcodeHint}</p>}
      <button type="button" onClick={onClose} className="min-h-11 text-sm underline">
        {t.parcels.staff.stopScan}
      </button>
    </div>
  );
}
