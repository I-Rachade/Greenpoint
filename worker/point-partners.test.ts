import { describe, expect, it } from "vitest";
import type { OwnerReport } from "../src/lib/owner-backoffice";
import type { AdminPointPartner, PointPartnerDashboard } from "../src/lib/point-partners";
import type { Device } from "../src/lib/iot/devices";
import type { Profile } from "../src/lib/types";
import { handleApi } from "./api";
import type { Env } from "./env";
import { sha256 } from "./http";
import { fakeD1 } from "./test-d1";

// Point partners (migration 0039): an admin creates one, links an account and gives it a socket;
// the account sees its sockets and earnings. Charges keep the owner they started with, and a
// partner station's report no longer counts the charges as its revenue.

const OWN = "00000000-0000-4000-8000-000000000001"; // poinderecharge itself (is_own), from 0001_init.sql
const PEOPLE: (Pick<Profile, "id" | "phone"> & { role: string })[] = [
  { id: "admin", phone: "+22890000001", role: "admin" },
  { id: "ama", phone: "+22890000002", role: "rider" }, // will see Solaire Togo's sockets
  { id: "kossi", phone: "+22890000003", role: "rider" }, // linked to nothing
  { id: "yao", phone: "+22890000004", role: "operator" }, // runs the partner station
];
const token = (id: string) => `${id}-session-token-0123456789`;

async function setup() {
  const { db, d1 } = fakeD1();
  const now = new Date().toISOString();
  for (const u of PEOPLE) {
    db.prepare("insert into users (id, phone, role, created_at) values (?, ?, ?, ?)").run(u.id, u.phone, u.role, now);
    db.prepare("insert into sessions (token_hash, user_id, created_at, expires_at) values (?, ?, ?, ?)").run(
      await sha256(token(u.id)),
      u.id,
      now,
      new Date(Date.now() + 3_600_000).toISOString(),
    );
  }
  db.exec(`
    insert into operators (id, name, is_own, created_at) values ('partner', 'Station Kpota', 0, '${now}');
    insert into operator_owners (operator_id, user_id, created_at) values ('partner', 'yao', '${now}');
    insert into stations (id, operator_id, name, address, lat, lng, kind, battery_capacity, created_at) values
      ('st', '${OWN}', 'Bè', 'Rue de Bè', 6.13, 1.22, 'charging', 0, '${now}'),
      ('kp', 'partner', 'Kpota', 'Route d''Aného', 6.14, 1.23, 'charging', 0, '${now}');
    insert into devices (external_id, station_id, vendor, link, outlets, last_seen_at, created_at) values
      ('123456', 'kp', 'Xingke', 'own_server', 2, '${now}', '${now}'),
      ('654321', 'st', 'Xingke', 'own_server', 1, '${now}', '${now}');
    insert into charging_points (id, station_id, label, status, device_id, outlet, last_seen_at, created_at) values
      ('p1', 'kp', '3456-1', 'charging', '123456', 1, '${now}', '${now}'),
      ('p2', 'kp', '3456-2', 'free', '123456', 2, '${now}', '${now}'),
      ('q1', 'st', '4321-1', 'free', '654321', 1, '${now}', '${now}');
  `);
  return { db, env: { DB: d1 } as unknown as Env, now };
}

