-- Greenpoint: initial schema (phase 1).
-- Run in the Supabase SQL editor or with `supabase db push`.

create type public.user_role as enum ('rider', 'operator', 'fleet_manager', 'admin');
create type public.station_kind as enum ('charging', 'swap', 'both');
create type public.vehicle_type as enum ('scooter', 'tuktuk', 'ebike', 'moped');
create type public.reservation_type as enum ('battery', 'slot');
create type public.reservation_status as enum ('active', 'completed', 'cancelled', 'expired');

-- One profile per authenticated user (created automatically on sign-up).
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  phone text not null default '',
  full_name text,
  role public.user_role not null default 'rider',
  created_at timestamptz not null default now()
);

-- Companies that run stations: Greenpoint itself and third-party operators.
create table public.operators (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  is_own boolean not null default false,
  contact_phone text,
  created_at timestamptz not null default now()
);

create table public.stations (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid not null references public.operators (id),
  name text not null,
  address text not null default '',
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  kind public.station_kind not null,
  vehicle_types public.vehicle_type[] not null default '{scooter}',
  charging_slots integer not null default 0 check (charging_slots >= 0),
  battery_capacity integer not null default 0 check (battery_capacity >= 0),
  opening_hours text not null default '',
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Live status, reported by station staff. Exactly one row per station.
create table public.station_status (
  station_id uuid primary key references public.stations (id) on delete cascade,
  is_open boolean not null default true,
  free_slots integer not null default 0 check (free_slots >= 0),
  full_batteries integer not null default 0 check (full_batteries >= 0),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id)
);

-- Which users may report status for which station.
create table public.station_staff (
  station_id uuid not null references public.stations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  primary key (station_id, user_id)
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  station_id uuid not null references public.stations (id) on delete cascade,
  type public.reservation_type not null,
  status public.reservation_status not null default 'active',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '20 minutes'
);

create index reservations_station_active_idx on public.reservations (station_id) where status = 'active';
create index reservations_user_idx on public.reservations (user_id, created_at desc);

-- Helpers ------------------------------------------------------------------

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

create function public.is_staff_of(p_station uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or exists (select 1 from station_staff where station_id = p_station and user_id = auth.uid());
$$;

-- New auth user -> profile row.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, phone) values (new.id, coalesce(new.phone, ''));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Only admins may change roles (users may edit their own name).
create function public.guard_profile_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role and not public.is_admin() then
    raise exception 'role_change_forbidden';
  end if;
  return new;
end;
$$;

create trigger on_profile_update
  before update on public.profiles
  for each row execute function public.guard_profile_role();

-- New station -> empty status row.
create function public.handle_new_station() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into station_status (station_id, free_slots, full_batteries)
  values (new.id, new.charging_slots, new.battery_capacity);
  return new;
end;
$$;

create trigger on_station_created
  after insert on public.stations
  for each row execute function public.handle_new_station();

-- Stamp status changes with time and author.
create function public.touch_station_status() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger on_station_status_update
  before update on public.station_status
  for each row execute function public.touch_station_status();

-- Reserve a battery or slot, refusing when nothing is left.
-- Locks the status row so two riders cannot take the last battery at once.
create function public.reserve(p_station uuid, p_type public.reservation_type)
returns public.reservations
language plpgsql security definer set search_path = public as $$
declare
  st station_status;
  k station_kind;
  held integer;
  result reservations;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  if exists (
    select 1 from reservations
    where user_id = auth.uid() and status = 'active' and expires_at > now()
  ) then
    raise exception 'already_reserved';
  end if;

  select * into st from station_status where station_id = p_station for update;
  select kind into k from stations where id = p_station and is_active;
  if st is null or k is null then
    raise exception 'station_not_found';
  end if;
  if not st.is_open then
    raise exception 'station_closed';
  end if;
  if (p_type = 'slot' and k = 'swap') or (p_type = 'battery' and k = 'charging') then
    raise exception 'service_not_offered';
  end if;

  select count(*) into held from reservations
  where station_id = p_station and type = p_type and status = 'active' and expires_at > now();

  if (p_type = 'slot' and st.free_slots - held <= 0)
     or (p_type = 'battery' and st.full_batteries - held <= 0) then
    raise exception 'none_available';
  end if;

  insert into reservations (user_id, station_id, type)
  values (auth.uid(), p_station, p_type)
  returning * into result;
  return result;
end;
$$;

-- Row level security -------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.operators enable row level security;
alter table public.stations enable row level security;
alter table public.station_status enable row level security;
alter table public.station_staff enable row level security;
alter table public.reservations enable row level security;

create policy "own profile readable" on public.profiles
  for select using (id = auth.uid() or public.is_admin());
create policy "own profile editable" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
create policy "admins manage profiles" on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());

create policy "operators public" on public.operators for select using (true);
create policy "admins manage operators" on public.operators
  for all using (public.is_admin()) with check (public.is_admin());

create policy "active stations public" on public.stations
  for select using (is_active or public.is_admin());
create policy "admins manage stations" on public.stations
  for all using (public.is_admin()) with check (public.is_admin());

create policy "status public" on public.station_status for select using (true);
create policy "staff update status" on public.station_status
  for update using (public.is_staff_of(station_id)) with check (public.is_staff_of(station_id));

create policy "staff see own assignments" on public.station_staff
  for select using (user_id = auth.uid() or public.is_admin());
create policy "admins manage staff" on public.station_staff
  for all using (public.is_admin()) with check (public.is_admin());

-- Riders see their own reservations; staff see their station's.
-- Inserts go through reserve(); riders may only cancel.
create policy "reservations visible" on public.reservations
  for select using (user_id = auth.uid() or public.is_staff_of(station_id));
create policy "rider cancels own" on public.reservations
  for update using (user_id = auth.uid() and status = 'active')
  with check (user_id = auth.uid() and status = 'cancelled');
create policy "staff completes" on public.reservations
  for update using (public.is_staff_of(station_id))
  with check (public.is_staff_of(station_id));

-- Riders need capacity held at every station, without seeing who holds it.
create view public.station_holds
with (security_invoker = false) as
  select station_id,
         count(*) filter (where type = 'slot')::int as reserved_slots,
         count(*) filter (where type = 'battery')::int as reserved_batteries
  from public.reservations
  where status = 'active' and expires_at > now()
  group by station_id;

grant select on public.station_holds to anon, authenticated;
grant execute on function public.reserve(uuid, public.reservation_type) to authenticated;

-- Realtime: push status and reservation changes to connected apps.
alter publication supabase_realtime add table public.station_status, public.reservations;
