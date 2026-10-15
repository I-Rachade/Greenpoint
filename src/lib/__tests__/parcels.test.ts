import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveStation } from "../active-station";
import { DEMO_CODE, DemoBackend } from "../backend/demo";
import {
  DEFAULT_PARCEL_SIZES,
  liabilityLimit,
  measuresOf,
  newTrackingNo,
  normalizeTrackingNo,
  PARCEL_PICKUP_DAYS,
  parseHandoverInput,
  parseParcelScan,
  parsePickupInput,
  pickupQrPayload,
  sizeFor,
} from "../parcels";

describe("parcel sizes and prices", () => {
  const m = (lengthCm: number, widthCm: number, heightCm: number, weightKg: number) => ({ lengthCm, widthCm, heightCm, weightKg });

  it("turns a chosen size back into that same size, as the server computes it", () => {
    for (const tier of DEFAULT_PARCEL_SIZES) expect(sizeFor(measuresOf(tier), DEFAULT_PARCEL_SIZES)?.size).toBe(tier.size);
  });

  it("picks the smallest size that fits by dimensions and weight", () => {
    expect(sizeFor(m(25, 15, 10, 1), DEFAULT_PARCEL_SIZES)?.size).toBe("S");
    expect(sizeFor(m(25, 15, 10, 3), DEFAULT_PARCEL_SIZES)?.size).toBe("M");
    expect(sizeFor(m(55, 40, 40, 10), DEFAULT_PARCEL_SIZES)?.size).toBe("L");
    expect(sizeFor(m(90, 50, 50, 45), DEFAULT_PARCEL_SIZES)?.priceFcfa).toBe(2000);
  });

  it("lets a parcel be turned", () => {
    expect(sizeFor(m(15, 30, 20, 1), DEFAULT_PARCEL_SIZES)?.size).toBe("S");
  });

  it("refuses parcels over 50 kg or bigger than XL", () => {
    expect(sizeFor(m(20, 20, 20, 51), DEFAULT_PARCEL_SIZES)).toBeNull();
    expect(sizeFor(m(120, 20, 20, 5), DEFAULT_PARCEL_SIZES)).toBeNull();
    expect(sizeFor(m(0, 20, 20, 5), DEFAULT_PARCEL_SIZES)).toBeNull();
  });

  it("starts at 200 FCFA", () => {
    expect(Math.min(...DEFAULT_PARCEL_SIZES.map((s) => s.priceFcfa))).toBe(200);
  });

  it("limits liability to the declared value, 10 times the price and 50 000 FCFA", () => {
    expect(liabilityLimit(200, null)).toBe(2000);
    expect(liabilityLimit(200, 500)).toBe(500);
    expect(liabilityLimit(10_000, null)).toBe(50_000);
  });
});

describe("tracking numbers and pickup codes", () => {
  it("makes readable tracking numbers", () => {
    const no = newTrackingNo();
    expect(no).toMatch(/^GP-[2-9A-HJKMNP-Z]{6}$/);
    expect(normalizeTrackingNo(no.toLowerCase().replace("-", " "))).toBe(no);
    expect(normalizeTrackingNo("GP-0O1IL0")).toBeNull();
  });

  it("reads a scanned QR code or a typed code", () => {
    expect(parsePickupInput(pickupQrPayload("GP-7K3M9Q", "123456"))).toEqual({ trackingNo: "GP-7K3M9Q", code: "123456" });
    expect(parsePickupInput(" 123 456 ")).toEqual({ trackingNo: null, code: "123456" });
    expect(parsePickupInput("12345")).toBeNull();
  });

  it("reads a scanned slip, a pickup QR code or a typed number as the parcel, never a bare code", () => {
    expect(parseParcelScan("poinderecharge colis GP-9NR78V\nDe: Station A")).toBe("GP-9NR78V");
    expect(parseParcelScan(pickupQrPayload("GP-9NR78V", "123456"))).toBe("GP-9NR78V");
    expect(parseParcelScan(" gp 9nr78v ")).toBe("GP-9NR78V");
    expect(parseParcelScan("123456")).toBeNull();
    expect(parseParcelScan("hello")).toBeNull();
  });

  it("takes the parcel number alone at the handover counter, but a bare 6-digit number stays a code", () => {
    expect(parseHandoverInput("gp-9nr78v")).toEqual({ trackingNo: "GP-9NR78V", code: null });
    expect(parseHandoverInput("9NR78V")).toEqual({ trackingNo: "GP-9NR78V", code: null });
    expect(parseHandoverInput("234567")).toEqual({ trackingNo: null, code: "234567" });
    expect(parseHandoverInput("GP-0O1IL0")).toBeNull();
  });
});