async function api<T>(env: Env, who: string, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await handleApi(
    new Request(`https://app.poinderecharge.com${path}`, {
      method,
      headers: { Authorization: `Bearer ${token(who)}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, data: (await res.json()) as T };
}

/** A charge as openCharge() inserts it (the trigger sets the owner), then paid. */
function paidCharge(db: ReturnType<typeof fakeD1>["db"], id: string, point: string, device: string, station: string, method: string, xof: number) {
  const at = new Date().toISOString();
  db.prepare(
    `insert into charging_sessions (id, station_id, charging_point_id, device_id, outlet, point_label, kwh_xof, min_xof, started_by, started_at)
     values (?, ?, ?, ?, 1, 'x', 150, 100, 'admin', ?)`,
  ).run(id, station, point, device, at);
  db.prepare("update charging_sessions set status = 'paid', energy_wh = 2000, amount_xof = ?, payment_method = ?, paid_at = ? where id = ?").run(xof, method, at, id);
}

describe("point partners", () => {
  it("an admin creates a partner, links an account and gives it a socket; the account sees it", async () => {
    const { db, env } = await setup();
    const created = await api<{ id: string }>(env, "admin", "POST", "/api/admin/point-partners", { id: null, input: { name: " Solaire  Togo ", contactPhone: "90 11 22 33" } });
    expect(created.status).toBe(200);
    const pp = created.data.id;
    expect((await api(env, "admin", "POST", `/api/admin/point-partners/${pp}/accounts`, { contact: "+22890000002" })).status).toBe(200);
    expect((await api(env, "admin", "POST", "/api/admin/devices/123456/partner", { partnerId: pp })).status).toBe(200);

    const list = await api<AdminPointPartner[]>(env, "admin", "GET", "/api/admin/point-partners");
    expect(list.data).toEqual([
      expect.objectContaining({
        id: pp,
        name: "Solaire Togo",
        contactPhone: "+22890112233",
        status: "active",
        accounts: [{ userId: "ama", label: expect.any(String) }],
        devices: [{ externalId: "123456", stationId: "kp", outlets: 2 }],
      }),
    ]);
    const devices = await api<Device[]>(env, "admin", "GET", "/api/admin/devices");
    expect(Object.fromEntries(devices.data.map((d) => [d.externalId, d.partnerId]))).toEqual({ "123456": pp, "654321": null });

    // The account keeps its role and sees the partner on its profile.
    const me = await api<Profile>(env, "ama", "GET", "/api/me");
    expect(me.data).toMatchObject({ role: "customer", pointPartner: { id: pp, name: "Solaire Togo", status: "active" } });

    paidCharge(db, "c1", "p1", "123456", "kp", "cash", 300);
    paidCharge(db, "c2", "q1", "654321", "st", "cash", 500); // our socket: not the partner's
    const dash = await api<PointPartnerDashboard>(env, "ama", "GET", "/api/point-partner?days=7");
    expect(dash.status).toBe(200);
    expect(dash.data.partner.name).toBe("Solaire Togo");
    expect(dash.data.totals).toEqual({ charges: 1, energyWh: 2000, amountXof: 300, cashXof: 300, appXof: 0 });
    expect(dash.data.points.map((p) => [p.label, p.stationName, p.status, p.charges, p.amountXof])).toEqual([
      ["3456-1", "Kpota", "charging", 1, 300],
      ["3456-2", "Kpota", "free", 0, 0],
    ]);
  });

  it("keeps the owner a charge started with when the socket changes owner", async () => {
    const { db, env } = await setup();
    db.exec("insert into point_partners (id, name, created_at) values ('pp', 'Solaire Togo', 'x'); insert into point_partner_accounts (user_id, partner_id, created_at) values ('ama', 'pp', 'x')");
    await api(env, "admin", "POST", "/api/admin/devices/123456/partner", { partnerId: "pp" });
    paidCharge(db, "c1", "p1", "123456", "kp", "cash", 300);
    await api(env, "admin", "POST", "/api/admin/devices/123456/partner", { partnerId: null });
    paidCharge(db, "c2", "p1", "123456", "kp", "cash", 400);
    expect(db.prepare("select id, partner_id from charging_sessions order by id").all()).toEqual([
      { id: "c1", partner_id: "pp" },
      { id: "c2", partner_id: null },
    ]);
    const dash = await api<PointPartnerDashboard>(env, "ama", "GET", "/api/point-partner?days=7");
    expect(dash.data.points).toEqual([]);
    expect(dash.data.totals.amountXof).toBe(300);
  });

  it("refuses accounts of no partner, a suspended partner and a second partner", async () => {
    const { db, env } = await setup();
    db.exec("insert into point_partners (id, name, created_at) values ('pp', 'Solaire Togo', 'x'), ('pq', 'Autre', 'x'); insert into point_partner_accounts (user_id, partner_id, created_at) values ('ama', 'pp', 'x')");
    expect((await api<{ error: string }>(env, "kossi", "GET", "/api/point-partner")).data.error).toBe("forbidden");
    expect((await api<{ error: string }>(env, "admin", "POST", "/api/admin/point-partners/pq/accounts", { contact: "+22890000002" })).data.error).toBe("already_point_partner");
    expect((await api<{ error: string }>(env, "admin", "POST", "/api/admin/point-partners/pp/accounts", { contact: "+22899999999" })).data.error).toBe("account_not_found");
    expect((await api(env, "admin", "POST", "/api/admin/point-partners/pp/status", { active: false })).status).toBe(200);
    const suspended = await api<{ error: string }>(env, "ama", "GET", "/api/point-partner");
    expect(suspended).toEqual({ status: 403, data: { error: "partner_suspended" } });
    await api(env, "admin", "POST", "/api/admin/point-partners/pp/status", { active: true });
    expect((await api(env, "ama", "GET", "/api/point-partner")).status).toBe(200);
    await api(env, "admin", "DELETE", "/api/admin/point-partners/pp/accounts/ama");
    expect((await api(env, "ama", "GET", "/api/point-partner")).status).toBe(403);
    expect((await api(env, "ama", "GET", "/api/admin/point-partners")).status).toBe(403);
  });

  it("keeps the charges at a partner's station out of its revenue: the cash is owed to poinderecharge", async () => {
    const { db, env } = await setup();
    paidCharge(db, "c1", "p1", "123456", "kp", "cash", 300);
    paidCharge(db, "c2", "p2", "123456", "kp", "wallet", 200);
    const report = await api<OwnerReport>(env, "yao", "GET", "/api/owner/report?days=7");
    expect(report.status).toBe(200);
    expect(report.data.revenue).toMatchObject({ chargeCashXof: 0, chargeAppXof: 0, totalXof: 0 });
    expect(report.data.poinderecharge).toMatchObject({ chargesXof: 300, totalXof: 300, thirdParty: true });
    // Still counted as charges in the statistics.
    expect(report.data.perDay.reduce((a, d) => a + d.charges, 0)).toBe(2);
  });
});
