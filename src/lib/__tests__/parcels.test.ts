import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_CODE, DemoBackend } from "../backend/demo";
import {
  DEFAULT_PARCEL_SIZES,
  liabilityLimit,
  newTrackingNo,
  normalizeTrackingNo,
  PARCEL_PICKUP_DAYS,
  parsePickupInput,
  pickupQrPayload,
  sizeFor,
} from "../parcels";

describe("parcel sizes and prices", () => {
  const m = (lengthCm: number, widthCm: number, heightCm: number, weightKg: number) => ({ lengthCm, widthCm, heightCm, weightKg });

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

  async function as(role: "operator" | "rider", phone = "+22890000002") {
    await backend.register(phone, DEMO_CODE, "2580", role);
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    backend = new DemoBackend();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("goes from drop-off to pickup, and only the recipient sees the code", async () => {
    await as("operator");
    const parcel = await backend.createParcel(FROM, input);
    expect(parcel.size).toBe("M");
    expect(parcel.priceFcfa).toBe(500);
    expect(parcel.status).toBe("deposited");

    await expect(backend.markParcelsArrived(TO, [parcel.id])).rejects.toMatchObject({ code: "parcel_wrong_status" });
    await backend.markParcelsInTransit(FROM, [parcel.id]);
    await backend.markParcelsArrived(TO, [parcel.id]);

    const staffView = (await backend.stationParcels(TO)).find((p) => p.id === parcel.id)!;
    expect(staffView.status).toBe("arrived");
    expect(staffView.pickupCode).toBeUndefined();

    await as("rider", "+22891445566");
    const [mine] = await backend.myParcels();
    expect(mine.direction).toBe("received");
    expect(mine.pickupCode).toMatch(/^\d{6}$/);

    await as("rider", "+22890112233");
    const [sent] = await backend.myParcels();
    expect(sent.direction).toBe("sent");
    expect(sent.pickupCode).toBeUndefined();

    await as("operator");
    await expect(backend.pickUpParcel(TO, mine.pickupCode === "000000" ? "111111" : "000000")).rejects.toMatchObject({
      code: "wrong_pickup_code",
    });
    const done = await backend.pickUpParcel(TO, pickupQrPayload(mine.trackingNo, mine.pickupCode!));
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
    await as("operator");
    for (let i = 0; i < 5; i++) {
      await expect(backend.pickUpParcel(TO, "999999")).rejects.toMatchObject({ code: "wrong_pickup_code" });
    }
    await expect(backend.pickUpParcel(TO, "999999")).rejects.toMatchObject({ code: "code_locked" });
  });

  it("puts a parcel into storage after the pickup deadline", async () => {
    await as("operator");
    const parcel = await backend.createParcel(FROM, input);
    await backend.markParcelsInTransit(FROM, [parcel.id]);
    await backend.markParcelsArrived(TO, [parcel.id]);
    vi.setSystemTime(new Date(Date.now() + (PARCEL_PICKUP_DAYS + 1) * 86_400_000));
    const stored = (await backend.stationParcels(TO)).find((p) => p.id === parcel.id)!;
    expect(stored.status).toBe("stored");
  });

  it("creates an account without PIN for unknown recipients", async () => {
    await backend.register("+22890000001", DEMO_CODE, "2580", "admin");
    await backend.createParcel(FROM, input);
    const snap = await backend.adminSnapshot();
    expect(snap.users.some((u) => u.phone === "+22891445566")).toBe(true);
  });
});
