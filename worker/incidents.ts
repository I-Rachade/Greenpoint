// Problems reported at a station (migration 0066, shared/incidents.ts): anyone working there
// reports one; the station's owners and the admins are told at once; an owner or an admin
// marks it handled. Staff see their station's reports, owners and admins also handle them.

import { checkIncident, cleanIncidentText, type Incident, type IncidentInput, type IncidentKind, type IncidentStatus } from "../shared/incidents";
import { validRequestId, type StationRole } from "../shared/station-work";
import { personLabel } from "../shared/wallet";
import { ApiError, nowIso, uuid } from "./http";
import { notifyUser } from "./notify";
import { roleAtStation, stationActor, type WorkCtx } from "./station-work";

interface IncidentRow {
  id: string;
  station_id: string;
  kind: IncidentKind;
  comment: string | null;
  battery_label: string | null;
  role: StationRole;
  created_at: string;
  status: IncidentStatus;
  resolved_at: string | null;
  resolution: string | null;
  r_name: string | null;
  r_phone: string | null;
  r_email: string | null;
  x_name: string | null;
  x_phone: string | null;
  x_email: string | null;
}

const SELECT = `
  select i.*, ru.full_name as r_name, ru.phone as r_phone, ru.email as r_email,
         xu.full_name as x_name, xu.phone as x_phone, xu.email as x_email
  from station_incidents i
  left join users ru on ru.id = i.reported_by
  left join users xu on xu.id = i.resolved_by`;

const who = (name: string | null, phone: string | null, email: string | null) =>
  name || phone || email ? personLabel({ fullName: name, phone, email }) : null;

function toIncident(r: IncidentRow): Incident {
  return {
    id: r.id,
    stationId: r.station_id,
    kind: r.kind,
    comment: r.comment,
    batteryLabel: r.battery_label,
    person: who(r.r_name, r.r_phone, r.r_email) ?? "",
    role: r.role,
    createdAt: r.created_at,
    status: r.status,
    resolvedBy: who(r.x_name, r.x_phone, r.x_email),
    resolvedAt: r.resolved_at,
    resolution: r.resolution,
  };
}

/** French names of the kinds, for the alert (the people told read French). */
const KIND_FR: Record<IncidentKind, string> = {
  charger: "Panne de chargeur",
  power: "Coupure électrique",
  battery: "Anomalie batterie",
  payment: "Erreur de paiement",
  other: "Autre problème",
};

/** Tells the station's owners and the admins (push and e-mail). Never throws. */
async function alertIncident(c: WorkCtx, stationId: string, incident: Incident) {
  try {
    const station = await c.db.prepare("select name, operator_id from stations where id = ?").bind(stationId).first<{ name: string; operator_id: string }>();
    const { results } = await c.db
      .prepare("select user_id as id from operator_owners where operator_id = ?1 union select id from users where role = 'admin'")
      .bind(station?.operator_id ?? "")
      .all<{ id: string }>();
    const lines = [
      `${KIND_FR[incident.kind]} à ${station?.name ?? stationId}, signalé par ${incident.person || "un agent"}.`,
      incident.batteryLabel ? `Batterie : ${incident.batteryLabel}.` : "",
      incident.comment ?? "",
      "Voir Mes stations, Historique, pour le marquer traité.",
    ].filter(Boolean);
    const message = { subject: `${KIND_FR[incident.kind]} : ${station?.name ?? stationId}`, text: lines.join("\n\n") };
    await Promise.all(results.map((u) => notifyUser(c.env, u.id, message)));
  } catch (err) {
    console.error("Incident alert failed", incident.id, (err as Error).message);
  }
}

/** POST /api/stations/:id/incidents: anyone working at the station reports a problem. */
export async function reportIncident(c: WorkCtx, stationId: string, input: IncidentInput): Promise<Incident> {
  const actor = await stationActor(c, stationId);
  if (!input || !validRequestId(input.requestId)) throw new ApiError("bad_request");
  const done = await c.db.prepare(`${SELECT} where i.request_id = ?`).bind(input.requestId).first<IncidentRow>();
  if (done) return toIncident(done);
  const checked = checkIncident(input);
  if (!checked.ok) throw new ApiError(checked.error);
  const id = uuid();
  try {
    await c.db
      .prepare(
        `insert into station_incidents (id, request_id, station_id, kind, comment, battery_label, reported_by, role, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, input.requestId, stationId, checked.kind, checked.comment, checked.batteryLabel, actor.user.id, actor.role, nowIso())
      .run();
  } catch (err) {
    // The same request sent twice at once: the first one recorded it.
    if (!/UNIQUE/i.test(String(err))) throw err;
  }
  const row = await c.db.prepare(`${SELECT} where i.request_id = ?`).bind(input.requestId).first<IncidentRow>();
  const incident = toIncident(row!);
  if (row!.id === id) await alertIncident(c, stationId, incident);
  return incident;
}

/** GET /api/stations/:id/incidents: the open reports, then the last 30 days' handled ones (anyone with rights there). */
export async function stationIncidents(c: WorkCtx, stationId: string): Promise<Incident[]> {
  const user = await c.requireUser();
  if (!(await roleAtStation(c.db, user, stationId))) throw new ApiError("forbidden", 403);
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const { results } = await c.db
    .prepare(
      `${SELECT} where i.station_id = ?1 and (i.status = 'open' or i.created_at >= ?2)
         order by case i.status when 'open' then 0 else 1 end, i.created_at desc limit 200`,
    )
    .bind(stationId, since)
    .all<IncidentRow>();
  return results.map(toIncident);
}

/** POST /api/stations/:id/incidents/:incident/resolve: an owner or an admin marks it handled, with an optional note. */
export async function resolveIncident(c: WorkCtx, stationId: string, incidentId: string, input: { resolution?: string | null }): Promise<Incident> {
  // From the owner back office: no active station needed, only an owner's or an admin's rights there.
  const user = await c.requireUser();
  const role = await roleAtStation(c.db, user, stationId);
  if (role !== "owner" && role !== "admin") throw new ApiError("forbidden", 403);
  const resolution = cleanIncidentText(input?.resolution);
  if (resolution === undefined) throw new ApiError("bad_request");
  const row = await c.db.prepare(`${SELECT} where i.id = ? and i.station_id = ?`).bind(incidentId, stationId).first<IncidentRow>();
  if (!row) throw new ApiError("not_found", 404);
  if (row.status === "open") {
    await c.db
      .prepare("update station_incidents set status = 'resolved', resolved_by = ?, resolved_at = ?, resolution = ? where id = ? and status = 'open'")
      .bind(user.id, nowIso(), resolution, incidentId)
      .run();
  }
  const after = await c.db.prepare(`${SELECT} where i.id = ?`).bind(incidentId).first<IncidentRow>();
  return toIncident(after!);
}
