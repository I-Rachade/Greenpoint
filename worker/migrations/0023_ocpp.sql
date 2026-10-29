-- Charge points that speak OCPP 1.6J connect straight to us over a WebSocket
-- (wss://app.poinderecharge.com/api/devices/ocpp/<id>), see worker/ocpp.ts and
-- docs/steckdosen-lora.md. Only adds columns and a table, so it is safe to apply
-- before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

-- "ocpp1.6" for such charge points (link 'own_server'); null for every other socket.
alter table devices add column protocol text check (protocol in ('ocpp1.6'));
-- SHA-256 (hex) of the charge point's AuthorizationKey, its HTTP Basic password.
alter table devices add column ocpp_key_hash text;

-- Charges as the charge point reports them (StartTransaction / StopTransaction).
-- The row id is the OCPP transactionId we hand out.
create table ocpp_transactions (
  id integer primary key autoincrement,
  external_id text not null references devices (external_id) on delete cascade,
  connector_id integer not null check (connector_id >= 1),
  id_tag text not null,
  meter_start integer not null,      -- Wh
  meter_stop integer,                -- Wh
  started_at text not null,
  stopped_at text,
  stop_reason text
);
create index ocpp_transactions_open_idx on ocpp_transactions (external_id, connector_id) where stopped_at is null;
