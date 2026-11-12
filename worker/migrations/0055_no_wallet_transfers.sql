-- Green Credit cannot be passed on (no transfer between accounts). The CHECK on
-- wallet_transactions.type still lists 'transfer' for old history rows; instead of rebuilding the
-- table (which would fail on any such row and risks its indexes), the database refuses new ones.
-- Only adds triggers, so it is safe to apply before the new Worker is deployed.
create trigger wallet_transactions_no_transfer_insert
before insert on wallet_transactions when new.type = 'transfer'
begin
  select raise(abort, 'wallet_transfer_not_allowed');
end;

create trigger wallet_transactions_no_transfer_update
before update of type on wallet_transactions when new.type = 'transfer' and old.type <> 'transfer'
begin
  select raise(abort, 'wallet_transfer_not_allowed');
end;
