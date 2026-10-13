-- Operator accounts: the people who run an operator (the company a station
-- belongs to). An admin links an account to an operator in the backoffice; that
-- person then works at all the operator's stations like staff, chooses the staff
-- of those stations and keeps their opening hours and phone up to date. An
-- operator can have several stations in different places and several accounts.
-- Code: worker/api.ts (Operator accounts). Safe to apply before the new Worker
-- is deployed.
--
-- Menu and station rights now follow the role: only operators (and admins) work
-- at stations. Assignments left over from a role an admin changed by hand grant
-- nothing any more, so they are removed here.
-- Apply: npx wrangler d1 migrations apply DB --remote

create table operator_owners (
  operator_id text not null references operators (id) on delete cascade,
  user_id text not null references users (id) on delete cascade,
  created_at text not null,
  primary key (operator_id, user_id)
);
create index operator_owners_user_idx on operator_owners (user_id);

delete from station_staff where user_id in (select id from users where role not in ('operator', 'admin'));
