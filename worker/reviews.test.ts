import { describe, expect, it } from "vitest";
import type { StationInput, StationView } from "../shared/types";
import { placeholderPhoto, stationPhotos, type StationReview } from "../shared/station-extras";
import { handleApi } from "./api";
import type { Env } from "./env";
import { sha256 } from "./http";
import { fakeD1 } from "./test-d1";

// Station photos and amenities (backoffice) and customer reviews, on the real migrations.

const ADMIN = "admin-session-token-0123456789";
const KOSSI = "kossi-session-token-0123456789";
const AFI = "afi-session-token-01234567890";
const OPERATOR = "00000000-0000-4000-8000-000000000001"; // created by 0001_init.sql

async function setup() {
  const { db, d1 } = fakeD1();
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 3_600_000).toISOString();
  for (const [id, phone, name, role, token] of [
    ["admin", "+22890000001", "Admin", "admin", ADMIN],
    ["kossi", "+22890000002", "Kossi Mensah", "rider", KOSSI],
    ["afi", "+22890000003", null, "rider", AFI],
  ] as const) {
    db.prepare("insert into users (id, phone, full_name, role, created_at) values (?, ?, ?, ?, ?)").run(id, phone, name, role, now);
    db.prepare("insert into sessions (token_hash, user_id, created_at, expires_at) values (?, ?, ?, ?)").run(await sha256(token), id, now, later);
  }
  return { db, env: { DB: d1 } as unknown as Env };
}

