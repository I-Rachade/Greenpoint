-- Commands to connected sockets (switch an outlet on or off). The Worker queues
-- them; a bridge fetches pending ones from GET /api/devices/commands and writes
-- them to the device. The device's answer closes the row (worker/devices.ts).
-- Protocol: planung/xingke-16-port-protocol-v1.1-en.md. See docs/steckdosen-lora.md.
-- Apply: npx wrangler d1 migrations apply DB --remote

create table device_commands (
  id integer primary key autoincrement,
  external_id text not null references devices (external_id) on delete cascade,
  outlet integer not null check (outlet >= 1),
  kind text not null check (kind in ('start', 'stop')),
  order_no text not null,
  line text not null,      -- exactly what the bridge sends
  status text not null default 'pending' check (status in ('pending', 'sent', 'done', 'failed', 'expired')),
  result text,             -- the device's MSG code
  created_by text,
  created_at text not null,
  sent_at text,
  done_at text
);
create index device_commands_pending_idx on device_commands (status, created_at);
create index device_commands_order_idx on device_commands (order_no, kind);
