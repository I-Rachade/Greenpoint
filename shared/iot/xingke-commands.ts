// Commands we send to a Xingke socket (protocol V1.1, section 2.1). The Worker
// queues them in device_commands; a bridge fetches them from
// GET /api/devices/commands and writes them to the device.

/** "Stop when full" instead of a fixed number of minutes. */
export const XINGKE_UNTIL_FULL = 999;

function terminal(device: string, outlet: number): string {
  if (!/^\d{6}$/.test(device)) throw new Error("Xingke device number must be 6 digits");
  if (!(outlet >= 1 && outlet <= 16)) throw new Error("outlet must be 1 to 16");
  return device + String(outlet - 1).padStart(2, "0");
}

/** 20-digit order number: UTC time to the second plus 6 random digits. */
export function xingkeOrderNumber(now: Date = new Date(), random: () => number = Math.random): string {
  const time = now.toISOString().replace(/\D/g, "").slice(0, 14);
  return time + String(Math.floor(random() * 1_000_000)).padStart(6, "0");
}

/** MOD 01: switch an outlet on, until full or for `minutes` (1 to 998). */
export function xingkeStartCommand(device: string, outlet: number, order: string, minutes: number = XINGKE_UNTIL_FULL): string {
  if (!(Number.isInteger(minutes) && minutes >= 1 && minutes <= XINGKE_UNTIL_FULL)) throw new Error("minutes must be 1 to 999");
  return `MOD:01;CMD:0;ORD:${order};EID:${terminal(device, outlet)};MSG:${String(minutes).padStart(3, "0")};\r\n`;
}

/** MOD 02: switch an outlet off, ending `order`. */
export function xingkeStopCommand(device: string, outlet: number, order: string): string {
  return `MOD:02;CMD:0;ORD:${order};EID:${terminal(device, outlet)};\r\n`;
}
