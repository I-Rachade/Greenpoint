import { describe, expect, it } from "vitest";
import { applyMigration, fakeD1 } from "./test-d1";

// Migration 0065 rebuilds swap_log for the payment 'mobile_money' and adds the fields of swaps
// priced by energy. Every swap before is copied as it was, with the new fields empty.

const T = "2026-11-02T10:00:00.000Z";
const OP = "00000000-0000-4000-8000-000000000001";

describe("migration 0065", () => {
  it("keeps every swap and adds energy pricing", () => {
    const { db } = fakeD1({ before: "0065" });
    db.exec(`
      insert into users (id, phone, role, created_at) values ('ama', '+22890000005', 'rider', '${T}');
      insert into stations (id, operator_id, name, lat, lng, kind, created_at) values ('be', '${OP}', 'Bè', 6.1, 1.2, 'swap', '${T}');
      insert into battery_types (id, brand, name, created_at) values ('ov30', 'Omnivoltaic', '30 Ah', '${T}');
      insert into swap_log (id, request_id, station_id, battery_type_id, has_battery_in, battery_in_label, battery_out_label, customer_type,
          customer_user_id, payment, amount_xof, staff_id, role, created_at, owner) values
        ('s1', 'req-00000001', 'be', 'ov30', 1, 'A1', 'A2', 'app', 'ama', 'wallet', 500, 'afi', 'staff', '${T}', 'poinderecharge'),
        ('s2', 'req-00000002', 'be', '', 0, null, 'B1', 'first_purchase', null, 'cash', 30000, 'afi', 'staff', '${T}', null);
    `);
    const before = db.prepare("select * from swap_log order by id").all();
    applyMigration(db, "0065_energy_swap.sql");
    const after = db.prepare("select * from swap_log order by id").all() as Record<string, unknown>[];
    expect(after.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => k in (before[0] as object))))).toEqual(before);
    expect(after.every((r) => r.in_pct === null && r.mm_ref === null)).toBe(true);
    expect(db.prepare("select pricing, price_full_xof from battery_types").all()).toEqual([{ pricing: "station", price_full_xof: null }]);
    // A type priced by energy needs its price; Mobile Money needs its network and transaction id.
    expect(() => db.prepare("update battery_types set pricing = 'energy'").run()).toThrow(/CHECK/);
    db.prepare("update battery_types set pricing = 'energy', price_full_xof = 900").run();
    const insert = db.prepare(
      `insert into swap_log (id, request_id, station_id, has_battery_in, customer_type, payment, amount_xof, staff_id, role, created_at, in_pct, out_pct, mm_network, mm_ref)
       values (?, ?, 'be', 1, 'cash', 'mobile_money', 720, 'afi', 'staff', '${T}', ?, ?, ?, ?)`,
    );
    insert.run("s3", "req-00000003", 20, 100, "tmoney", "TM1234");
    expect(() => insert.run("s4", "req-00000004", 20, 100, "tmoney", "TM1234")).toThrow(/UNIQUE/);
    expect(() => insert.run("s5", "req-00000005", 60, 40, "tmoney", "TM5555")).toThrow(/CHECK/);
    expect(() => insert.run("s6", "req-00000006", 20, 100, null, null)).toThrow(/CHECK/);
    expect(db.prepare("select name from sqlite_master where type = 'index' and tbl_name = 'swap_log' order by name").all()).toEqual([
      { name: "sqlite_autoindex_swap_log_1" },
      { name: "sqlite_autoindex_swap_log_2" },
      { name: "swap_log_driver_idx" },
      { name: "swap_log_mm_ref_idx" },
      { name: "swap_log_station_idx" },
    ]);
  });
});
