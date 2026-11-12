-- Station staff by invitation (worker/api.ts): an owner no longer makes someone staff directly.
-- The invite is stored for the phone number or e-mail address the owner typed, whether or not an
-- account has it (so the owner cannot tell), and shows to whoever signs in with that contact.
-- Only accepting makes the person staff. Like fleet_invites (0032) and merchant_invites (0035).
-- Only adds a table, so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote
create table staff_invites (
  id text primary key,
  station_id text not null references stations (id) on delete cascade,
  -- Normalised as lib/contact.ts: "+228…" or a lower-case e-mail address.
  contact text not null,
  invited_by text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked', 'expired')),
  created_at text not null,
  expires_at text not null,
  decided_at text,
  -- Who accepted or declined.
  user_id text
);
create index staff_invites_station_idx on staff_invites (station_id, status);
create index staff_invites_contact_idx on staff_invites (contact, status);
create unique index staff_invites_one_pending on staff_invites (station_id, contact) where status = 'pending';
