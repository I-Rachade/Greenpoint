-- Fixes from the security and logic review of 12.10.2026
-- (/mnt/project-files/pruefung/schwachstellen-2026-10-12.md, H1, H2, M1, M8, L1-L6, L9, L13).
-- Run after the earlier migrations, in file name order.

-- H1: the first admin is set in the SQL editor or Table Editor, where there is no
-- logged-in user. Only block role changes that come in through the public API.
create or replace function public.guard_profile_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role is distinct from old.role
     and coalesce(auth.role(), '') in ('anon', 'authenticated')
     and not public.is_admin() then
    raise exception 'role_change_forbidden';
  end if;
  return new;
end;
$$;

-- L13: auth.users stores the phone without "+"; the app works with +228….
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, phone)
  values (
    new.id,
    case
      when coalesce(new.phone, '') = '' then ''
      when new.phone like '+%' then new.phone
      else '+' || new.phone
    end
  );
  return new;
end;
$$;

-- H2: only Togolese numbers may sign up. The browser checks this too, but a
-- direct API call skips the browser. Raising here stops the sign-up before
-- Supabase sends the SMS.
create function public.check_auth_phone() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.phone, '') <> '' and new.phone !~ '^\+?228[0-9]{8}$' then
    raise exception 'phone_not_allowed';
  end if;
  if coalesce(new.phone_change, '') <> '' and new.phone_change !~ '^\+?228[0-9]{8}$' then
    raise exception 'phone_not_allowed';
  end if;
  return new;
end;
$$;

create trigger on_auth_user_phone
  before insert or update of phone, phone_change on auth.users
  for each row execute function public.check_auth_phone();

-- M8 / L9: a 4-digit pickup code per reservation. Only the rider can read it;
-- staff type it in to complete the reservation, so they cannot complete one
-- (and later earn greenpoint points for it) without the rider being there.
create table public.reservation_codes (
  reservation_id uuid primary key references public.reservations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  code text not null check (code ~ '^[0-9]{4}$')
);

alter table public.reservation_codes enable row level security;
create policy "rider reads own codes" on public.reservation_codes
  for select using (user_id = auth.uid());

-- L5: why a reservation was cancelled when the rider did not do it.
alter table public.reservations add column cancel_reason text;

-- M1: at most one active reservation per rider, also under parallel requests.
-- Old active rows past their expiry would trip the index, so close them first.
update public.reservations set status = 'expired' where status = 'active' and expires_at <= now();
create unique index reservations_one_active_per_user on public.reservations (user_id) where status = 'active';

-- L2: opening hours in the form "07:00-21:00" (Lomé time, UTC) are enforced.
-- Ranges past midnight ("18:00-02:00") work; any other text is not checked,
-- the staff's open/closed switch still decides then.
create function public.within_opening_hours(p_hours text, p_at timestamptz default now())
returns boolean
language plpgsql stable as $$
declare
  m text[];
  t time;
  o time;
  c time;
begin
  m := regexp_match(coalesce(p_hours, ''), '^\s*(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})\s*$');
  if m is null then
    return true;
  end if;
  o := (m[1] || ':' || m[2])::time;
  c := (m[3] || ':' || m[4])::time;
  t := (p_at at time zone 'Africa/Lome')::time;
  if o = c then
    return true;
  elsif o < c then
    return t >= o and t < c;
  end if;
  return t >= o or t < c;
end;
$$;

