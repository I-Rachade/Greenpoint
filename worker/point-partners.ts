// Point partners (partenaires propriétaires, migration 0039): who owns a charging socket.
// Without a partner the socket is ours, at any station. An admin creates the partner, links
// its accounts and gives it sockets; its accounts see a read-only dashboard of their sockets.
// Types and rules: shared/point-partners.ts.

import type { AuditTable } from "../shared/admin/types";
import { parseContact } from "../shared/contact";
import { periodStart, type ReportPeriod } from "../shared/owner-backoffice";
import { normalizeTogoPhone } from "../shared/phone";
import {
  POINT_PARTNER_NAME_MAX,
  type AdminPointPartner,
  type PartnerPoint,
  type PointPartnerDashboard,
  type PointPartnerInput,
  type PointPartnerStatus,
} from "../shared/point-partners";
import { normalizeDeviceId } from "../shared/iot/devices";
import type { ChargingPointStatus, Profile } from "../shared/types";
import { personLabel } from "../shared/wallet";
import { ApiError, nowIso, uuid } from "./http";

interface PartnerCtx {
  db: D1Database;
  requireUser(): Promise<Profile>;
  requireAdmin(): Promise<Profile>;
  audit(
    actor: string | null,
    table: AuditTable,
    action: "insert" | "update" | "delete",
    rowId: string,
    changes: Record<string, unknown>,
    ids?: { stationId?: string | null; userId?: string | null },
  ): D1PreparedStatement;
}

interface PartnerRow {
  id: string;
  name: string;
  contact_phone: string | null;
  status: PointPartnerStatus;
  created_at: string;
}

/** GET /api/admin/point-partners: every partner with its accounts and sockets. */
export async function adminPointPartners(c: PartnerCtx): Promise<AdminPointPartner[]> {
  await c.requireAdmin();
  const [partners, accounts, devices] = await Promise.all([
    c.db.prepare("select * from point_partners order by name").all<PartnerRow>(),
    c.db
      .prepare(
        `select a.partner_id, u.id, u.phone, u.email, u.full_name from point_partner_accounts a
         join users u on u.id = a.user_id order by a.created_at`,
      )
      .all<{ partner_id: string; id: string; phone: string | null; email: string | null; full_name: string | null }>(),
    c.db
      .prepare("select external_id, station_id, outlets, partner_id from devices where partner_id is not null order by created_at")
      .all<{ external_id: string; station_id: string; outlets: number; partner_id: string }>(),
  ]);
  return partners.results.map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    contactPhone: p.contact_phone,
    createdAt: p.created_at,
    accounts: accounts.results
      .filter((a) => a.partner_id === p.id)
      .map((a) => ({ userId: a.id, label: personLabel({ fullName: a.full_name, phone: a.phone, email: a.email }) })),
    devices: devices.results
      .filter((d) => d.partner_id === p.id)
      .map((d) => ({ externalId: d.external_id, stationId: d.station_id, outlets: d.outlets })),
  }));
}

function partnerInput(input: PointPartnerInput) {
  const name = String(input?.name ?? "").trim().replace(/\s+/g, " ");
  if (!name || name.length > POINT_PARTNER_NAME_MAX) throw new ApiError("bad_request");
  const rawPhone = String(input?.contactPhone ?? "").trim();
  const contactPhone = rawPhone ? normalizeTogoPhone(rawPhone) : null;
  if (rawPhone && !contactPhone) throw new ApiError("phone_not_allowed");
  return { name, contact_phone: contactPhone };
}

