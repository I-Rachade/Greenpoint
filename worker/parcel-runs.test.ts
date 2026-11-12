// Plan phase 7: collection runs with a scan per parcel and the driver recorded, R14
// (parcels only for customers), and the Atlas findings on bookings in this area.
import { describe, expect, it } from "vitest";
import type { Profile } from "../shared/types";
import { bookDelivery, bookPickup, bookCourier } from "./drivers";
import type { Env } from "./env";
import { cancelRun, departRun, receiveParcel, removeRunParcel, scanRunParcel, startRun, stationRuns } from "./parcel-runs";
import { createParcel, markLabelPrinted, myParcels, type ParcelCtx } from "./parcels";
import { fakeD1 } from "./test-d1";

const OWN_OPERATOR = "00000000-0000-4000-8000-000000000001";
const A = { id: "st-a", lat: 6.1319, lng: 1.2228 };
const B = { id: "st-b", lat: 6.17, lng: 1.21 };
const HOME = { lat: 6.175, lng: 1.215, note: "Portail bleu", phone: "90 11 22 33" };

const ADMIN: Profile = { id: "admin", phone: "+22890000001", email: null, fullName: "Admin", role: "admin" };
const STAFF_A: Profile = { id: "staff-a", phone: "+22890000002", email: null, fullName: "Afi", role: "operator" };
const OWNER: Profile = { id: "owner", phone: "+22890000003", email: null, fullName: "Kodjo", role: "operator" };
const SENDER: Profile = { id: "sender", phone: "+22891000000", email: null, fullName: "Ama", role: "customer" };
const RECIPIENT_PHONE = "+22892000000";
const DRIVER_CODE = "ABCDEFGH";
const DRIVER2_CODE = "BCDEFGHJ";

