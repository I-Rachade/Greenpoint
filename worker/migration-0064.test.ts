import { describe, expect, it } from "vitest";
import { applyMigration, fakeD1 } from "./test-d1";

// Migration 0064 gives each battery type of a station its own places: the station's places are
// shared out over its types (never below a type's full batteries) and the station's number
// becomes their sum. Stations without types or without a limit keep what they had.

const T = "2026-10-29T10:00:00.000Z";
const OP = "00000000-0000-4000-8000-000000000001";

describe("migration 0064", () => {
  it("shares each station's places out over its battery types", () => {
    const { db } = fakeD1({ before: "0064" });
    db.exec(`
      insert into battery_types (id, brand, name, created_at) values
        ('ov60', 'Omnivoltaic', '60 V', '${T}'), ('ov72', 'Omnivoltaic', '72 V', '${T}'), ('sp72', 'Spiro', '72 V', '${T}');
      insert into stations (id, operator_id, name, lat, lng, kind, battery_capacity, created_at) values
        ('three', '${OP}', 'Trois', 6.1, 1.2, 'swap', 10, '${T}'),
        ('full', '${OP}', 'Pleine', 6.1, 1.2, 'swap', 6, '${T}'),
        ('none', '${OP}', 'Sans limite', 6.1, 1.2, 'swap', 0, '${T}'),
        ('plain', '${OP}', 'Sans type', 6.1, 1.2, 'swap', 8, '${T}');
      insert into station_battery_types (station_id, battery_type_id, full_batteries) values
        ('three', 'sp72', 1), ('three', 'ov60', 0), ('three', 'ov72', 2),
        ('full', 'ov60', 5), ('full', 'ov72', 0),
        ('none', 'ov60', 4);
    `);
    applyMigration(db, "0064_battery_type_capacity.sql");
    expect(db.prepare("select station_id, battery_type_id, capacity from station_battery_types order by station_id, battery_type_id").all()).toEqual([
      // 6 places for 2 types, but 5 are full already: that type keeps 5.
      { station_id: "full", battery_type_id: "ov60", capacity: 5 },
      { station_id: "full", battery_type_id: "ov72", capacity: 3 },
      { station_id: "none", battery_type_id: "ov60", capacity: 0 },
      // 10 places for 3 types: 4, 3, 3, brands and models sorted.
      { station_id: "three", battery_type_id: "ov60", capacity: 4 },
      { station_id: "three", battery_type_id: "ov72", capacity: 3 },
      { station_id: "three", battery_type_id: "sp72", capacity: 3 },
    ]);
    expect(db.prepare("select id, battery_capacity from stations order by id").all()).toEqual([
      { id: "full", battery_capacity: 8 },
      { id: "none", battery_capacity: 0 },
      { id: "plain", battery_capacity: 8 },
      { id: "three", battery_capacity: 10 },
    ]);
    expect(() => db.prepare("update station_battery_types set capacity = -1 where station_id = 'none'").run()).toThrow(/CHECK/);
  });
});
