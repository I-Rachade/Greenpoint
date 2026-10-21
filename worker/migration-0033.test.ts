import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { applyMigration, fakeD1 } from "./test-d1";

// Migration 0033 (plan phase 8, W2): staff work at exactly one station. Existing staff with
// several stations keep the one they used most recently; the others go to the station's owner
// as a list to re-staff (staff_reassignments). Then the unique index station_staff(user_id).

const OWN = "00000000-0000-4000-8000-000000000001";
const T1 = "2026-10-01T08:00:00.000Z";
const T2 = "2026-10-10T08:00:00.000Z";
const T3 = "2026-10-14T08:00:00.000Z";

function seed(db: DatabaseSync) {
  db.exec(`
    insert into users (id, phone, full_name, role, created_at) values
      ('afi', '+22890000001', 'Afi', 'operator', '${T1}'),
      ('kodjo', '+22890000002', 'Kodjo', 'operator', '${T1}'),
      ('mawuli', '+22890000003', 'Mawuli', 'operator', '${T1}'),
      ('yao', '+22890000004', 'Yao', 'operator', '${T1}'),
      ('esi', '+22890000005', 'Esi', 'operator', '${T1}'),
      ('ama', '+22890000006', 'Ama', 'rider', '${T1}');
    insert into operators (id, name, is_own, created_at) values ('partner', 'Kara Énergie', 0, '${T1}');
    insert into operator_owners (operator_id, user_id, created_at) values ('partner', 'yao', '${T1}');
    insert into stations (id, operator_id, name, lat, lng, kind, created_at) values
      ('be', '${OWN}', 'Bè', 6.13, 1.22, 'both', '${T1}'),
      ('lome', '${OWN}', 'Lomé', 6.14, 1.23, 'both', '${T1}'),
      ('kara', 'partner', 'Kara', 9.55, 1.19, 'both', '${T1}'),
      ('sokode', 'partner', 'Sokodé', 8.98, 1.13, 'both', '${T1}');
    insert into station_status (station_id, is_open, free_slots, full_batteries, updated_at, updated_by) values
      ('be', 1, 0, 3, '${T1}', null), ('lome', 1, 0, 3, '${T1}', null), ('kara', 1, 0, 3, '${T3}', 'kodjo'), ('sokode', 1, 0, 3, '${T1}', null);
    -- Afi: three stations, last seen at Lomé (a counter event), earlier at Bè (audit log).
    -- Kodjo: two stations, last seen at Kara (station status). Mawuli: two stations, no trace:
    -- keeps the assignment made last. Yao owns Kara and Sokodé and is listed at both and at Bè.
    -- Esi: one station, nothing changes.
    insert into station_staff (station_id, user_id) values
      ('be', 'afi'), ('lome', 'afi'), ('kara', 'afi'),
      ('kara', 'kodjo'), ('be', 'kodjo'),
      ('lome', 'mawuli'), ('be', 'mawuli'),
      ('kara', 'yao'), ('sokode', 'yao'), ('be', 'yao'),
      ('sokode', 'esi');
    insert into audit_log (at, actor, table_name, action, row_id, station_id, changes) values
      ('${T2}', 'afi', 'station_status', 'update', 'be', 'be', '{}'),
      ('${T1}', 'kodjo', 'station_status', 'update', 'be', 'be', '{}');
    insert into battery_events (id, request_id, station_id, type, delta, full_after, empty_after, person_id, role, created_at) values
      ('ev1', 'req-00000001', 'lome', 'full', 1, 4, 0, 'afi', 'staff', '${T3}');
    insert into charging_sessions (id, station_id, device_id, outlet, point_label, kwh_xof, min_xof, started_by, started_at) values
      ('cs1', 'kara', 'd1', 1, 'P1', 150, 100, 'afi', '${T1}');
  `);
}

const staff = (db: DatabaseSync) =>
  db.prepare("select user_id, station_id from station_staff order by user_id, station_id").all() as { user_id: string; station_id: string }[];

describe("migration 0033: one station per staff member", () => {
  it("keeps the station each person used last and lists the others for the owners to re-staff", () => {
    const { db } = fakeD1({ before: "0033" });
    seed(db);
    applyMigration(db, "0033_staff_one_station.sql");

    expect(staff(db)).toEqual([
      { user_id: "afi", station_id: "lome" },
      { user_id: "esi", station_id: "sokode" },
      { user_id: "kodjo", station_id: "kara" },
      // No trace anywhere: the assignment made last.
      { user_id: "mawuli", station_id: "be" },
      // An owner's rows at their own operator's stations are dropped (operator_owners gives the rights);
      // the one at another operator's station stays.
      { user_id: "yao", station_id: "be" },
    ]);
    const list = db
      .prepare("select user_id, station_id, operator_id, resolved_at from staff_reassignments order by user_id, station_id")
      .all();
    expect(list).toEqual([
      { user_id: "afi", station_id: "be", operator_id: OWN, resolved_at: null },
      { user_id: "afi", station_id: "kara", operator_id: "partner", resolved_at: null },
      { user_id: "kodjo", station_id: "be", operator_id: OWN, resolved_at: null },
      { user_id: "mawuli", station_id: "lome", operator_id: OWN, resolved_at: null },
    ]);
    // Every removed assignment is in the activity log too.
    expect(db.prepare("select count(*) as n from audit_log where table_name = 'station_staff' and action = 'delete'").get()).toEqual({ n: 4 });
  });

  it("loses nothing else: every assignment is kept, listed or an owner's own station", () => {
    const { db } = fakeD1({ before: "0033" });
    seed(db);
    const before = staff(db).length;
    const counts = () =>
      ["users", "stations", "operator_owners", "audit_log", "battery_events", "charging_sessions", "station_status"].map(
        (t) => (db.prepare(`select count(*) as n from ${t}`).get() as { n: number }).n,
      );
    const other = counts();
    applyMigration(db, "0033_staff_one_station.sql");
    const kept = staff(db).length;
    const listed = (db.prepare("select count(*) as n from staff_reassignments").get() as { n: number }).n;
    expect(kept + listed + 2).toBe(before); // 2: Yao at Kara and Sokodé, run as owner
    // Only the activity log grows (one row per removed assignment).
    const after = counts();
    expect(after[3]).toBe(other[3] + listed);
    expect([...after.slice(0, 3), ...after.slice(4)]).toEqual([...other.slice(0, 3), ...other.slice(4)]);
    expect(db.prepare("select name from sqlite_master where name like 'm33_%'").all()).toEqual([]);
  });

  it("creates the unique index, so a second station is refused from now on", () => {
    const { db } = fakeD1({ before: "0033" });
    seed(db);
    applyMigration(db, "0033_staff_one_station.sql");
    expect(db.prepare("select name from sqlite_master where type = 'index' and name = 'station_staff_one_station'").get()).toEqual({
      name: "station_staff_one_station",
    });
    expect(() => db.exec("insert into station_staff (station_id, user_id) values ('be', 'esi')")).toThrow(/UNIQUE/);
    db.exec("insert into station_staff (station_id, user_id) values ('be', 'ama')");
  });

  it("runs on an empty database and before or after 0034", () => {
    const { db } = fakeD1({ before: "0033" });
    applyMigration(db, "0033_staff_one_station.sql");
    applyMigration(db, "0034_parcel_scans.sql");
    expect(staff(db)).toEqual([]);
  });
});
