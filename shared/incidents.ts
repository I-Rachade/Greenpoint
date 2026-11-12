// Problems an agent reports at a station (Omnivoltaic agent training: "signaler toute panne de
// chargeur, coupure électrique, anomalie batterie ou erreur de paiement"). The station's owners
// and the admins are told at once; an owner or admin marks it handled. Migration 0066.
import type { StationRole } from "./station-work";

export const INCIDENT_KINDS = ["charger", "power", "battery", "payment", "other"] as const;
export type IncidentKind = (typeof INCIDENT_KINDS)[number];

export const INCIDENT_STATUSES = ["open", "resolved"] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const INCIDENT_TEXT_MAX = 500;
export const INCIDENT_BATTERY_MAX = 60;

export interface IncidentInput {
  /** One id per report: sending it twice records it once. */
  requestId: string;
  kind: IncidentKind;
  /** What happened; needed for "other". */
  comment?: string | null;
  /** The battery concerned, as typed or scanned. */
  batteryLabel?: string | null;
}

export interface Incident {
  id: string;
  stationId: string;
  kind: IncidentKind;
  comment: string | null;
  batteryLabel: string | null;
  /** Who reported it, and as what. */
  person: string;
  role: StationRole;
  createdAt: string;
  status: IncidentStatus;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolution: string | null;
}

export function isIncidentKind(value: unknown): value is IncidentKind {
  return typeof value === "string" && (INCIDENT_KINDS as readonly string[]).includes(value);
}

/** Trimmed text within `max`, null when empty, undefined when too long or not text. */
export function cleanIncidentText(value: unknown, max = INCIDENT_TEXT_MAX): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return undefined;
  const text = value.trim().replace(/\s+/g, " ");
  if (!text) return null;
  return text.length <= max ? text : undefined;
}

export type IncidentError = "incident_kind_required" | "incident_comment_required" | "incident_too_long";

/** A report as the server keeps it, or why it is refused. */
export function checkIncident(
  input: Partial<IncidentInput> | null | undefined,
): { ok: true; kind: IncidentKind; comment: string | null; batteryLabel: string | null } | { ok: false; error: IncidentError } {
  if (!input || !isIncidentKind(input.kind)) return { ok: false, error: "incident_kind_required" };
  const comment = cleanIncidentText(input.comment);
  const battery = cleanIncidentText(input.batteryLabel, INCIDENT_BATTERY_MAX);
  if (comment === undefined || battery === undefined) return { ok: false, error: "incident_too_long" };
  if (input.kind === "other" && !comment) return { ok: false, error: "incident_comment_required" };
  return { ok: true, kind: input.kind, comment, batteryLabel: battery ? battery.toUpperCase() : null };
}
