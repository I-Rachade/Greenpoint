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

export function canScanQr(): boolean {
  return typeof window !== "undefined" && !!window.BarcodeDetector && !!navigator.mediaDevices?.getUserMedia;
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
    const detector = window.BarcodeDetector ? new window.BarcodeDetector({ formats: ["qr_code"] }) : null;
    if (!detector) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFailed(true);
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: "environment" } })
      .then(async (s) => {
        stream = s;
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
      .catch(() => setFailed(true));
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
