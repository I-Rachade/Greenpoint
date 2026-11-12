-- One QR code per socket box: the sticker links to /recharge?o=<qr_token> and the customer
-- picks one of its outlets in the app. The token is random (128 bits) so the DevEUI or the
-- vendor's id is never printed, and an admin can renew it to void a copied sticker.
-- Existing sockets get a token now; new ones get one when they are registered.
-- Code: worker/charging.ts (outletInfo, startOutletCharge, renewOutletQr), worker/devices.ts.
-- Safe to apply before the new Worker is deployed: the old code never reads qr_token.
alter table devices add column qr_token text;
update devices set qr_token = lower(hex(randomblob(16))) where qr_token is null;
create unique index devices_qr_token on devices (qr_token) where qr_token is not null;