/** POST /api/admin/point-partners: creates a partner (`id` null, active at once) or edits one. */
export async function savePointPartner(c: PartnerCtx, id: string | null, input: PointPartnerInput): Promise<{ id: string }> {
  const admin = await c.requireAdmin();
  const row = partnerInput(input);
  if (!id) {
    const newId = uuid();
    await c.db.batch([
      c.db
        .prepare("insert into point_partners (id, name, contact_phone, status, created_at) values (?, ?, ?, 'active', ?)")
        .bind(newId, row.name, row.contact_phone, nowIso()),
      c.audit(admin.id, "point_partners", "insert", newId, row),
    ]);
    return { id: newId };
  }
  const before = await c.db.prepare("select name, contact_phone from point_partners where id = ?").bind(id).first<{ name: string; contact_phone: string | null }>();
  if (!before) throw new ApiError("not_found", 404);
  const changes = Object.fromEntries(
    (Object.keys(row) as (keyof typeof row)[]).filter((k) => before[k] !== row[k]).map((k) => [k, [before[k], row[k]]]),
  );
  if (Object.keys(changes).length) {
    await c.db.batch([
      c.db.prepare("update point_partners set name = ?, contact_phone = ? where id = ?").bind(row.name, row.contact_phone, id),
      c.audit(admin.id, "point_partners", "update", id, changes),
    ]);
  }
  return { id };
}

/** POST /api/admin/point-partners/:id/status: a suspended partner's accounts lose the dashboard. */
export async function setPointPartnerStatus(c: PartnerCtx, id: string, active: unknown) {
  const admin = await c.requireAdmin();
  const status: PointPartnerStatus = active ? "active" : "suspended";
  const res = await c.db.prepare("update point_partners set status = ? where id = ? and status <> ?").bind(status, id, status).run();
  if (!res.meta.changes) {
    if (!(await c.db.prepare("select 1 from point_partners where id = ?").bind(id).first())) throw new ApiError("not_found", 404);
    return;
  }
  await c.audit(admin.id, "point_partners", "update", id, { status: [status === "active" ? "suspended" : "active", status] }).run();
}

/** POST /api/admin/point-partners/:id/accounts: links an existing account; it keeps its role. */
export async function addPointPartnerAccount(c: PartnerCtx, partnerId: string, rawContact: unknown) {
  const admin = await c.requireAdmin();
  if (!(await c.db.prepare("select 1 from point_partners where id = ?").bind(partnerId).first())) throw new ApiError("not_found", 404);
  const text = String(rawContact ?? "");
  const contact = parseContact(text);
  if (!contact) throw new ApiError(text.includes("@") ? "invalid_contact" : "phone_not_allowed");
  const account = await c.db
    .prepare(`select id from users where ${contact.kind === "phone" ? "phone" : "email"} = ?`)
    .bind(contact.value)
    .first<{ id: string }>();
  if (!account) throw new ApiError("account_not_found", 404);
  const linked = await c.db.prepare("select partner_id from point_partner_accounts where user_id = ?").bind(account.id).first<{ partner_id: string }>();
  if (linked) {
    if (linked.partner_id === partnerId) return;
    throw new ApiError("already_point_partner", 409);
  }
  await c.db.batch([
    c.db.prepare("insert into point_partner_accounts (user_id, partner_id, created_at) values (?, ?, ?)").bind(account.id, partnerId, nowIso()),
    c.audit(admin.id, "point_partner_accounts", "insert", `${partnerId}:${account.id}`, { partner_id: partnerId }, { userId: account.id }),
  ]);
}

export async function removePointPartnerAccount(c: PartnerCtx, partnerId: string, userId: string) {
  const admin = await c.requireAdmin();
  const res = await c.db.prepare("delete from point_partner_accounts where user_id = ? and partner_id = ?").bind(userId, partnerId).run();
  if (res.meta.changes) {
    await c.audit(admin.id, "point_partner_accounts", "delete", `${partnerId}:${userId}`, { partner_id: partnerId }, { userId }).run();
  }
}

/**
 * POST /api/admin/devices/:id/partner: who owns the socket (null: poinderecharge). Running and
 * past charges keep the owner they started with (charging_sessions.partner_id).
 */
