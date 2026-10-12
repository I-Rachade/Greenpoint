-- Connected sockets (e.g. LoRa dual-outlet e-scooter chargers).
-- A device is one physical socket box with one or more outlets; each outlet is
-- a row in charging_points (see 20261012000100). Devices report through the
-- Supabase Edge Function device-events, which calls ingest_device_event() with
-- the service role key. See docs/steckdosen-lora.md.

create type public.device_link as enum ('lorawan', 'vendor_cloud', 'own_server');

create table public.devices (
  external_id text primary key,              -- DevEUI (LoRaWAN) or the vendor's device id
  station_id uuid not null references public.stations (id) on delete cascade,
  vendor text not null default '',
  model text not null default '',
  link public.device_link not null default 'lorawan',
  outlets smallint not null default 2 check (outlets between 1 and 16),
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create index devices_station_idx on public.devices (station_id);

-- Ids are stored upper case, like the webhook sends them (ChirpStack shows
-- DevEUIs in lower case, so a copied id would otherwise never match).
create function public.normalize_device_id() returns trigger
language plpgsql as $$
begin
  new.external_id := upper(btrim(new.external_id));
  return new;
end;
$$;

create trigger on_device_write
  before insert or update of external_id on public.devices
  for each row execute function public.normalize_device_id();

-- Which outlet of the device a charging point is, and what it has delivered.
alter table public.charging_points
  add column outlet smallint check (outlet >= 1),
  add column energy_wh integer check (energy_wh >= 0),
  add constraint charging_points_device_fk
    foreign key (device_id) references public.devices (external_id)
    on update cascade on delete set null,
  add constraint charging_points_device_outlet_key unique (device_id, outlet);

-- Raw messages, kept for troubleshooting. Admins only.
create table public.device_messages (
  id bigint generated always as identity primary key,
  external_id text not null,
  received_at timestamptz not null default now(),
  payload jsonb not null
);

create index device_messages_device_idx on public.device_messages (external_id, received_at desc);

-- Free connected points that reported within the last 15 minutes (same rule as
-- the app's DEVICE_OFFLINE_MINUTES), so a silent socket is never offered.
create function public.live_free_points(p_station uuid) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from charging_points
  where station_id = p_station and device_id is not null and status = 'free'
    and last_seen_at > now() - interval '15 minutes';
$$;

-- New device -> one charging point per outlet, labelled "<last 4 of id>-<outlet>"
-- (rename in the dashboard to match the sticker next to the QR code).
create function public.handle_new_device() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into charging_points (station_id, label, device_id, outlet, status)
  select new.station_id, upper(right(new.external_id, 4)) || '-' || n, new.external_id, n, 'free'
  from generate_series(1, new.outlets) as n
  on conflict do nothing;
  -- Nothing is offered until the device reports.
  update station_status set free_slots = live_free_points(new.station_id)
  where station_id = new.station_id;
  return new;
end;
$$;

create trigger on_device_created
  after insert on public.devices
  for each row execute function public.handle_new_device();

-- Apply one normalized message from a device.
-- p_outlets: [{"outlet": 1, "status": "charging", "power_watts": 180, "energy_wh": 420}, ...]
-- Statuses: free, charging, done, fault. A reserved point stays reserved while
-- its device reports it free, so the rider's hold is not lost.
-- Afterwards the station's free_slots is recounted from its connected points, so
-- reserve() and the map keep working unchanged.
create function public.ingest_device_event(p_external_id text, p_outlets jsonb, p_payload jsonb)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  dev devices;
  pt charging_points;
  item jsonb;
  updated integer := 0;
begin
  insert into device_messages (external_id, payload) values (upper(p_external_id), coalesce(p_payload, '{}'));

  update devices set last_seen_at = now() where external_id = upper(p_external_id) returning * into dev;
  if dev is null then
    raise exception 'unknown_device';
  end if;

  for item in select * from jsonb_array_elements(coalesce(p_outlets, '[]')) loop
    select * into pt from charging_points
    where device_id = dev.external_id and outlet = (item->>'outlet')::smallint
    for update;
    continue when pt is null;

    update charging_points cp set
      status = case
        when cp.status = 'reserved' and item->>'status' = 'free' then cp.status
        else coalesce((item->>'status')::charging_point_status, cp.status)
      end,
      power_watts = coalesce((item->>'power_watts')::integer, cp.power_watts),
      energy_wh = coalesce((item->>'energy_wh')::integer, cp.energy_wh)
    where cp.id = pt.id;
    updated := updated + 1;

    -- A rider plugged in: their slot reservation is used up, otherwise it would
    -- keep holding a second outlet until it expires. The oldest one is taken,
    -- since the socket cannot tell who plugged in.
    if item->>'status' = 'charging' and pt.status <> 'charging' then
      update reservations set status = 'completed', charging_point_id = pt.id
      where id = (
        select id from reservations
        where station_id = dev.station_id and type = 'slot'
          and status = 'active' and expires_at > now()
        order by created_at
        limit 1
        for update skip locked
      );
    end if;
  end loop;

  -- A message without outlet data is a heartbeat: the device is alive.
  update charging_points set last_seen_at = now() where device_id = dev.external_id;

  update station_status set free_slots = live_free_points(dev.station_id)
  where station_id = dev.station_id;

  return updated;
end;
$$;

revoke execute on function public.ingest_device_event(text, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.ingest_device_event(text, jsonb, jsonb) to service_role;

-- reserve() checks station_status.free_slots, which is only recounted when a
-- device reports. At stations with connected sockets, check the live count too,
-- so a socket that went silent cannot be reserved. reserve() already holds the
-- station_status lock here.
create function public.check_connected_slot() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  held integer;
begin
  if new.type <> 'slot' or not exists (
    select 1 from charging_points where station_id = new.station_id and device_id is not null
  ) then
    return new;
  end if;

  select count(*) into held from reservations
  where station_id = new.station_id and type = 'slot' and status = 'active' and expires_at > now();

  if live_free_points(new.station_id) - held <= 0 then
    raise exception 'none_available';
  end if;
  return new;
end;
$$;

create trigger on_slot_reserved
  before insert on public.reservations
  for each row execute function public.check_connected_slot();

alter table public.devices enable row level security;
alter table public.device_messages enable row level security;

create policy "admins manage devices" on public.devices
  for all using (public.is_admin()) with check (public.is_admin());
create policy "staff see station devices" on public.devices
  for select using (public.is_staff_of(station_id));
create policy "admins read device messages" on public.device_messages
  for select using (public.is_admin());
