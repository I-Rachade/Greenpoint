-- Fleet managers: an admin links drivers to a manager in the backoffice (each
-- driver has at most one). The manager sees them on /flotte, hands open trips to
-- them ahead of the queue and follows their trips, takings and charging costs.
-- Linking makes the account a fleet manager; losing the last driver makes it a
-- customer again. Code: worker/fleet.ts, shared rules in src/lib/fleet.ts.
-- Safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

create table fleet_manager_drivers (
  driver_id text primary key references drivers (user_id) on delete cascade,
  manager_id text not null references users (id) on delete cascade,
  created_at text not null
);
create index fleet_manager_drivers_manager_idx on fleet_manager_drivers (manager_id);
