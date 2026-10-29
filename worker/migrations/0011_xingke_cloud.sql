-- Sockets driven through the Xingke cloud API (JSON over HTTPS): we send
-- commands to the vendor platform, it calls POST /api/devices/xingke with
-- device events. See worker/xingke.ts and docs/steckdosen-lora.md.
-- Apply: npx wrangler d1 migrations apply DB --remote

-- The device id exactly as the vendor spells it: its API is case-sensitive,
-- while external_id is stored upper-case. Null means external_id.
alter table devices add column vendor_ref text;

-- Our messageId of a cloud command; its CommandResult callback closes the row.
-- For these rows `line` holds the JSON body we sent and order_no the transactionId.
alter table device_commands add column message_id text;
create unique index device_commands_message_idx on device_commands (message_id) where message_id is not null;

-- Callbacks already applied: the vendor delivers at least once and retries for 24 hours.
create table device_callbacks (
  key text primary key,       -- device:action:messageId[:status]
  received_at text not null
);