async function call(env: Env, token: string | null, method: string, path: string, body?: unknown) {
  const res = await handleApi(
    new Request(`https://app.poinderecharge.com${path}`, {
      method,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, body: (await res.json()) as unknown };
}

const input = (patch: Partial<StationInput> = {}): StationInput => ({
  operatorId: OPERATOR,
  name: "Grand Marché",
  address: "",
  lat: 6.13,
  lng: 1.22,
  kind: "swap",
  vehicleTypes: ["scooter"],
  chargingSlots: 0,
  batteryCapacity: 10,
  openingHours: "00:00-24:00",
  phone: null,
  ...patch,
});

async function theStation(env: Env): Promise<StationView> {
  return ((await call(env, null, "GET", "/api/stations")).body as StationView[])[0];
}

async function withStation() {
  const ctx = await setup();
  await call(ctx.env, ADMIN, "POST", "/api/admin/stations", { id: null, input: input() });
  const station = await theStation(ctx.env);
  return { ...ctx, station };
}

const reviews = async (env: Env, id: string, token: string | null = null) =>
  (await call(env, token, "GET", `/api/stations/${id}/reviews`)).body as StationReview[];

describe("station photos and amenities", () => {
  it("saves them with the station and keeps them when left out", async () => {
    const { env, station } = await withStation();
    expect(station.photos).toEqual([]);
    expect(station.amenities).toEqual([]);
    await call(env, ADMIN, "POST", "/api/admin/stations", {
      id: station.id,
      input: input({
        photos: ["https://app.poinderecharge.com/api/media/stations/a.jpg", "javascript:alert(1)", "/station-photos/hub.svg"],
        amenities: ["toilets", "seating", "jacuzzi"] as never,
      }),
    });
    let s = await theStation(env);
    expect(s.photos).toEqual(["https://app.poinderecharge.com/api/media/stations/a.jpg", "/station-photos/hub.svg"]);
    expect(s.amenities).toEqual(["seating", "toilets"]);
    await call(env, ADMIN, "POST", "/api/admin/stations", { id: station.id, input: input({ name: "Grand Marché 2" }) });
    s = await theStation(env);
    expect(s.photos).toHaveLength(2);
    expect(s.amenities).toEqual(["seating", "toilets"]);
  });
});

describe("station main activity", () => {
  it("saves it with the station, keeps it when left out and goes back to automatic with null", async () => {
    const { env, station } = await withStation();
    expect(station.mainActivity).toBeNull();
    await call(env, ADMIN, "POST", "/api/admin/stations", { id: station.id, input: input({ mainActivity: "restaurant" }) });
    expect((await theStation(env)).mainActivity).toBe("restaurant");
    await call(env, ADMIN, "POST", "/api/admin/stations", { id: station.id, input: input({ name: "Maquis du Marché" }) });
    expect((await theStation(env)).mainActivity).toBe("restaurant");
    await call(env, ADMIN, "POST", "/api/admin/stations", { id: station.id, input: input({ mainActivity: "casino" as never }) });
    expect((await theStation(env)).mainActivity).toBeNull();
    await call(env, ADMIN, "POST", "/api/admin/stations", { id: station.id, input: input({ mainActivity: "shop" }) });
    await call(env, ADMIN, "POST", "/api/admin/stations", { id: station.id, input: input({ mainActivity: null }) });
    expect((await theStation(env)).mainActivity).toBeNull();
  });

  it("picks the illustration while the station has no photo", () => {
    const swap = { id: "s", kind: "swap" };
    expect(placeholderPhoto(swap)).toBe("/station-photos/swap.svg");
    expect(placeholderPhoto({ ...swap, mainActivity: "restaurant" })).toBe("/station-photos/restaurant.svg");
    expect(placeholderPhoto({ ...swap, mainActivity: "shop", evChargers: [{}] })).toBe("/station-photos/shop.svg");
    expect(placeholderPhoto({ ...swap, mainActivity: null, evChargers: [{}] })).toBe("/station-photos/ev.svg");
    expect(placeholderPhoto({ id: "s", kind: "both", mainActivity: "charging" })).toBe("/station-photos/charging.svg");
    expect(placeholderPhoto({ ...swap, mainActivity: "ev" })).toBe("/station-photos/ev.svg");
    // A real photo still wins.
    expect(stationPhotos({ ...swap, mainActivity: "shop", photos: ["/p.jpg"] })).toEqual(["/p.jpg"]);
  });
});

describe("station reviews", () => {
  it("lets a signed-in customer rate a station once and change the review", async () => {
    const { env, station } = await withStation();
    expect(await call(env, null, "POST", `/api/stations/${station.id}/reviews`, { rating: 5, comment: "" })).toMatchObject({ status: 401 });
    await call(env, KOSSI, "POST", `/api/stations/${station.id}/reviews`, { rating: 5, comment: "  Très bien  " });
    await call(env, AFI, "POST", `/api/stations/${station.id}/reviews`, { rating: 2, comment: "" });
    await call(env, KOSSI, "POST", `/api/stations/${station.id}/reviews`, { rating: 4, comment: "Bien" });

    const list = await reviews(env, station.id, KOSSI);
    expect(list).toHaveLength(2);
    const mine = list.find((r) => r.isMine)!;
    expect(mine).toMatchObject({ rating: 4, comment: "Bien", authorName: "Kossi M." });
    expect(list.find((r) => !r.isMine)!.authorName).toBeNull();
    expect((await theStation(env)).rating).toEqual({ average: 3, count: 2 });
  });

  it("refuses bad stars, long comments and unknown stations", async () => {
    const { env, station } = await withStation();
    for (const body of [{ rating: 0, comment: "" }, { rating: 6, comment: "" }, { rating: 3.5, comment: "" }, { rating: 4, comment: "x".repeat(501) }]) {
      expect(await call(env, KOSSI, "POST", `/api/stations/${station.id}/reviews`, body)).toEqual({ status: 400, body: { error: "invalid_review" } });
    }
    expect((await call(env, KOSSI, "POST", "/api/stations/nope/reviews", { rating: 4, comment: "" })).status).toBe(404);
  });

  it("lets authors delete their review and admins remove any, logged", async () => {
    const { db, env, station } = await withStation();
    await call(env, KOSSI, "POST", `/api/stations/${station.id}/reviews`, { rating: 1, comment: "insulte" });
    await call(env, AFI, "POST", `/api/stations/${station.id}/reviews`, { rating: 5, comment: "" });
    const [afi, kossi] = [(await reviews(env, station.id, AFI)).find((r) => r.isMine)!, (await reviews(env, station.id, KOSSI)).find((r) => r.isMine)!];

    expect((await call(env, AFI, "DELETE", `/api/reviews/${kossi.id}`)).status).toBe(403);
    await call(env, AFI, "DELETE", `/api/reviews/${afi.id}`);
    await call(env, ADMIN, "DELETE", `/api/reviews/${kossi.id}`);
    expect(await reviews(env, station.id)).toEqual([]);
    expect((await theStation(env)).rating).toEqual({ average: 0, count: 0 });
    const log = db.prepare("select changes from audit_log where changes like '%review_removed%'").all() as { changes: string }[];
    expect(log).toHaveLength(1);
    expect(JSON.parse(log[0].changes)).toEqual({ review_removed: { rating: 1, comment: "insulte" } });
  });
});
