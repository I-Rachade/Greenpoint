-- Individual charging points (outlets) per station.
-- Phase 1 still counts free slots in station_status; this table lets phase 2
-- attach connected sockets (e.g. LoRa dual-outlet chargers) without a rebuild.
-- See /docs/ARCHITEKTUR.md.

create type public.charging_point_status as enum ('free', 'reserved', 'charging', 'done', 'fault');

create table public.charging_points (
  id uuid primary key default gen_random_uuid(),
  station_id uuid not null references public.stations (id) on delete cascade,
  label text not null,                       -- e.g. "A1", printed next to the QR code
  status public.charging_point_status not null default 'free',
  device_id text,                            -- hardware id (DevEUI / vendor id), null = manual station
  power_watts integer,                       -- last reported power draw
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  unique (station_id, label)
);

alter table public.reservations
  add column charging_point_id uuid references public.charging_points (id) on delete set null;

alter table public.charging_points enable row level security;

create policy "charging points public" on public.charging_points for select using (true);
create policy "staff update charging points" on public.charging_points
  for update using (public.is_staff_of(station_id)) with check (public.is_staff_of(station_id));
create policy "admins manage charging points" on public.charging_points
  for all using (public.is_admin()) with check (public.is_admin());

alter publication supabase_realtime add table public.charging_points;
