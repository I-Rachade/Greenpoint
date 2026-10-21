import { describe, expect, it } from "vitest";
import { buildAlerts } from "../alerts";
import { en } from "../i18n/en";
import type { Reservation } from "../types";

const now = new Date("2026-10-13T12:00:00Z");
const names = new Map([["s1", "Bè"]]);

function reservation(patch: Partial<Reservation>): Reservation {
  return {
    id: "r1",
    userId: "u1",
    stationId: "s1",
    type: "battery",
    status: "active",
    createdAt: "2026-10-13T11:50:00Z",
    expiresAt: "2026-10-13T12:10:00Z",
    pickupCode: "4827",
    ...patch,
  };
}

describe("buildAlerts", () => {
  it("shows an active reservation with its code and time left", () => {
    const [alert] = buildAlerts({ reservations: [reservation({})], parcels: [], stationNames: names, promotion: null }, en, now);
    expect(alert.title).toBe("Active reservation at Bè");
    expect(alert.text).toBe("Pickup code 4827, 10 min left.");
    expect(alert.id).toBe("res:r1:active");
  });

  it("treats an active reservation past its expiry as expired", () => {
    const [alert] = buildAlerts(
      { reservations: [reservation({ expiresAt: "2026-10-13T11:59:00Z" })], parcels: [], stationNames: names, promotion: null },
      en,
      now,
    );
    expect(alert.id).toBe("res:r1:expired");
    expect(alert.title).toBe("Reservation expired at Bè");
  });

  it("drops entries older than 30 days and sorts newest first", () => {
    const alerts = buildAlerts(
      {
        reservations: [
          reservation({ id: "old", status: "completed", createdAt: "2026-08-01T10:00:00Z" }),
          reservation({ id: "a", status: "completed", createdAt: "2026-10-12T10:00:00Z" }),
          reservation({ id: "b", status: "cancelled", createdAt: "2026-10-13T09:00:00Z", cancelReason: "station_closed" }),
        ],
        parcels: [],
        stationNames: names,
        promotion: null,
      },
      en,
      now,
    );
    expect(alerts.map((a) => a.id)).toEqual(["res:b:cancelled", "res:a:completed"]);
    expect(alerts[0].text).toBe(en.reservations.cancelReasons.station_closed);
  });
});
