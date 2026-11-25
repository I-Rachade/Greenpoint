-- Partner API: other apps book parcel transports with an API key and receive
-- every status change by webhook. Code: worker/partners.ts, src/lib/partners.ts;
-- docs: docs/PARTNER-API.md. Numbered 0008 because 0007 is the driver role
-- (planung/fahrer.md). Only adds tables and nullable columns, so it is safe to
-- apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

-- Companies that use the API (created in the backoffice). Their parcels are billed to them.
create table partners (
  id text primary key,
  name text not null check (length(name) between 1 and 80),
  contact_email text,
  contact_phone text not null,                     -- sender of bookings that name none
  is_active integer not null default 1,
  webhook_url text,                                -- https; null = the partner polls GET /events
  webhook_secret text not null,                    -- signs webhooks (HMAC-SHA256)
  share_pickup_code integer not null default 0,    -- send the recipient's pickup code to the partner
  created_by text,
  created_at text not null,
  updated_at text not null
);

-- API keys; only the SHA-256 is stored, the key is shown once when created.
create table partner_api_keys (
  id text primary key,
  partner_id text not null references partners (id) on delete cascade,
  label text not null default '' check (length(label) <= 60),
  prefix text not null,
  key_hash text not null unique,
  created_by text,
  created_at text not null,
  last_used_at text,
  revoked_at text
);
create index partner_api_keys_partner_idx on partner_api_keys (partner_id);

-- A transport booked through the API. It becomes a parcel (same tracking number)
-- when the staff of the drop-off station take it in, measure it and check its content.
create table partner_bookings (
  id text primary key,
  partner_id text not null references partners (id),
  reference text not null check (length(reference) between 1 and 64),
  tracking_no text not null unique,
  status text not null check (status in ('booked', 'handed_in', 'cancelled', 'expired')),
  from_station_id text not null references stations (id),
  to_station_id text not null references stations (id),
  sender_phone text not null,
  sender_name text,
  recipient_phone text not null,
  recipient_name text,
  content text not null check (length(content) between 1 and 300),
  declared_value integer check (declared_value is null or declared_value >= 0),
  length_cm real not null check (length_cm > 0),
  width_cm real not null check (width_cm > 0),
  height_cm real not null check (height_cm > 0),
  weight_kg real not null check (weight_kg > 0 and weight_kg <= 50),
  size text not null check (size in ('S', 'M', 'L', 'XL')),
  price_fcfa integer not null check (price_fcfa >= 0),
  parcel_id text,
  created_at text not null,
  expires_at text not null,
  handed_in_at text,
  closed_at text,
  unique (partner_id, reference),
  check (from_station_id <> to_station_id)
);
create index partner_bookings_station_idx on partner_bookings (from_station_id, status);
create index partner_bookings_partner_idx on partner_bookings (partner_id, created_at);

alter table parcels add column partner_id text;
alter table parcels add column partner_booking_id text;
create index parcels_partner_idx on parcels (partner_id, created_at);

-- Every status change a partner is told about, with its webhook delivery state.
-- Parcel changes are copied from parcel_events, so whatever writes a parcel
-- status there (depot, drivers, daily job) reaches the partner too.
create table partner_events (
  id text primary key,                             -- "evt_…"
  partner_id text not null references partners (id) on delete cascade,
  booking_id text not null,
  type text not null,                              -- "booking.created", "parcel.arrived" …
  source_key text not null unique,                 -- what it was made from, so it is queued once
  payload text not null,                           -- the JSON body sent
  created_at text not null,
  attempts integer not null default 0,
  next_attempt_at text,                            -- null: delivered, given up, or no webhook
  delivered_at text,
  last_status integer,
  last_error text
);
create index partner_events_partner_idx on partner_events (partner_id, created_at);
create index partner_events_booking_idx on partner_events (booking_id, created_at);
create index partner_events_due_idx on partner_events (next_attempt_at) where next_attempt_at is not null;

-- Small settings of the partner API: how far parcel_events have been copied.
create table partner_state (
  key text primary key,
  value text not null
);
insert into partner_state (key, value) values ('parcel_events_cursor', (select coalesce(max(id), 0) from parcel_events));
