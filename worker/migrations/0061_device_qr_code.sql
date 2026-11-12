-- A short QR code per socket box: the sticker links to /q/<qr_code> (8 characters of 0-9a-z,
-- 41 random bits) instead of /recharge?o=<qr_token> (32 characters). The link is 41 characters,
-- a version 3 QR code instead of version 5, which cheap phones read more easily. The Worker
-- answers /q/… with a redirect, so where the link leads can change without new stickers.
-- Stickers printed with qr_token keep working; renewing a box's code replaces both.
-- Code: src/lib/charging.ts (boxQrUrl, shortLinkTarget), worker/index.ts, worker/charging.ts.
-- Safe to apply before the new Worker is deployed: the old code never reads qr_code.
alter table devices add column qr_code text;
update devices set qr_code = substr('0123456789abcdefghijklmnopqrstuvwxyz', 1 + abs(random()) % 36, 1) || substr('0123456789abcdefghijklmnopqrstuvwxyz', 1 + abs(random()) % 36, 1) || substr('0123456789abcdefghijklmnopqrstuvwxyz', 1 + abs(random()) % 36, 1) || substr('0123456789abcdefghijklmnopqrstuvwxyz', 1 + abs(random()) % 36, 1) || substr('0123456789abcdefghijklmnopqrstuvwxyz', 1 + abs(random()) % 36, 1) || substr('0123456789abcdefghijklmnopqrstuvwxyz', 1 + abs(random()) % 36, 1) || substr('0123456789abcdefghijklmnopqrstuvwxyz', 1 + abs(random()) % 36, 1) || substr('0123456789abcdefghijklmnopqrstuvwxyz', 1 + abs(random()) % 36, 1) where qr_code is null;
create unique index devices_qr_code on devices (qr_code) where qr_code is not null;
