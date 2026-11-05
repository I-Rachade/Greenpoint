-- poinderecharge on Cloudflare D1 (SQLite). Replaces the Supabase schema.
-- Rules that Postgres enforced with row level security and triggers now live
-- in the Worker (worker/api.ts); the database keeps the constraints.
-- Times are ISO 8601 strings in UTC ("2026-10-12T09:00:00.000Z"), so they sort as text.
-- Apply: npx wrangler d1 migrations apply DB --remote

create table users (
  id text primary key,
  phone text not null unique check (phone glob '+228[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
  full_name text,
  role text not null default 'rider' check (role in ('rider', 'operator', 'fleet_manager', 'admin')),
  created_at text not null,
  last_sign_in_at text
);

-- Login: one row per session; only the SHA-256 of the token is stored.
create table sessions (
  token_hash text primary key,
  user_id text not null references users (id) on delete cascade,
  created_at text not null,
  expires_at text not null
);
create index sessions_user_idx on sessions (user_id);

-- SMS codes: only a hash is stored; a few attempts, then the code is dead.
create table otp_codes (
  id integer primary key autoincrement,
  phone text not null,
  code_hash text not null,
  created_at text not null,
  expires_at text not null,
  attempts integer not null default 0,
  used integer not null default 0
);
create index otp_codes_phone_idx on otp_codes (phone, created_at);
create index otp_codes_created_idx on otp_codes (created_at);

create table operators (
  id text primary key,
  name text not null,
  is_own integer not null default 0,
  contact_phone text,
  created_at text not null
);

create table stations (
  id text primary key,
  operator_id text not null references operators (id),
  name text not null,
  address text not null default '',
  lat real not null check (lat between -90 and 90),
  lng real not null check (lng between -180 and 180),
  kind text not null check (kind in ('charging', 'swap', 'both')),
  vehicle_types text not null default '["scooter"]',   -- JSON array
  charging_slots integer not null default 0 check (charging_slots >= 0),
  battery_capacity integer not null default 0 check (battery_capacity >= 0),
  opening_hours text not null default '',
  phone text,
  is_active integer not null default 1,
  created_at text not null
);

create table station_status (
  station_id text primary key references stations (id) on delete cascade,
  is_open integer not null default 1,
  free_slots integer not null default 0 check (free_slots >= 0),
  full_batteries integer not null default 0 check (full_batteries >= 0),
  updated_at text not null,
  updated_by text
);

create table station_staff (
  station_id text not null references stations (id) on delete cascade,
  user_id text not null references users (id) on delete cascade,
  primary key (station_id, user_id)
);

create table charging_points (
  id text primary key,
  station_id text not null references stations (id) on delete cascade,
  label text not null,
  status text not null default 'free' check (status in ('free', 'reserved', 'charging', 'done', 'fault')),
  device_id text,
  power_watts integer,
  last_seen_at text,
  created_at text not null,
  unique (station_id, label)
);

create table reservations (
  id text primary key,
  user_id text not null references users (id) on delete cascade,
  station_id text not null references stations (id) on delete cascade,
  type text not null check (type in ('battery', 'slot')),
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled', 'expired')),
  created_at text not null,
  expires_at text not null,
  cancel_reason text,
  pickup_code text not null check (length(pickup_code) = 4),
  charging_point_id text references charging_points (id) on delete set null
);
create index reservations_station_active_idx on reservations (station_id) where status = 'active';
create index reservations_user_idx on reservations (user_id, created_at);
create index reservations_created_idx on reservations (created_at);
-- At most one active reservation per rider, also under parallel requests.
create unique index reservations_one_active_per_user on reservations (user_id) where status = 'active';

create table audit_log (
  id integer primary key autoincrement,
  at text not null,
  actor text,
  table_name text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  row_id text not null,
  station_id text,
  user_id text,
  changes text not null default '{}'    -- JSON
);
create index audit_log_actor_idx on audit_log (actor, id);
create index audit_log_station_idx on audit_log (station_id, id);
create index audit_log_table_idx on audit_log (table_name, id);

create table promotions (
  id text primary key,
  title text not null check (length(title) between 1 and 120),
  body text not null default '' check (length(body) <= 1000),
  image_url text,
  link_url text,
  link_label text,
  is_active integer not null default 0,
  starts_at text,
  ends_at text,
  created_at text not null,
  updated_at text not null
);

-- The company itself, so the first station can be created right away.
insert into operators (id, name, is_own, created_at)
values ('00000000-0000-4000-8000-000000000001', 'poinderecharge', 1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
