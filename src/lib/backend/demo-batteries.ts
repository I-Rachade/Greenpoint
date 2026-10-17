import type { BatteryType } from "../battery-types";
import type {
  BatteryHistoryType,
  BatteryLocation,
  BatterySource,
  BatteryStatus,
} from "../batteries";
import type { StationRole } from "../station-work";
import { BackendError } from "./backend";

// Battery register of the demo backend (src/lib/backend/demo.ts), with the rules of
// worker/batteries.ts: one battery per brand and number, added by the first swap that names it.

export interface DemoBattery {
  id: string;
  serial: string;
  brand: string;
  batteryTypeId: string | null;
  status: BatteryStatus;
  source: BatterySource;
  location: BatteryLocation;
  stationId: string | null;
  holderId: string | null;
  lastSwapAt: string | null;
  createdAt: string;
}

export interface DemoBatteryEvent {
  id: string;
  batteryId: string;
  type: BatteryHistoryType;
  stationId: string | null;
  swapId: string | null;
  holderId: string | null;
  status: BatteryStatus | null;
  reason: string | null;
  personId: string;
  role: StationRole;
  createdAt: string;
  /** out / in: the swap's payment, as swap_log has it. */
  payment: string | null;
  amountXof: number | null;
}

export interface DemoSwapBattery {
  serial: string;
  brand: string;
  /** The battery it is, when registered. */
  id: string | null;
  adopt: boolean;
  status: BatteryStatus | null;
}

/** As resolveSwapBattery() in worker/batteries.ts. */
export function resolveDemoBattery(batteries: DemoBattery[], serial: string, type: { brand: string } | null): DemoSwapBattery {
  const found = batteries.filter((b) => b.serial === serial);
  if (type) {
    const same = found.find((b) => b.brand === type.brand);
    if (same) return { serial, brand: same.brand, id: same.id, adopt: false, status: same.status };
    const loose = found.find((b) => b.brand === "");
    if (loose) return { serial, brand: type.brand, id: loose.id, adopt: true, status: loose.status };
    if (found.length) throw new BackendError("battery_wrong_brand");
    return { serial, brand: type.brand, id: null, adopt: false, status: null };
  }
  const pick = found.find((b) => b.brand === "") ?? [...found].sort((a, b) => (b.lastSwapAt ?? "").localeCompare(a.lastSwapAt ?? ""))[0];
  if (pick) return { serial, brand: pick.brand, id: pick.id, adopt: false, status: pick.status };
  return { serial, brand: "", id: null, adopt: false, status: null };
}

/** As swapBatteryStatements() in worker/batteries.ts: adds, moves and logs one battery of a swap. */
export function applyDemoSwapBattery(
  state: { batteries: DemoBattery[]; history: DemoBatteryEvent[] },
  s: {
    battery: DemoSwapBattery;
    direction: "out" | "in";
    typeId: string | null;
    stationId: string;
    swapId: string;
    holderId: string | null;
    personId: string;
    role: StationRole;
    payment: string;
    amountXof: number;
    now: string;
  },
): { batteries: DemoBattery[]; history: DemoBatteryEvent[]; id: string } {
  let batteries = state.batteries;
  const history = [...state.history];
  const base = { swapId: s.swapId, personId: s.personId, role: s.role, createdAt: s.now, status: null, reason: null };
  let id = s.battery.id;
  if (!id) {
    id = crypto.randomUUID();
    batteries = [
      ...batteries,
      {
        id,
        serial: s.battery.serial,
        brand: s.battery.brand,
        batteryTypeId: s.typeId,
        status: "in_service",
        source: "swap",
        location: "unknown",
        stationId: null,
        holderId: null,
        lastSwapAt: null,
        createdAt: s.now,
      },
    ];
    history.push({ ...base, id: crypto.randomUUID(), batteryId: id, type: "added_at_swap", stationId: s.stationId, holderId: null, payment: null, amountXof: null });
  }
  const out = s.direction === "out";
  batteries = batteries.map((b) =>
    b.id === id
      ? {
          ...b,
          brand: s.battery.adopt ? s.battery.brand : b.brand,
          batteryTypeId: b.batteryTypeId ?? s.typeId,
          location: out ? "customer" : "station",
          stationId: out ? null : s.stationId,
          holderId: out ? s.holderId : null,
          lastSwapAt: s.now,
        }
      : b,
  );
  history.push({ ...base, id: crypto.randomUUID(), batteryId: id, type: s.direction, stationId: s.stationId, holderId: s.holderId, payment: s.payment, amountXof: s.amountXof });
  return { batteries, history, id };
}

