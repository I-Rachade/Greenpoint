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
      const w = source.videoWidth;
      const h = source.videoHeight;
      if (!ctx || !w || !h) return [];
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(source, 0, 0, w, h);
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
      .getUserMedia({ video: { facingMode: "environment" } })
      .then(async (s) => {
        stream = s;
        const detector = await detecting;
        if (stopped || !video.current) return;
        video.current.srcObject = s;
        await video.current.play();
        const tick = async () => {
          if (stopped || !video.current) return;
          const codes = await detector.detect(video.current).catch(() => []);
          const value = codes[0]?.rawValue?.replace(/[\x00-\x1f]+/g, " ").trim();
          if (value) {
            stopped = true;
            stop();
            setSuccess(true);
            navigator.vibrate?.(80);
            timer = window.setTimeout(() => done.current(value), pause.current);
            return;
          }
          timer = window.setTimeout(tick, 250);
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
        <div className="relative w-full max-w-xs">
          <video ref={video} muted playsInline className={`${barcodes ? "aspect-[4/3]" : "aspect-square"} w-full rounded-lg bg-black object-cover`} />
          {success && (
            <div role="status" aria-label={t.parcels.staff.scanned} className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40">
              <SuccessCheck size={88} />
            </div>
          )}
        </div>
      )}
      <button type="button" onClick={onClose} className="min-h-11 text-sm underline">
        {t.parcels.staff.stopScan}
      </button>
    </div>
  );
}
