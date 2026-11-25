-- Live trip to a reserved station (UI batch 4: customer screen "En route", staff screen
-- "Clients en route"). With the customer's consent, the app sends their position while the
-- reservation holds; the station sees it with the customer's phone number. The station marks
-- the battery ready, or asks the customer to go to another station when its stock ran out.
-- reservations.share_lat/share_lng/share_at: last shared position (null = not shared). It is
--   cleared when the customer stops sharing and by the minute cron once the reservation ends.
-- reservations.ready_at, redirected_at: when the station marked it ready or redirected it.
-- Code: worker/api.ts (shareReservationPosition, markReservationReady, redirectReservation),
-- worker/reservations.ts (toReservation), src/components/en-route.tsx,
-- src/components/station-work/reservations-page.tsx. Test: worker/reservation-live.test.ts.
-- Only adds nullable columns, so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

alter table reservations add column share_lat real;
alter table reservations add column share_lng real;
alter table reservations add column share_at text;
alter table reservations add column ready_at text;
alter table reservations add column redirected_at text;