/** Example batteries of the demo brands, each with a short history. */
export function seedDemoBatteries(now: Date, types: BatteryType[]): { batteries: DemoBattery[]; history: DemoBatteryEvent[] } {
  const at = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const batteries: DemoBattery[] = [];
  const history: DemoBatteryEvent[] = [];
  const typeOf = (id: string) => types.find((t) => t.id === id);
  let n = 0;
  const event = (batteryId: string, type: BatteryHistoryType, days: number, extra: Partial<DemoBatteryEvent> = {}) =>
    history.push({
      id: `demo-bh-${++n}`,
      batteryId,
      type,
      stationId: null,
      swapId: null,
      holderId: null,
      status: null,
      reason: null,
      personId: "demo-admin",
      role: "admin",
      createdAt: at(days),
      payment: null,
      amountXof: null,
      ...extra,
    });
  // [type, number, story]: registered 30 days ago, then swaps (out to a customer, in at a station).
  const plan: [string, string, ("out" | "in" | "repair")[]][] = [
    ["bt-spiro-72", "SP72-0101", ["out", "in", "out"]],
    ["bt-spiro-72", "SP72-0102", ["out", "in"]],
    ["bt-spiro-72", "SP72-0103", ["out"]],
    ["bt-spiro-72", "SP72-0104", []],
    ["bt-spiro-72", "SP72-0105", ["out", "in", "repair"]],
    ["bt-ovt-60", "OV60-2201", ["out", "in"]],
    ["bt-ovt-60", "OV60-2202", ["out"]],
    ["bt-ovt-60", "OV60-2203", []],
    ["bt-ovt-72", "OV72-3301", ["out", "in", "out", "in"]],
    ["bt-ovt-72", "OV72-3302", ["out"]],
  ];
  const stations: Record<string, string[]> = {
    "bt-spiro-72": ["st-grand-marche", "st-tokoin"],
    "bt-ovt-60": ["st-be", "st-agoe", "st-grand-marche"],
    "bt-ovt-72": ["st-agoe", "st-grand-marche"],
  };
  const holders = ["demo-u1", "demo-u3", "demo-u2", "demo-customer"];
  plan.forEach(([typeId, serial, story], i) => {
    const type = typeOf(typeId);
    if (!type) return;
    const id = `demo-bat-${serial.toLowerCase()}`;
    const battery: DemoBattery = {
      id,
      serial,
      brand: type.brand,
      batteryTypeId: typeId,
      status: "in_service",
      source: "registered",
      location: "unknown",
      stationId: null,
      holderId: null,
      lastSwapAt: null,
      createdAt: at(30),
    };
    event(id, "registered", 30);
    story.forEach((step, k) => {
      const days = 20 - k * 5 - (i % 4);
      const stationId = stations[typeId][(i + k) % stations[typeId].length];
      if (step === "repair") {
        battery.status = "repair";
        event(id, "status", days, { status: "repair", reason: "Cellule gonflée" });
        return;
      }
      const holderId = holders[(i + k) % holders.length];
      event(id, step, days, { stationId, holderId, personId: "demo-operator", role: "staff", swapId: `demo-swap-${i}-${k}`, payment: "cash", amountXof: 500 });
      battery.location = step === "out" ? "customer" : "station";
      battery.stationId = step === "out" ? null : stationId;
      battery.holderId = step === "out" ? holderId : null;
      battery.lastSwapAt = at(days);
    });
    batteries.push(battery);
  });
  // Added by a swap at a station that lists no battery types: brand not known yet.
  batteries.push({
    id: "demo-bat-x-0042",
    serial: "X-0042",
    brand: "",
    batteryTypeId: null,
    status: "in_service",
    source: "swap",
    location: "station",
    stationId: "st-universite",
    holderId: null,
    lastSwapAt: at(2),
    createdAt: at(2),
  });
  event("demo-bat-x-0042", "added_at_swap", 2, { stationId: "st-universite", personId: "demo-operator", role: "staff", swapId: "demo-swap-x" });
  event("demo-bat-x-0042", "in", 2, { stationId: "st-universite", holderId: "demo-u2", personId: "demo-operator", role: "staff", swapId: "demo-swap-x", payment: "cash", amountXof: 500 });
  return { batteries, history };
}
