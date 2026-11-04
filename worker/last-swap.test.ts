import { describe, expect, it } from "vitest";
import type { MyLastSwap } from "../shared/station-work";
import { handleApi } from "./api";
import type { Env } from "./env";
import { sha256 } from "./http";
import { roleToDb } from "./roles";
import { fakeD1 } from "./test-d1";

// GET /api/me/last-swap (home "Mon scooter", mockup A1): the customer's own latest swap.

const OWN = "00000000-0000-4000-8000-000000000001";
const USERS = [
  { id: "ama", role: "customer" as const },
  { id: "esi", role: "customer" as const },
  { id: "afi", role: "operator" as const },
];

async function setup() {
  const { db, d1 } = fakeD1();
  const env = { DB: d1 } as unknown as Env;
  const now = new Date().toISOString();
  for (const [i, u] of USERS.entries()) {
    db.prepare("insert into users (id, phone, full_name, role, created_at) values (?, ?, ?, ?, ?)").run(u.id, `+2289000000${i}`, u.id, roleToDb(u.role), now);
    db.prepare("insert into sessions (token_hash, user_id, created_at, expires_at) values (?, ?, ?, ?)").run(
      await sha256(`token-of-${u.id}-0123456789`),
      u.id,
      now,
      new Date(Date.now() + 3_600_000).toISOString(),
    );
  }
  db.exec(`
    insert into stations (id, operator_id, name, lat, lng, kind, battery_capacity, opening_hours, created_at) values
      ('lome', '${OWN}', 'Lomé', 6.14, 1.23, 'swap', 10, '00:00-24:00', '${now}'), ('be', '${OWN}', 'Bè', 6.13, 1.22, 'swap', 10, '00:00-24:00', '${now}');
    insert into battery_types (id, brand, name, created_at) values ('ov72', 'Omnivoltaic', '72 V', '${now}');
    insert into swap_log (id, request_id, station_id, battery_type_id, has_battery_in, battery_in_label, battery_out_label, customer_type, customer_user_id, payment, amount_xof, staff_id, role, created_at, in_pct, out_pct) values
      ('s1', 'r1', 'lome', 'ov72', 1, 'B-1', 'B-2', 'app', 'ama', 'cash', 500, 'afi', 'staff', '2026-11-01T10:00:00.000Z', null, null),
      ('s2', 'r2', 'be', 'ov72', 1, 'B-2', 'B-3', 'app', 'ama', 'cash', 900, 'afi', 'staff', '2026-11-03T17:40:00.000Z', 12, 96),
      ('s3', 'r3', 'lome', 'ov72', 1, 'B-9', 'B-8', 'app', 'esi', 'cash', 500, 'afi', 'staff', '2026-11-04T08:00:00.000Z', null, null);
  `);
  return env;
}

const get = async (env: Env, as: string) => {
  const res = await handleApi(
    new Request("https://app.poinderecharge.com/api/me/last-swap", { headers: { Authorization: `Bearer token-of-${as}-0123456789` } }),
    env,
  );
  return { status: res.status, body: (await res.json()) as MyLastSwap | null };
};

describe("my last swap", () => {
  it("is the customer's own latest swap, with its station, battery and charge", async () => {
    const env = await setup();
    expect((await get(env, "ama")).body).toEqual({
      at: "2026-11-03T17:40:00.000Z",
      stationId: "be",
      stationName: "Bè",
      batteryTypeLabel: "Omnivoltaic 72 V",
      batteryOut: "B-3",
      outPct: 96,
    });
    expect((await get(env, "esi")).body?.stationId).toBe("lome");
  });

  it("is refused to staff", async () => {
    const env = await setup();
    expect((await get(env, "afi")).status).toBe(403);
  });
});