-- Reserve a battery or slot, refusing when nothing is left.
-- Locks the status row so two riders cannot take the last battery at once, and
-- takes a per-rider lock so one rider's parallel requests run one after another (M1).
-- L4: no more than 3 unused (cancelled or expired) reservations in 24 hours, and
-- one hour's pause at a station after an unused reservation there.
create or replace function public.reserve(p_station uuid, p_type public.reservation_type)
returns public.reservations
language plpgsql security definer set search_path = public as $$
declare
  st station_status;
  s stations;
  held integer;
  result reservations;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;

  perform pg_advisory_xact_lock(hashtext('reserve:' || auth.uid()::text));

  update reservations set status = 'expired'
  where user_id = auth.uid() and status = 'active' and expires_at <= now();

  if exists (select 1 from reservations where user_id = auth.uid() and status = 'active') then
    raise exception 'already_reserved';
  end if;

  if (
    select count(*) from reservations
    where user_id = auth.uid()
      and status in ('cancelled', 'expired')
      and cancel_reason is null
      and created_at > now() - interval '24 hours'
  ) >= 3 then
    raise exception 'daily_limit';
  end if;

  if exists (
    select 1 from reservations
    where user_id = auth.uid()
      and station_id = p_station
      and status in ('cancelled', 'expired')
      and cancel_reason is null
      and created_at > now() - interval '1 hour'
  ) then
    raise exception 'cooldown';
  end if;

  select * into st from station_status where station_id = p_station for update;
  if not found then
    raise exception 'station_not_found';
  end if;
  select * into s from stations where id = p_station and is_active;
  if not found then
    raise exception 'station_not_found';
  end if;
  if not st.is_open or not public.within_opening_hours(s.opening_hours) then
    raise exception 'station_closed';
  end if;
  if (p_type = 'slot' and s.kind = 'swap') or (p_type = 'battery' and s.kind = 'charging') then
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

  insert into reservation_codes (reservation_id, user_id, code)
  values (result.id, auth.uid(), lpad(floor(random() * 10000)::int::text, 4, '0'));

  return result;
end;
$$;

-- L1 / L9: staff complete a reservation with the rider's pickup code. The
-- battery or slot the rider took is subtracted from the counter in the same
-- step, so the map does not show it as free again. Staff cannot complete their
-- own reservations.
create function public.complete_reservation(p_reservation uuid, p_code text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r reservations;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated';
  end if;
  select * into r from reservations where id = p_reservation for update;
  if not found or not public.is_staff_of(r.station_id) then
    raise exception 'forbidden';
  end if;
  if r.user_id = auth.uid() then
    raise exception 'own_reservation';
  end if;
  if r.status <> 'active' or r.expires_at <= now() then
    raise exception 'reservation_not_active';
  end if;
  if not exists (
    select 1 from reservation_codes where reservation_id = r.id and code = trim(coalesce(p_code, ''))
  ) then
    raise exception 'wrong_pickup_code';
  end if;

  update reservations set status = 'completed' where id = r.id;
  update station_status
  set full_batteries = case when r.type = 'battery' then greatest(full_batteries - 1, 0) else full_batteries end,
      free_slots = case when r.type = 'slot' then greatest(free_slots - 1, 0) else free_slots end
  where station_id = r.station_id;
end;
$$;

grant execute on function public.complete_reservation(uuid, text) to authenticated;

-- Staff no longer update reservations directly; complete_reservation() does it.
drop policy "staff completes" on public.reservations;

-- L5: closing a station cancels its active reservations, so riders do not
-- ride there for nothing. The app shows the reason.
create function public.cancel_on_station_close() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.is_open and not new.is_open then
    update reservations set status = 'cancelled', cancel_reason = 'station_closed'
    where station_id = new.station_id and status = 'active';
  end if;
  return new;
end;
$$;

create trigger on_station_closed
  after update of is_open on public.station_status
  for each row execute function public.cancel_on_station_close();

-- L6: assigning someone to a station is all it takes to make them staff.
-- The role follows the assignment, so it is no longer kept up by hand.
create function public.sync_staff_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update profiles set role = 'operator' where id = new.user_id and role = 'rider';
    return new;
  end if;
  if not exists (select 1 from station_staff where user_id = old.user_id) then
    update profiles set role = 'rider' where id = old.user_id and role = 'operator';
  end if;
  return old;
end;
$$;

create trigger on_station_staff_change
  after insert or delete on public.station_staff
  for each row execute function public.sync_staff_role();
