import { describe, expect, it } from "vitest";
import { applyMigration, fakeD1 } from "./test-d1";

// Migration 0066 adds the problems reported at a station; its checks keep a report whole.

const T = "2026-11-02T10:00:00.000Z";
const OP = "00000000-0000-4000-8000-000000000001";

describe("migration 0066", () => {
  it("adds station_incidents with its checks", () => {
    const { db } = fakeD1({ before: "0066" });
    db.exec(`insert into stations (id, operator_id, name, lat, lng, kind, created_at) values ('be', '${OP}', 'Bè', 6.1, 1.2, 'swap', '${T}')`);
    applyMigration(db, "0066_station_incidents.sql");
    const add = (sql: string) => () => db.exec(`insert into station_incidents (id, request_id, station_id, kind, comment, reported_by, role, created_at, status, resolved_by, resolved_at) values ${sql}`);
    add(`('a', 'r-a', 'be', 'power', null, 'afi', 'staff', '${T}', 'open', null, null)`)();
    add(`('b', 'r-b', 'be', 'other', 'Porte cassée', 'afi', 'staff', '${T}', 'resolved', 'yao', '${T}')`)();
    // "other" needs a comment; a handled report says by whom and when; an unknown kind is refused.
    expect(add(`('c', 'r-c', 'be', 'other', null, 'afi', 'staff', '${T}', 'open', null, null)`)).toThrow(/CHECK/);
    expect(add(`('d', 'r-d', 'be', 'power', null, 'afi', 'staff', '${T}', 'resolved', null, null)`)).toThrow(/CHECK/);
    expect(add(`('e', 'r-e', 'be', 'flood', null, 'afi', 'staff', '${T}', 'open', null, null)`)).toThrow(/CHECK/);
    expect(add(`('f', 'r-a', 'be', 'power', null, 'afi', 'staff', '${T}', 'open', null, null)`)).toThrow(/UNIQUE/);
    expect(db.prepare("select id from station_incidents order by id").all()).toEqual([{ id: "a" }, { id: "b" }]);
  });
});
