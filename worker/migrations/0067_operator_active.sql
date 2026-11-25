-- An operator can be switched off in the backoffice (/admin/operators), and its stations go off
-- with it. operators.is_active: 1 = on (all operators so far). Switching an operator off turns
-- off its active stations and marks them stations.paused_with_operator = 1; switching it back on
-- turns on exactly those, so a station an admin had switched off on its own stays off.
-- A station of an operator that is off cannot be switched on by itself; a station moved to an
-- operator that is off goes off with it (and back on when it is moved to one that is on).
-- Every other page keeps reading stations.is_active alone.
-- Code: worker/api.ts (setOperatorActive, adminOperators, setStationActive, saveStation),
-- src/components/backoffice/operators-manager.tsx. Test: worker/operators.test.ts.
-- Only adds columns with defaults, so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

alter table operators add column is_active integer not null default 1 check (is_active in (0, 1));
alter table stations add column paused_with_operator integer not null default 0 check (paused_with_operator in (0, 1));
