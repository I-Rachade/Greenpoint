"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

/** A QR code as an image (black on white, readable from a phone screen). */
export function QrImage({ text, size = 220, label }: { text: string; size?: number; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void QRCode.toDataURL(text, { width: size, margin: 1, errorCorrectionLevel: "M" }).then((url) => active && setSrc(url));
    return () => {
      active = false;
    };
  }, [text, size]);
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt={label} width={size} height={size} className="rounded bg-white p-1" /> : <div style={{ width: size, height: size }} />;
}
