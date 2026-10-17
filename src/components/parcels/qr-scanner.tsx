"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n-provider";
import { SuccessCheck, useReducedMotion } from "../ui";

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}

declare global {
  interface Window {
    BarcodeDetector?: new (options: { formats: string[] }) => Detector;
  }
}

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

/** How long the green check stays before the result is used (shorter with reduced motion). */
const SUCCESS_MS = 600;
const SUCCESS_MS_REDUCED = 300;

/**
 * Reads a QR code with the back camera, using the browser's own detector
 * (Chrome and the Android app). On a read it stops the camera, shows a green check
 * and vibrates briefly (plan phase 7, Atlas finding), then calls `onResult` once.
 */
export function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
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
    const detecting: Promise<Detector> = window.BarcodeDetector
      ? Promise.resolve(new window.BarcodeDetector({ formats: ["qr_code"] }))
      : jsQrDetector();
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
          const value = codes[0]?.rawValue;
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
  }, []);

  return (
    <div className="space-y-2">
      {failed ? (
        <p className="text-sm text-amber-700 dark:text-amber-300">{t.parcels.staff.scanUnsupported}</p>
      ) : (
        <div className="relative w-full max-w-xs">
          <video ref={video} muted playsInline className="aspect-square w-full rounded-lg bg-black object-cover" />
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
