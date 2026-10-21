-- Login with phone number and PIN. The SMS code is only needed to register
-- and to set a new PIN when it is forgotten.
alter table users add column pin_hash text;          -- "pbkdf2$<iterations>$<salt b64>$<hash b64>"
alter table users add column pin_failures integer not null default 0;
alter table users add column pin_locked_until text;
