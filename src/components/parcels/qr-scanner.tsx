"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n-provider";

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

/**
 * Reads a QR code with the back camera, using the browser's own detector
 * (Chrome and the Android app). Calls `onResult` once, then stops.
 */
export function QrScanner({ onResult, onClose }: { onResult: (text: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const done = useRef(onResult);

  useEffect(() => {
    done.current = onResult;
  });

  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let stopped = false;
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
          if (codes[0]?.rawValue) {
            stopped = true;
            done.current(codes[0].rawValue);
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
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  return (
    <div className="space-y-2">
      {failed ? (
        <p className="text-sm text-amber-700 dark:text-amber-300">{t.parcels.staff.scanUnsupported}</p>
      ) : (
        <video ref={video} muted playsInline className="aspect-square w-full max-w-xs rounded-lg bg-black object-cover" />
      )}
      <button type="button" onClick={onClose} className="text-sm underline">
        {t.parcels.staff.stopScan}
      </button>
    </div>
  );
}
