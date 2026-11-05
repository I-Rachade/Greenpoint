import { describe, expect, it } from "vitest";
import { applyMigration, fakeD1 } from "./test-d1";

// Migration 0063 rebuilds devices so a socket can be registered without a station: every box,
// its queued commands and OCPP transactions stay, and new charges still take the box's owner.

const T = "2026-10-28T08:00:00.000Z";
const OPERATOR = "00000000-0000-4000-8000-000000000001"; // created by 0001_init.sql

describe("migration 0063", () => {
  it("keeps every socket with its commands and transactions, and allows a socket without a station", () => {
    const { db } = fakeD1({ before: "0063" });
    db.exec(`
      insert into stations (id, operator_id, name, lat, lng, kind, created_at) values ('st', '${OPERATOR}', 'Bè', 6.13, 1.22, 'charging', '${T}');
      insert into point_partners (id, name, created_at) values ('pp', 'Partenaire', '${T}');
      insert into devices (external_id, station_id, vendor, model, link, outlets, last_seen_at, created_at, vendor_ref, protocol, ocpp_key_hash, partner_id, qr_token, qr_code)
        values ('101104', 'st', 'Xingke', 'X2', 'vendor_cloud', 2, '${T}', '${T}', '101104', null, null, 'pp', 'tok', 'abcd1234'),
               ('CP01', 'st', '', '', 'own_server', 1, null, '${T}', 'CP01', 'ocpp1.6', 'hash', null, null, null);
      insert into charging_points (id, station_id, label, device_id, outlet, created_at) values ('cp1', 'st', '1104-1', '101104', 1, '${T}');
      insert into device_commands (external_id, outlet, kind, order_no, line, created_at) values ('101104', 1, 'start', 'o1', 'line', '${T}');
      insert into ocpp_transactions (external_id, connector_id, id_tag, meter_start, started_at) values ('CP01', 1, 'tag', 0, '${T}');
    `);
    const before = {
      devices: db.prepare("select * from devices order by external_id").all(),
      commands: db.prepare("select * from device_commands").all(),
      transactions: db.prepare("select * from ocpp_transactions").all(),
      points: db.prepare("select * from charging_points").all(),
    };
    expect(() => db.prepare("insert into devices (external_id, station_id, created_at) values ('LOOSE', null, ?)").run(T)).toThrow(/NOT NULL/);

    applyMigration(db, "0063_device_without_station.sql");

    expect(db.prepare("select * from devices order by external_id").all()).toEqual(before.devices);
    expect(db.prepare("select * from device_commands").all()).toEqual(before.commands);
    expect(db.prepare("select * from ocpp_transactions").all()).toEqual(before.transactions);
    expect(db.prepare("select * from charging_points").all()).toEqual(before.points);
    expect(db.prepare("select name from sqlite_master where name like 'm63_%' or name = 'devices_new'").all()).toEqual([]);
    for (const index of ["devices_station_idx", "devices_partner_idx", "devices_qr_token", "devices_qr_code"]) {
      expect(db.prepare("select 1 as ok from sqlite_master where type = 'index' and name = ?").get(index)).toEqual({ ok: 1 });
    }

    db.prepare("insert into devices (external_id, station_id, created_at) values ('LOOSE', null, ?)").run(T);
    // The trigger is back: a new charge takes the socket's owner.
    db.exec(`insert into charging_sessions (id, station_id, device_id, outlet, point_label, kwh_xof, min_xof, started_by, started_at)
      values ('cs', 'st', '101104', 1, '1104-1', 150, 0, 'admin', '${T}')`);
    expect(db.prepare("select partner_id from charging_sessions where id = 'cs'").get()).toEqual({ partner_id: "pp" });
    // Deleting a box still takes its commands with it.
    db.prepare("delete from devices where external_id = 'CP01'").run();
    expect(db.prepare("select count(*) as n from ocpp_transactions").get()).toEqual({ n: 0 });
  });
});
