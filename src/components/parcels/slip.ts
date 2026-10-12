import QRCode from "qrcode";
import type { Dictionary } from "@/lib/i18n/fr";
import { liabilityLimit, slipQrText, type Parcel } from "@/lib/parcels";
import type { StationView } from "@/lib/types";

/** 80 mm receipt printers print 576 dots per line. */
const WIDTH = 576;
const PAD = 24;

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const fcfa = (n: number) => `${n.toLocaleString("fr-FR").replace(/ /g, " ")} FCFA`;

/**
 * Draws the drop-off slip as an image: black on white, one column, so it prints
 * on a small Bluetooth receipt printer and reads well when shared on WhatsApp.
 * Never contains the pickup code.
 */
export async function drawSlip(parcel: Parcel, stations: StationView[], t: Dictionary): Promise<HTMLCanvasElement> {
  const station = (id: string) => stations.find((s) => s.id === id);
  const name = (id: string) => station(id)?.name ?? id;
  const qr = document.createElement("canvas");
  await QRCode.toCanvas(qr, slipQrText(parcel, name), { width: 300, margin: 1, errorCorrectionLevel: "M" });

  // Measure first on a scratch canvas, then draw at the right height.
  const blocks: { text: string; size: number; bold?: boolean; gap?: number }[] = [];
  const add = (text: string, size = 22, bold = false, gap = 6) => blocks.push({ text, size, bold, gap });
  const to = station(parcel.toStationId);
  const party = (p: Parcel["sender"]) => (p.name ? `${p.name} · ${p.phone}` : p.phone);
  add(`${t.parcels.from} : ${name(parcel.fromStationId)}`, 24, true);
  add(`${t.parcels.to} : ${name(parcel.toStationId)}`, 24, true, 2);
  if (to?.address) add(to.address, 20);
  if (to?.openingHours) add(to.openingHours, 20, false, 14);
  add(`${t.parcels.sender} : ${party(parcel.sender)}`);
  add(`${t.parcels.recipient} : ${party(parcel.recipient)}`, 22, false, 14);
  add(`${t.parcels.content} : ${parcel.content}`);
  const m = parcel.measures;
  add(`${t.parcels.size} ${parcel.size} · ${m.lengthCm}×${m.widthCm}×${m.heightCm} cm · ${m.weightKg} kg`);
  add(`${t.parcels.price} : ${fcfa(parcel.priceFcfa)} (${parcel.paymentMethod === "partner" ? t.parcels.billedToPartner : "cash"})`, 22, true);
  if (parcel.declaredValue != null) add(`${t.parcels.declaredValue} : ${fcfa(parcel.declaredValue)}`);
  add(`${t.parcels.liability} : ${fcfa(liabilityLimit(parcel.priceFcfa, parcel.declaredValue))}`, 22, false, 14);
  add(new Date(parcel.createdAt).toLocaleString("fr-FR"), 20, false, 14);
  for (const rule of t.parcels.rules) add(`• ${rule}`, 17, false, 4);
  add("app.poinderecharge.com", 20, true, 0);

  const scratch = document.createElement("canvas").getContext("2d")!;
  const laid = blocks.map((b) => {
    scratch.font = `${b.bold ? "bold " : ""}${b.size}px sans-serif`;
    return { ...b, lines: wrap(scratch, b.text, WIDTH - 2 * PAD) };
  });
  const header = 150;
  const height =
    header + qr.height + 24 + laid.reduce((sum, b) => sum + b.lines.length * Math.round(b.size * 1.3) + (b.gap ?? 0), 0) + PAD;

  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, WIDTH, height);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "top";
  ctx.textAlign = "center";
  ctx.font = "bold 30px sans-serif";
  ctx.fillText("poinderecharge", WIDTH / 2, PAD);
  ctx.font = "22px sans-serif";
  ctx.fillText(t.parcels.slip, WIDTH / 2, PAD + 40);
  ctx.font = "bold 44px monospace";
  ctx.fillText(parcel.trackingNo, WIDTH / 2, PAD + 72);
  ctx.drawImage(qr, (WIDTH - qr.width) / 2, header);
  let y = header + qr.height + 24;
  ctx.textAlign = "left";
  for (const b of laid) {
    ctx.font = `${b.bold ? "bold " : ""}${b.size}px sans-serif`;
    for (const line of b.lines) {
      ctx.fillText(line, PAD, y);
      y += Math.round(b.size * 1.3);
    }
    y += b.gap ?? 0;
  }
  return canvas;
}

export function slipFileName(parcel: Parcel): string {
  return `colis-${parcel.trackingNo}.png`;
}