function setup() {
  const { db, d1 } = fakeD1();
  const now = new Date().toISOString();
  db.exec(`
    insert into users (id, phone, full_name, role, created_at) values
      ('admin', '+22890000001', 'Admin', 'admin', '${now}'),
      ('staff-a', '+22890000002', 'Afi', 'operator', '${now}'),
      ('owner', '+22890000003', 'Kodjo', 'operator', '${now}'),
      ('sender', '+22891000000', 'Ama', 'rider', '${now}'),
      ('drv', '+22893000001', 'Yao', 'driver', '${now}'),
      ('drv2', '+22893000002', 'Mawuli', 'driver', '${now}'),
      ('fleet', '+22894000000', 'Flotte', 'fleet_manager', '${now}');
    insert into operator_owners (operator_id, user_id, created_at) values ('${OWN_OPERATOR}', 'owner', '${now}');
    insert into stations (id, operator_id, name, lat, lng, kind, created_at) values
      ('${A.id}', '${OWN_OPERATOR}', 'Station A', ${A.lat}, ${A.lng}, 'both', '${now}'),
      ('${B.id}', '${OWN_OPERATOR}', 'Station B', ${B.lat}, ${B.lng}, 'both', '${now}');
    insert into station_staff (station_id, user_id) values ('${A.id}', 'staff-a');
    insert into parcel_depots (station_id, is_active, note, lockers, updated_at) values ('${A.id}', 1, '', 0, '${now}'), ('${B.id}', 1, '', 0, '${now}');
    insert into drivers (user_id, status, full_name, id_number, license_number, wanted_type, code, created_at) values
      ('drv', 'active', 'Yao', 'ID1234', 'LIC1234', 'moto', '${DRIVER_CODE}', '${now}'),
      ('drv2', 'active', 'Mawuli', 'ID5678', 'LIC5678', 'moto', '${DRIVER2_CODE}', '${now}');
    insert into app_settings (key, value, updated_at) values ('drivers_enabled', '1', '${now}');
  `);
  const env = { DB: d1 } as unknown as Env;
  const ctx = (user: Profile, active?: string): ParcelCtx => ({
    env,
    db: env.DB,
    request: new Request("https://app.poinderecharge.com/api", { headers: active ? { "X-Active-Station": active } : {} }),
    user: async () => user,
    requireUser: async () => user,
    requireAdmin: async () => {
      if (user.role !== "admin") throw new Error("forbidden");
      return user;
    },
    isStaffOf: async (u, stationId) => {
      if (u.role === "admin") return true;
      if (u.role !== "operator") return false;
      return !!db
        .prepare(
          `select 1 from stations s where s.id = ?1 and (exists (select 1 from station_staff where station_id = s.id and user_id = ?2)
             or exists (select 1 from operator_owners where operator_id = s.operator_id and user_id = ?2))`,
        )
        .get(stationId, u.id);
    },
    audit: (actor, table, action, rowId, changes, ids = {}) =>
      env.DB.prepare(
        "insert into audit_log (at, actor, table_name, action, row_id, station_id, user_id, changes) values (?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(new Date().toISOString(), actor, table, action, rowId, ids.stationId ?? null, ids.userId ?? null, JSON.stringify(changes)),
  });
  return { db, env, ctx, admin: ctx(ADMIN), atA: ctx(ADMIN, A.id), atB: ctx(ADMIN, B.id), staffA: ctx(STAFF_A), sender: ctx(SENDER) };
}

const parcelInput = (recipientPhone = "92 00 00 00", senderPhone = "91 00 00 00") => ({
  senderPhone,
  recipientPhone,
  toStationId: B.id,
  content: "Documents",
  measures: { lengthCm: 30, widthCm: 20, heightCm: 10, weightKg: 1 },
});

type T = ReturnType<typeof setup>;
const status = (t: T, id: string) => (t.db.prepare("select status, run_id from parcels where id = ?").get(id) as { status: string; run_id: string | null });
const scans = (t: T, id: string) =>
  t.db.prepare("select kind, run_id, driver_id, station_id, scanned_by, role from parcel_scans where parcel_id = ? order by id").all(id) as {
    kind: string;
    run_id: string;
    driver_id: string | null;
    station_id: string | null;
    scanned_by: string;
    role: string;
  }[];

describe("collection run", () => {
  it("records the driver, needs every parcel scanned before it leaves, and is scanned in at the destination", async () => {
    const t = setup();
    const p1 = await createParcel(t.staffA, A.id, parcelInput());
    const p2 = await createParcel(t.staffA, A.id, parcelInput());
    const p3 = await createParcel(t.staffA, A.id, parcelInput());
    for (const p of [p1, p2, p3]) await markLabelPrinted(t.staffA, A.id, p.id);

    // Staff of station A need no active station (they have one); the driver comes from the QR or the typed code.
    await expect(startRun(t.staffA, A.id, "NOTACODE", [p1.id])).rejects.toMatchObject({ code: "driver_not_found" });
    const run = await startRun(t.staffA, A.id, DRIVER_CODE, [p1.id, p2.id]);
    expect(run).toMatchObject({ status: "loading", driver: { userId: "drv", name: "Yao" } });
    expect(run.parcels.map((p) => p.scanned)).toEqual([false, false]);
    // A parcel on a run cannot go on a second one.
    await expect(startRun(t.staffA, A.id, DRIVER2_CODE, [p1.id])).rejects.toMatchObject({ code: "parcel_wrong_status" });

    // Run completion blocked while a parcel is unscanned.
    await expect(departRun(t.staffA, A.id, run.id)).rejects.toMatchObject({ code: "run_unscanned" });
    // A parcel not on this run is refused, also through its slip QR code.
    await expect(scanRunParcel(t.staffA, A.id, run.id, p3.trackingNo)).rejects.toMatchObject({ code: "parcel_not_in_run" });
    await expect(scanRunParcel(t.staffA, A.id, run.id, `poinderecharge colis ${p3.trackingNo}\nDe: Station A`)).rejects.toMatchObject({
      code: "parcel_not_in_run",
    });
    await expect(scanRunParcel(t.staffA, A.id, run.id, "pas un colis")).rejects.toMatchObject({ code: "parcel_not_found" });

    await scanRunParcel(t.staffA, A.id, run.id, `poinderecharge colis ${p1.trackingNo}\nDe: Station A`);
    // The same scan twice is one record.
    const again = await scanRunParcel(t.staffA, A.id, run.id, p1.trackingNo.toLowerCase());
    expect(again.parcels.find((p) => p.id === p1.id)?.scanned).toBe(true);
    expect(scans(t, p1.id)).toEqual([{ kind: "handover_to_driver", run_id: run.id, driver_id: "drv", station_id: A.id, scanned_by: "staff-a", role: "staff" }]);
    await expect(departRun(t.staffA, A.id, run.id)).rejects.toMatchObject({ code: "run_unscanned" });
    expect(status(t, p1.id).status).toBe("deposited");

    await scanRunParcel(t.staffA, A.id, run.id, p2.trackingNo);
    const gone = await departRun(t.staffA, A.id, run.id);
    expect(gone.status).toBe("under_way");
    expect(status(t, p1.id)).toEqual({ status: "in_transit", run_id: run.id });
    expect(status(t, p3.id)).toEqual({ status: "deposited", run_id: null });
    // No more scans once it left.
    await expect(scanRunParcel(t.staffA, A.id, run.id, p1.trackingNo)).rejects.toMatchObject({ code: "run_wrong_status" });

    // At B: the owner or admin must have chosen B as the active station (R7).
    await expect(receiveParcel(t.admin, B.id, p1.trackingNo)).rejects.toMatchObject({ code: "active_station_required" });
    await expect(receiveParcel(t.staffA, B.id, p1.trackingNo)).rejects.toMatchObject({ code: "forbidden" });
    await expect(receiveParcel(t.atB, B.id, p3.trackingNo)).rejects.toMatchObject({ code: "parcel_wrong_status" });
    const arrived = await receiveParcel(t.atB, B.id, p1.trackingNo);
    expect(arrived.status).toBe("arrived");
    // Scanning it in twice changes nothing.
    await receiveParcel(t.atB, B.id, p1.trackingNo);
    expect(scans(t, p1.id).map((s) => [s.kind, s.role, s.station_id])).toEqual([
      ["handover_to_driver", "staff", A.id],
      ["received_at_station", "admin", B.id],
    ]);
    expect((await stationRuns(t.staffA, A.id))[0].status).toBe("under_way");
    await receiveParcel(t.atB, B.id, p2.trackingNo);
    expect((await stationRuns(t.staffA, A.id))[0]).toMatchObject({ id: run.id, status: "done" });
  });

  it("needs the shipping label stuck on before a run, logs every print, and says whether the sender has the app", async () => {
    const t = setup();
    t.db.prepare("update users set last_sign_in_at = ? where id = 'sender'").run(new Date().toISOString());
    const p1 = await createParcel(t.staffA, A.id, parcelInput("92 00 00 00", "91 00 00 00"));
    expect(p1).toMatchObject({ labelPrintedAt: null, senderHasApp: true });
    const p2 = await createParcel(t.staffA, A.id, parcelInput("92 00 00 00", "91 99 99 99"));
    expect(p2.senderHasApp).toBe(false);

    await expect(startRun(t.staffA, A.id, DRIVER_CODE, [p1.id])).rejects.toMatchObject({ code: "parcel_label_missing" });
    await expect(markLabelPrinted(t.sender, A.id, p1.id)).rejects.toMatchObject({ code: "forbidden" });
    await expect(markLabelPrinted(t.staffA, A.id, "nope")).rejects.toMatchObject({ code: "parcel_not_found" });
    const first = await markLabelPrinted(t.staffA, A.id, p1.id);
    expect(first.labelPrintedAt).toEqual(expect.any(String));
    // A reprint keeps the first time and is logged too.
    const again = await markLabelPrinted(t.staffA, A.id, p1.id);
    expect(again.labelPrintedAt).toBe(first.labelPrintedAt);
    const log = t.db.prepare("select changes from audit_log where table_name = 'parcels' and row_id = ? and action = 'update' order by id").all(p1.id) as {
      changes: string;
    }[];
    expect(log.map((l) => JSON.parse(l.changes).label)).toEqual(["printed", "reprinted"]);

    const run = await startRun(t.staffA, A.id, DRIVER_CODE, [p1.id]);
    // The label's QR code holds the parcel number alone.
    await scanRunParcel(t.staffA, A.id, run.id, p1.trackingNo);
    expect(scans(t, p1.id)).toHaveLength(1);
  });

  it("lets staff take a parcel off or call off a run before it leaves", async () => {
    const t = setup();
    const p1 = await createParcel(t.staffA, A.id, parcelInput());
    const p2 = await createParcel(t.staffA, A.id, parcelInput());
    for (const p of [p1, p2]) await markLabelPrinted(t.staffA, A.id, p.id);
    const run = await startRun(t.atA, A.id, DRIVER_CODE, [p1.id, p2.id]);
    await scanRunParcel(t.atA, A.id, run.id, p1.trackingNo);
    // p2 is not on the shelf: off the run, then the run can leave with p1 alone.
    const left = await removeRunParcel(t.atA, A.id, run.id, p2.id);
    expect(left.parcels.map((p) => p.id)).toEqual([p1.id]);
    await expect(removeRunParcel(t.atA, A.id, run.id, p2.id)).rejects.toMatchObject({ code: "parcel_not_in_run" });

    const other = await startRun(t.atA, A.id, DRIVER2_CODE, [p2.id]);
    await scanRunParcel(t.atA, A.id, other.id, p2.trackingNo);
    await cancelRun(t.atA, A.id, other.id);
    expect(status(t, p2.id)).toEqual({ status: "deposited", run_id: null });
    expect(scans(t, p2.id)).toEqual([]);
    await departRun(t.atA, A.id, run.id);
    await expect(cancelRun(t.atA, A.id, run.id)).rejects.toMatchObject({ code: "run_wrong_status" });
  });

  it("only staff of the station, an owner or admin at their active station load a run", async () => {
    const t = setup();
    const p1 = await createParcel(t.staffA, A.id, parcelInput());
    await markLabelPrinted(t.staffA, A.id, p1.id);
    // Owner and admin without the active station: 409; with another one: 409; a customer or driver: 403.
    await expect(startRun(t.ctx(OWNER), A.id, DRIVER_CODE, [p1.id])).rejects.toMatchObject({ code: "active_station_required" });
    await expect(startRun(t.ctx(ADMIN, B.id), A.id, DRIVER_CODE, [p1.id])).rejects.toMatchObject({ code: "active_station_required" });
    await expect(startRun(t.sender, A.id, DRIVER_CODE, [p1.id])).rejects.toMatchObject({ code: "forbidden" });
    const run = await startRun(t.ctx(OWNER, A.id), A.id, DRIVER_CODE, [p1.id]);
    await scanRunParcel(t.ctx(OWNER, A.id), A.id, run.id, p1.trackingNo);
    expect(scans(t, p1.id)[0]).toMatchObject({ scanned_by: "owner", role: "owner" });
  });

  it("shows the customer the real history of the parcel", async () => {
    const t = setup();
    const p1 = await createParcel(t.staffA, A.id, parcelInput("92 00 00 00", SENDER.phone!));
    await markLabelPrinted(t.staffA, A.id, p1.id);
    const run = await startRun(t.staffA, A.id, DRIVER_CODE, [p1.id]);
    await scanRunParcel(t.staffA, A.id, run.id, p1.trackingNo);
    await departRun(t.staffA, A.id, run.id);
    await receiveParcel(t.atB, B.id, p1.trackingNo);
    const [mine] = await myParcels(t.sender);
    expect(mine.history?.map((h) => [h.kind, h.stationId])).toEqual([
      ["deposited", A.id],
      ["handover_to_driver", A.id],
      ["in_transit", A.id],
      ["received_at_station", B.id],
      ["arrived", B.id],
    ]);
    // Never who scanned.
    expect(JSON.stringify(mine.history)).not.toContain("staff-a");
  });
});

describe("R14: parcels only for customers", () => {
  it("refuses a staff, owner, driver, fleet manager or admin number at creation", async () => {
    const t = setup();
    for (const phone of [STAFF_A.phone!, OWNER.phone!, "+22893000001", "+22894000000", ADMIN.phone!]) {
      await expect(createParcel(t.staffA, A.id, parcelInput(phone))).rejects.toMatchObject({ code: "recipient_not_customer" });
      await expect(createParcel(t.staffA, A.id, parcelInput("92 00 00 00", phone))).rejects.toMatchObject({ code: "sender_not_customer" });
      await expect(
        bookPickup(t.sender, { home: HOME, toStationId: A.id, recipientPhone: phone, content: "Clés", size: "S" }),
      ).rejects.toMatchObject({ code: "recipient_not_customer" });
      await expect(
        bookCourier(t.sender, { pickup: HOME, dropoff: { lat: 6.2, lng: 1.19, note: "Agoè" }, recipientPhone: phone, content: "Clés", size: "S" }),
      ).rejects.toMatchObject({ code: "recipient_not_customer" });
    }
    // Customers and numbers without an account are fine.
    expect((await createParcel(t.staffA, A.id, parcelInput(SENDER.phone!))).status).toBe("deposited");
    expect((await createParcel(t.staffA, A.id, parcelInput("92 00 00 00"))).status).toBe("deposited");
    expect(t.db.prepare("select count(*) as n from parcels").get()).toEqual({ n: 2 });
  });
});

describe("bookings checked when they are saved", () => {
  it("refuses a second home delivery of the same parcel, also when both come at once", async () => {
    const t = setup();
    const parcel = await createParcel(t.staffA, A.id, parcelInput(RECIPIENT_PHONE));
    t.db.exec(`update parcels set status = 'arrived', pickup_code = '654321', arrived_at = '${new Date().toISOString()}' where id = '${parcel.id}'`);
    const recipientId = (t.db.prepare("select id from users where phone = ?").get(RECIPIENT_PHONE) as { id: string }).id;
    const recipient = t.ctx({ id: recipientId, phone: RECIPIENT_PHONE, email: null, fullName: null, role: "customer" });
    const results = await Promise.allSettled([bookDelivery(recipient, parcel.id, HOME), bookDelivery(recipient, parcel.id, HOME)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "parcel_wrong_status" } });
    await expect(bookDelivery(recipient, parcel.id, HOME)).rejects.toMatchObject({ code: "parcel_wrong_status" });
    expect(t.db.prepare("select count(*) as n from delivery_jobs where parcel_id = ?").get(parcel.id)).toEqual({ n: 1 });
    const job = t.db.prepare("select id from delivery_jobs where parcel_id = ?").get(parcel.id) as { id: string };
    expect(t.db.prepare("select delivery_status, job_id from parcels where id = ?").get(parcel.id)).toEqual({ delivery_status: "booked", job_id: job.id });
  });

  it("refuses a pickup at booking when no other depot can take the parcel in", async () => {
    const t = setup();
    t.db.exec(`update parcel_depots set is_active = 0 where station_id = '${B.id}'`);
    await expect(bookPickup(t.sender, { home: HOME, toStationId: A.id, recipientPhone: "92 00 00 00", content: "Clés", size: "S" })).rejects.toMatchObject({
      code: "no_origin_depot",
    });
    t.db.exec(`update parcel_depots set is_active = 1 where station_id = '${B.id}'`);
    expect((await bookPickup(t.sender, { home: HOME, toStationId: A.id, recipientPhone: "92 00 00 00", content: "Clés", size: "S" })).status).toBe("open");
  });
});
