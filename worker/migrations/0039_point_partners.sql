-- Who owns a connected socket. The station's
-- operator only hosts it; the socket and the money of its charges belong to poinderecharge,
-- or to a point partner (partenaire propriétaire) an admin sets in the backoffice. A point
-- partner's accounts see their sockets, where they are and what they earned (/proprietaire).
--
-- No role: the accounts stay customers (users.role is not touched, so users is not rebuilt).
-- Code: worker/point-partners.ts, src/lib/point-partners.ts. Test: worker/point-partners.test.ts.
-- Only adds tables, columns and a trigger, so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

create table point_partners (
  id text primary key,
  name text not null check (length(name) between 1 and 80),
  contact_phone text check (contact_phone is null or contact_phone glob '+228[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
  -- suspended: the accounts lose the dashboard; sockets and charges stay as they are.
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at text not null
);

-- An account belongs to at most one point partner.
create table point_partner_accounts (
  user_id text primary key references users (id) on delete cascade,
  partner_id text not null references point_partners (id) on delete cascade,
  created_at text not null
);
create index point_partner_accounts_partner_idx on point_partner_accounts (partner_id);

-- Null: the socket is ours, wherever it is.
alter table devices add column partner_id text references point_partners (id);
create index devices_partner_idx on devices (partner_id) where partner_id is not null;

-- The owner when the charge started, like the tariff: moving a socket to another owner never
-- changes a running or past charge. Set by the trigger below, for every way a charge starts.
alter table charging_sessions add column partner_id text references point_partners (id);
create index charging_sessions_partner_idx on charging_sessions (partner_id, paid_at) where partner_id is not null;

create trigger charging_sessions_partner_from_device after insert on charging_sessions
begin
  update charging_sessions set partner_id = (select partner_id from devices where external_id = new.device_id) where id = new.id;
end;
