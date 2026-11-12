-- Battery register: every swap battery by its number, per brand, with its own history.
-- A battery is registered in advance by an admin (one or a pasted list), or added the
-- first time a swap names a number nobody registered yet (source = 'swap').
-- A number is unique within a brand; brand '' = not known yet (a swap at a station that
-- lists no battery types). Such a battery takes the brand of the first swap or register
-- entry that names its type.
-- Where it is now: at a station (brought back), with a customer (handed out; holder = the
-- account, empty for a cash customer), or unknown (registered, never swapped).
-- battery_history: registered, added_at_swap, out (handed out), in (brought back), status
-- (an admin sets in service / repair / lost / retired, with an optional reason). Every row
-- logs station, person and role, and the swap (swap_log.id) it belongs to.
-- swap_log.battery_in_id / battery_out_id (0028) now point here.
-- Backfill: the swaps already logged with a number create their batteries and history.
-- Code: worker/batteries.ts, worker/station-work.ts, src/lib/batteries.ts.
-- Only adds tables and rows, so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

create table batteries (
  id text primary key,
  serial text not null check (length(serial) between 1 and 60),   -- as cleanBatteryLabel() writes it (upper case)
  brand text not null default '' check (length(brand) <= 60),    -- battery_types.brand; '' = not known yet
  battery_type_id text references battery_types (id) on delete set null,
  status text not null default 'in_service' check (status in ('in_service', 'repair', 'lost', 'retired')),
  source text not null check (source in ('registered', 'swap')),
  location text not null default 'unknown' check (location in ('station', 'customer', 'unknown')),
  station_id text references stations (id) on delete set null,     -- location = 'station'
  holder_user_id text references users (id) on delete set null,    -- location = 'customer', when known
  last_swap_at text,
  created_at text not null,
  unique (brand, serial)
);
create index batteries_serial_idx on batteries (serial);
create index batteries_station_idx on batteries (station_id) where station_id is not null;

create table battery_history (
  id text primary key,
  battery_id text not null references batteries (id) on delete cascade,
  type text not null check (type in ('registered', 'added_at_swap', 'out', 'in', 'status')),
  station_id text references stations (id) on delete set null,
  swap_id text,                                                      -- swap_log.id
  holder_user_id text references users (id) on delete set null,    -- out / in: the customer or driver
  status text check (status is null or status in ('in_service', 'repair', 'lost', 'retired')),
  reason text check (reason is null or length(reason) between 1 and 200),
  person_id text not null,   -- who did it, user id, no foreign key (as audit_log.actor)
  role text not null check (role in ('staff', 'owner', 'admin')),
  created_at text not null,
  check (type <> 'status' or status is not null)
);
create index battery_history_battery_idx on battery_history (battery_id, created_at);
create index battery_history_station_idx on battery_history (station_id, battery_id) where station_id is not null;

-- Backfill from the swap log -----------------------------------------------------------

-- One battery per brand and number named by a swap, handed out or brought back.
insert or ignore into batteries (id, serial, brand, battery_type_id, source, created_at)
  select lower(hex(randomblob(16))), x.serial, x.brand, x.type_id, 'swap', min(x.created_at)
  from (
    select l.battery_out_label as serial, coalesce(t.brand, '') as brand, t.id as type_id, l.created_at
      from swap_log l left join battery_types t on t.id = l.battery_type_id where l.battery_out_label is not null
    union all
    select l.battery_in_label, coalesce(t.brand, ''), t.id, l.created_at
      from swap_log l left join battery_types t on t.id = l.battery_type_id where l.battery_in_label is not null
  ) x
  group by x.brand, x.serial;

-- Its first swap added it.
insert into battery_history (id, battery_id, type, station_id, swap_id, person_id, role, created_at)
  select lower(hex(randomblob(16))), b.id, 'added_at_swap', l.station_id, l.id, l.staff_id, l.role, l.created_at
  from batteries b
  join swap_log l on l.id = (
    select l2.id from swap_log l2 left join battery_types t2 on t2.id = l2.battery_type_id
    where coalesce(t2.brand, '') = b.brand and (l2.battery_out_label = b.serial or l2.battery_in_label = b.serial)
    order by l2.created_at, l2.rowid limit 1
  );

-- Every swap: the battery handed out, then the one brought back.
insert into battery_history (id, battery_id, type, station_id, swap_id, holder_user_id, person_id, role, created_at)
  select lower(hex(randomblob(16))), b.id, 'out', l.station_id, l.id, coalesce(l.customer_user_id, l.driver_id), l.staff_id, l.role, l.created_at
  from swap_log l left join battery_types t on t.id = l.battery_type_id
  join batteries b on b.serial = l.battery_out_label and b.brand = coalesce(t.brand, '')
  order by l.created_at, l.rowid;
insert into battery_history (id, battery_id, type, station_id, swap_id, holder_user_id, person_id, role, created_at)
  select lower(hex(randomblob(16))), b.id, 'in', l.station_id, l.id, coalesce(l.customer_user_id, l.driver_id), l.staff_id, l.role, l.created_at
  from swap_log l left join battery_types t on t.id = l.battery_type_id
  join batteries b on b.serial = l.battery_in_label and b.brand = coalesce(t.brand, '')
  order by l.created_at, l.rowid;

-- Where each one is now: its last swap.
update batteries set
  location = (select case h.type when 'out' then 'customer' else 'station' end from battery_history h
              where h.battery_id = batteries.id and h.type in ('out', 'in') order by h.created_at desc, h.rowid desc limit 1),
  station_id = (select case h.type when 'in' then h.station_id end from battery_history h
                where h.battery_id = batteries.id and h.type in ('out', 'in') order by h.created_at desc, h.rowid desc limit 1),
  holder_user_id = (select case h.type when 'out' then h.holder_user_id end from battery_history h
                    where h.battery_id = batteries.id and h.type in ('out', 'in') order by h.created_at desc, h.rowid desc limit 1),
  last_swap_at = (select max(h.created_at) from battery_history h where h.battery_id = batteries.id and h.type in ('out', 'in'));

-- The swap log points at the batteries.
update swap_log set
  battery_out_id = (select b.id from batteries b where b.serial = swap_log.battery_out_label
                    and b.brand = coalesce((select t.brand from battery_types t where t.id = swap_log.battery_type_id), '')),
  battery_in_id = (select b.id from batteries b where b.serial = swap_log.battery_in_label
                   and b.brand = coalesce((select t.brand from battery_types t where t.id = swap_log.battery_type_id), ''))
  where battery_out_label is not null or battery_in_label is not null;