export async function setDevicePartner(c: PartnerCtx, rawId: string, partnerId: unknown) {
  const admin = await c.requireAdmin();
  const externalId = normalizeDeviceId(rawId);
  const target = partnerId === null || partnerId === undefined || partnerId === "" ? null : String(partnerId);
  const device = await c.db.prepare("select station_id, partner_id from devices where external_id = ?").bind(externalId).first<{ station_id: string; partner_id: string | null }>();
  if (!device) throw new ApiError("not_found", 404);
  if (target && !(await c.db.prepare("select 1 from point_partners where id = ?").bind(target).first())) throw new ApiError("not_found", 404);
  if (device.partner_id === target) return;
  await c.db.batch([
    c.db.prepare("update devices set partner_id = ? where external_id = ?").bind(target, externalId),
    c.audit(admin.id, "charging_points", "update", externalId, { device: externalId, partner_id: [device.partner_id, target] }, { stationId: device.station_id }),
  ]);
}

interface PointRow {
  id: string;
  label: string;
  outlet: number | null;
  device_id: string;
  status: ChargingPointStatus;
  power_watts: number | null;
  last_seen_at: string | null;
  station_id: string;
  station_name: string;
  station_address: string;
  lat: number;
  lng: number;
}

/** GET /api/point-partner?days=: the signed-in partner account's sockets and earnings. */
export async function pointPartnerDashboard(c: PartnerCtx, days: ReportPeriod): Promise<PointPartnerDashboard> {
  const user = await c.requireUser();
  const partner = await c.db
    .prepare("select p.* from point_partner_accounts a join point_partners p on p.id = a.partner_id where a.user_id = ?")
    .bind(user.id)
    .first<PartnerRow>();
  if (!partner) throw new ApiError("forbidden", 403);
  if (partner.status !== "active") throw new ApiError("partner_suspended", 403);
  const from = periodStart(days);
  const [points, charges] = await Promise.all([
    c.db
      .prepare(
        `select p.id, p.label, p.outlet, p.device_id, p.status, p.power_watts, p.last_seen_at,
                s.id as station_id, s.name as station_name, s.address as station_address, s.lat, s.lng
           from charging_points p join devices d on d.external_id = p.device_id join stations s on s.id = p.station_id
          where d.partner_id = ? order by s.name, p.label`,
      )
      .bind(partner.id)
      .all<PointRow>(),
    c.db
      .prepare(
        `select charging_point_id, payment_method, count(*) as n, sum(energy_wh) as wh, sum(amount_xof) as xof from charging_sessions
          where partner_id = ? and status = 'paid' and paid_at >= ? group by charging_point_id, payment_method`,
      )
      .bind(partner.id, from)
      .all<{ charging_point_id: string | null; payment_method: string; n: number; wh: number; xof: number }>(),
  ]);
  const totals = { charges: 0, energyWh: 0, amountXof: 0, cashXof: 0, appXof: 0 };
  const perPoint = new Map<string, { charges: number; energyWh: number; amountXof: number }>();
  for (const r of charges.results) {
    totals.charges += r.n;
    totals.energyWh += r.wh;
    totals.amountXof += r.xof;
    if (r.payment_method === "cash") totals.cashXof += r.xof;
    else totals.appXof += r.xof;
    if (!r.charging_point_id) continue;
    const e = perPoint.get(r.charging_point_id) ?? { charges: 0, energyWh: 0, amountXof: 0 };
    e.charges += r.n;
    e.energyWh += r.wh;
    e.amountXof += r.xof;
    perPoint.set(r.charging_point_id, e);
  }
  return {
    partner: { id: partner.id, name: partner.name, status: partner.status, contactPhone: partner.contact_phone },
    days,
    from,
    points: points.results.map(
      (p): PartnerPoint => ({
        id: p.id,
        label: p.label,
        outlet: p.outlet,
        deviceId: p.device_id,
        stationId: p.station_id,
        stationName: p.station_name,
        stationAddress: p.station_address,
        lat: p.lat,
        lng: p.lng,
        status: p.status,
        powerWatts: p.power_watts,
        lastSeenAt: p.last_seen_at,
        ...(perPoint.get(p.id) ?? { charges: 0, energyWh: 0, amountXof: 0 }),
      }),
    ),
    totals,
  };
}