describe("DemoBackend parcel depot", () => {
  let backend: DemoBackend;
  const FROM = "st-grand-marche";
  const TO = "st-tokoin";
  const input = {
    senderPhone: "90 11 22 33",
    recipientPhone: "+228 91 44 55 66",
    recipientName: "Ama",
    toStationId: TO,
    content: "Chaussures",
    measures: { lengthCm: 35, widthCm: 25, heightCm: 15, weightKg: 1.5 },
  };

  async function as(role: "operator" | "customer" | "driver", phone = "+22890000002") {
    await backend.register(phone, DEMO_CODE, "2580", role);
  }

  /**
   * Staff work at one station (W2): Kossi, the demo staff member, works at FROM. At TO an admin
   * does the station work, with TO chosen as the active station (R7).
   */
  async function adminAt(stationId: string) {
    await backend.register("+22890000001", DEMO_CODE, "2580", "admin");
    setActiveStation(stationId);
  }

  /** The demo driver's code (the demo driver login comes with an approved driver). */
  async function driverCode(): Promise<string> {
    await as("driver", "+22893000009");
    const code = (await backend.driverHome()).driver!.code!;
    await as("operator");
    return code;
  }

  /** A collection run from FROM to TO as staff do it (plan phase 7): driver recorded, each parcel scanned out and in. */
  async function carry(...parcels: { id: string; trackingNo: string }[]) {
    const code = await driverCode();
    setActiveStation(FROM);
    const run = await backend.startRun(FROM, code, parcels.map((p) => p.id));
    for (const p of parcels) await backend.scanRunParcel(FROM, run.id, p.trackingNo);
    await backend.departRun(FROM, run.id);
    await adminAt(TO);
    for (const p of parcels) await backend.receiveParcel(TO, p.trackingNo);
    return run;
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    backend = new DemoBackend();
  });
  afterEach(() => {
    vi.useRealTimers();
    setActiveStation(null);
  });

  it("goes from drop-off to pickup, and only the recipient sees the code", async () => {
    await as("operator");
    const parcel = await backend.createParcel(FROM, input);
    expect(parcel.size).toBe("M");
    expect(parcel.priceFcfa).toBe(500);
    expect(parcel.status).toBe("deposited");

    await adminAt(TO);
    await expect(backend.receiveParcel(TO, parcel.trackingNo)).rejects.toMatchObject({ code: "parcel_wrong_status" });
    await as("operator");
    setActiveStation(null);
    await carry(parcel);

    const staffView = (await backend.stationParcels(TO)).find((p) => p.id === parcel.id)!;
    expect(staffView.status).toBe("arrived");
    expect(staffView.pickupCode).toBeUndefined();

    await as("customer", "+22891445566");
    const [mine] = await backend.myParcels();
    expect(mine.direction).toBe("received");
    expect(mine.pickupCode).toMatch(/^\d{6}$/);
    expect(mine.history?.map((h) => h.kind)).toEqual(["deposited", "handover_to_driver", "in_transit", "received_at_station", "arrived"]);

    await as("customer", "+22890112233");
    const [sent] = await backend.myParcels();
    expect(sent.direction).toBe("sent");
    expect(sent.pickupCode).toBeUndefined();

    await adminAt(TO);
    await expect(backend.pickUpParcel(TO, mine.pickupCode === "000000" ? "111111" : "000000")).rejects.toMatchObject({
      code: "wrong_pickup_code",
    });
    const done = await backend.pickUpParcel(TO, pickupQrPayload(mine.trackingNo, mine.pickupCode!));
    expect(done.status).toBe("picked_up");
  });

  it("hands a parcel out with its number alone, and says when it is not waiting here", async () => {
    await as("operator");
    const parcel = await backend.createParcel(FROM, input);
    // Staff of FROM have no rights at TO.
    await expect(backend.pickUpParcel(TO, parcel.trackingNo)).rejects.toMatchObject({ code: "forbidden" });
    await adminAt(TO);
    await expect(backend.pickUpParcel(TO, parcel.trackingNo)).rejects.toMatchObject({ code: "parcel_not_arrived" });
    setActiveStation(null);
    await carry(parcel);
    const done = await backend.pickUpParcel(TO, parcel.trackingNo.toLowerCase());
    expect(done.status).toBe("picked_up");
  });

  it("refuses stations without a depot, the same station and parcels over 50 kg", async () => {
    await as("operator");
    await expect(backend.createParcel(FROM, { ...input, toStationId: "st-agoe" })).rejects.toMatchObject({ code: "depot_inactive" });
    await expect(backend.createParcel(FROM, { ...input, toStationId: FROM })).rejects.toMatchObject({ code: "same_station" });
    await expect(
      backend.createParcel(FROM, { ...input, measures: { ...input.measures, weightKg: 60 } }),
    ).rejects.toMatchObject({ code: "parcel_too_large" });
  });

  it("pauses code entry after too many wrong codes", async () => {
    await adminAt(TO);
    for (let i = 0; i < 5; i++) {
      await expect(backend.pickUpParcel(TO, "999999")).rejects.toMatchObject({ code: "wrong_pickup_code" });
    }
    await expect(backend.pickUpParcel(TO, "999999")).rejects.toMatchObject({ code: "code_locked" });
  });

  it("puts a parcel into storage after the pickup deadline", async () => {
    await as("operator");
    const parcel = await backend.createParcel(FROM, input);
    await carry(parcel);
    vi.setSystemTime(new Date(Date.now() + (PARCEL_PICKUP_DAYS + 1) * 86_400_000));
    const stored = (await backend.stationParcels(TO)).find((p) => p.id === parcel.id)!;
    expect(stored.status).toBe("stored");
  });

  it("needs every parcel of a run scanned, refuses parcels not on it, and records each scan once", async () => {
    await as("operator");
    const p1 = await backend.createParcel(FROM, input);
    const p2 = await backend.createParcel(FROM, input);
    const code = await driverCode();
    // Another chosen station than the one acted at is refused (R7).
    setActiveStation(TO);
    await expect(backend.startRun(FROM, code, [p1.id])).rejects.toMatchObject({ code: "active_station_required" });
    setActiveStation(FROM);
    const run = await backend.startRun(FROM, code, [p1.id]);
    expect(run.driver.userId).toBe("demo-driver");
    await expect(backend.departRun(FROM, run.id)).rejects.toMatchObject({ code: "run_unscanned" });
    await expect(backend.scanRunParcel(FROM, run.id, p2.trackingNo)).rejects.toMatchObject({ code: "parcel_not_in_run" });
    await backend.scanRunParcel(FROM, run.id, `poinderecharge colis ${p1.trackingNo}\nDe: X`);
    const again = await backend.scanRunParcel(FROM, run.id, p1.trackingNo);
    expect(again.parcels).toMatchObject([{ id: p1.id, scanned: true, received: false }]);
    const gone = await backend.departRun(FROM, run.id);
    expect(gone.status).toBe("under_way");
    await adminAt(TO);
    await backend.receiveParcel(TO, p1.trackingNo);
    await backend.receiveParcel(TO, p1.trackingNo);
    setActiveStation(FROM);
    expect((await backend.stationRuns(FROM))[0]).toMatchObject({ status: "done", parcels: [{ scanned: true, received: true }] });
  });

  it("refuses parcels to a staff, driver or fleet manager number (R14)", async () => {
    await as("driver", "+22893000009");
    await as("operator");
    await expect(backend.createParcel(FROM, { ...input, recipientPhone: "93 00 00 09" })).rejects.toMatchObject({ code: "recipient_not_customer" });
    await expect(backend.createParcel(FROM, { ...input, recipientPhone: "90 00 00 02" })).rejects.toMatchObject({ code: "recipient_not_customer" });
    await expect(backend.createParcel(FROM, { ...input, senderPhone: "90 00 00 02" })).rejects.toMatchObject({ code: "sender_not_customer" });
  });

  it("creates an account without PIN for unknown recipients", async () => {
    await adminAt(FROM);
    await backend.createParcel(FROM, input);
    const snap = await backend.adminSnapshot();
    expect(snap.users.some((u) => u.phone === "+22891445566")).toBe(true);
  });
});
