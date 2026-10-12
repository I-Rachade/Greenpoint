-- Backoffice: activity log (audit trail) and admin helpers.
-- Every change to roles, stations, status, staff assignments, reservations and
-- charging points is recorded with who made it and when. Only admins can read
-- the log; nobody can write or edit it directly (only the trigger below).
-- See docs/BACKOFFICE.md.

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,                                -- auth.uid(); null = system (device webhook, SQL editor, cron)
  table_name text not null,
  action text not null check (action in ('insert', 'update', 'delete')),
  row_id text not null,
  station_id uuid,                           -- station concerned, for filtering
  user_id uuid,                              -- user concerned (profile, reservation owner, staff member)
  changes jsonb not null default '{}'        -- update: {column: [old, new]}; insert/delete: the row
);

create index audit_log_at_idx on public.audit_log (at desc);
create index audit_log_actor_idx on public.audit_log (actor, at desc);
create index audit_log_station_idx on public.audit_log (station_id, at desc);
create index audit_log_user_idx on public.audit_log (user_id, at desc);

-- Columns that change on their own (device heartbeats, timestamps) are left out,
-- so a heartbeat that changes nothing else writes no log row.
create function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  ignored constant text[] := array['updated_at', 'updated_by', 'last_seen_at', 'power_watts', 'energy_wh', 'created_at'];
  old_j jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  new_j jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  row_j jsonb := coalesce(new_j, old_j);
  diff jsonb := '{}';
  k text;
begin
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(new_j) loop
      if not (k = any (ignored)) and new_j -> k is distinct from old_j -> k then
        diff := diff || jsonb_build_object(k, jsonb_build_array(old_j -> k, new_j -> k));
      end if;
    end loop;
    if diff = '{}' then
      return null;
    end if;
  else
    diff := row_j - ignored;
  end if;

  insert into audit_log (actor, table_name, action, row_id, station_id, user_id, changes)
  values (
    auth.uid(),
    tg_table_name,
    lower(tg_op),
    coalesce(row_j ->> 'id', concat_ws(':', row_j ->> 'station_id', row_j ->> 'user_id')),
    case when tg_table_name = 'stations' then (row_j ->> 'id')::uuid else (row_j ->> 'station_id')::uuid end,
    case when tg_table_name = 'profiles' then (row_j ->> 'id')::uuid else (row_j ->> 'user_id')::uuid end,
    diff
  );
  return null;
end;
$$;

create trigger audit_profiles after insert or update or delete on public.profiles
  for each row execute function public.audit_row();
create trigger audit_operators after insert or update or delete on public.operators
  for each row execute function public.audit_row();
create trigger audit_stations after insert or update or delete on public.stations
  for each row execute function public.audit_row();
create trigger audit_station_status after update on public.station_status
  for each row execute function public.audit_row();
create trigger audit_station_staff after insert or delete on public.station_staff
  for each row execute function public.audit_row();
create trigger audit_reservations after insert or update or delete on public.reservations
  for each row execute function public.audit_row();
create trigger audit_charging_points after insert or update or delete on public.charging_points
  for each row execute function public.audit_row();

alter table public.audit_log enable row level security;

create policy "admins read audit log" on public.audit_log
  for select using (public.is_admin());

revoke insert, update, delete, truncate on public.audit_log from anon, authenticated;

-- Users with their last login (auth.users is not reachable through the API).
create function public.admin_list_users()
returns table (
  id uuid,
  phone text,
  full_name text,
  role public.user_role,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select p.id, p.phone, p.full_name, p.role, p.created_at, u.last_sign_in_at
    from profiles p
    left join auth.users u on u.id = p.id
    order by p.created_at desc;
end;
$$;

revoke execute on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;
