-- index audit_log_actor_idx
CREATE INDEX audit_log_actor_idx on audit_log (actor, id);

-- index audit_log_station_idx
CREATE INDEX audit_log_station_idx on audit_log (station_id, id);

-- index audit_log_table_idx
CREATE INDEX audit_log_table_idx on audit_log (table_name, id);

-- index auth_ip_requests_idx
CREATE INDEX auth_ip_requests_idx on auth_ip_requests (ip, kind, at);

-- index batteries_serial_idx
CREATE INDEX batteries_serial_idx on batteries (serial);

-- index batteries_station_idx
CREATE INDEX batteries_station_idx on batteries (station_id) where station_id is not null;

-- index battery_events_station_idx
CREATE INDEX battery_events_station_idx on battery_events (station_id, created_at);

-- index battery_events_swap_idx
CREATE INDEX battery_events_swap_idx on battery_events (swap_id) where swap_id is not null;

-- index battery_history_battery_idx
CREATE INDEX battery_history_battery_idx on battery_history (battery_id, created_at);

-- index battery_history_station_idx
CREATE INDEX battery_history_station_idx on battery_history (station_id, battery_id) where station_id is not null;

-- index cash_handovers_period
CREATE UNIQUE INDEX cash_handovers_period on cash_handovers (station_id, period_from) where staff_id is null;

-- index cash_handovers_staff_period
CREATE UNIQUE INDEX cash_handovers_staff_period on cash_handovers (station_id, staff_id, period_from) where staff_id is not null;

-- index cash_handovers_status_idx
CREATE INDEX cash_handovers_status_idx on cash_handovers (status, created_at);

-- index charge_card_transactions_card_idx
CREATE INDEX charge_card_transactions_card_idx on charge_card_transactions (id_tag, created_at);

-- index charge_card_transactions_one_per_charge
CREATE UNIQUE INDEX charge_card_transactions_one_per_charge on charge_card_transactions (charging_session_id) where charging_session_id is not null;

-- index charge_card_transactions_station_idx
CREATE INDEX charge_card_transactions_station_idx on charge_card_transactions (station_id, created_at);

-- index charge_cards_user_idx
CREATE INDEX charge_cards_user_idx on charge_cards (user_id);

-- index charging_points_device_outlet
CREATE UNIQUE INDEX charging_points_device_outlet on charging_points (device_id, outlet) where device_id is not null;

-- index charging_sessions_card_idx
CREATE INDEX charging_sessions_card_idx on charging_sessions (charge_card) where charge_card is not null;

-- index charging_sessions_device_idx
CREATE INDEX charging_sessions_device_idx on charging_sessions (device_id, outlet) where status in ('charging', 'stopped');

-- index charging_sessions_one_open
CREATE UNIQUE INDEX charging_sessions_one_open on charging_sessions (charging_point_id) where status = 'charging';

-- index charging_sessions_partner_idx
CREATE INDEX charging_sessions_partner_idx on charging_sessions (partner_id, paid_at) where partner_id is not null;

-- index charging_sessions_station_idx
CREATE INDEX charging_sessions_station_idx on charging_sessions (station_id, started_at);

-- index charging_sessions_user_idx
CREATE INDEX charging_sessions_user_idx on charging_sessions (user_id, started_at);

-- index counter_code_tries_idx
CREATE INDEX counter_code_tries_idx on counter_code_tries (staff_id, at);

-- index credit_codes_user_idx
CREATE INDEX credit_codes_user_idx on credit_codes (user_id, created_at);

-- index delivery_jobs_customer_idx
CREATE INDEX delivery_jobs_customer_idx on delivery_jobs (customer_user_id, created_at);

-- index delivery_jobs_driver_idx
CREATE INDEX delivery_jobs_driver_idx on delivery_jobs (driver_id, created_at);

-- index delivery_jobs_merchant_idx
CREATE INDEX delivery_jobs_merchant_idx on delivery_jobs (merchant_id, created_at);

-- index delivery_jobs_one_per_parcel
CREATE UNIQUE INDEX delivery_jobs_one_per_parcel on delivery_jobs (parcel_id) where status in ('open', 'assigned', 'accepted', 'picked_up', 'at_door', 'returning');

-- index delivery_jobs_one_per_slot
CREATE UNIQUE INDEX delivery_jobs_one_per_slot on delivery_jobs (driver_id, tour_slot) where status in ('assigned', 'accepted', 'picked_up', 'at_door', 'returning');

-- index delivery_jobs_parcel_idx
CREATE INDEX delivery_jobs_parcel_idx on delivery_jobs (parcel_id);

-- index delivery_jobs_proof_review_idx
CREATE INDEX delivery_jobs_proof_review_idx on delivery_jobs (proof_review) where proof_review = 'pending';

-- index delivery_jobs_status_idx
CREATE INDEX delivery_jobs_status_idx on delivery_jobs (status, created_at);

-- index device_commands_message_idx
CREATE UNIQUE INDEX device_commands_message_idx on device_commands (message_id) where message_id is not null;

-- index device_commands_order_idx
CREATE INDEX device_commands_order_idx on device_commands (order_no, kind);

-- index device_commands_pending_idx
CREATE INDEX device_commands_pending_idx on device_commands (status, created_at);

-- index device_messages_device_idx
CREATE INDEX device_messages_device_idx on device_messages (external_id, received_at);

-- index devices_partner_idx
CREATE INDEX devices_partner_idx on devices (partner_id) where partner_id is not null;

-- index devices_qr_code
CREATE UNIQUE INDEX devices_qr_code on devices (qr_code) where qr_code is not null;

-- index devices_qr_token
CREATE UNIQUE INDEX devices_qr_token on devices (qr_token) where qr_token is not null;

-- index devices_station_idx
CREATE INDEX devices_station_idx on devices (station_id);

-- index driver_ledger_driver_idx
CREATE INDEX driver_ledger_driver_idx on driver_ledger (driver_id, at);

-- index driver_ledger_once_per_job
CREATE UNIQUE INDEX driver_ledger_once_per_job on driver_ledger (job_id, kind) where job_id is not null;

-- index driver_payouts_one_open
CREATE UNIQUE INDEX driver_payouts_one_open on driver_payouts (driver_id) where status = 'requested';

-- index driver_payouts_status
CREATE INDEX driver_payouts_status on driver_payouts (status, requested_at);

-- index driver_queue_station_idx
CREATE INDEX driver_queue_station_idx on driver_queue (station_id, since);

-- index ev_chargers_point_idx
CREATE UNIQUE INDEX ev_chargers_point_idx on ev_chargers (point_id) where point_id is not null;

-- index ev_chargers_station_idx
CREATE INDEX ev_chargers_station_idx on ev_chargers (station_id);

-- index fleet_invites_manager_idx
CREATE INDEX fleet_invites_manager_idx on fleet_invites (manager_id, status);

-- index fleet_invites_one_pending
CREATE UNIQUE INDEX fleet_invites_one_pending on fleet_invites (manager_id, phone) where status = 'pending';

-- index fleet_invites_phone_idx
CREATE INDEX fleet_invites_phone_idx on fleet_invites (phone, status);

-- index fleet_manager_drivers_manager_idx
CREATE INDEX fleet_manager_drivers_manager_idx on fleet_manager_drivers (manager_id);

-- index fleets_status_idx
CREATE INDEX fleets_status_idx on fleets (status, created_at);

-- index greenpoint_ledger_charge
CREATE UNIQUE INDEX greenpoint_ledger_charge on greenpoint_ledger (charging_session_id) where charging_session_id is not null;

-- index greenpoint_ledger_job
CREATE UNIQUE INDEX greenpoint_ledger_job on greenpoint_ledger (job_id) where job_id is not null;

-- index greenpoint_ledger_redemption
CREATE UNIQUE INDEX greenpoint_ledger_redemption on greenpoint_ledger (redemption_id) where redemption_id is not null;

-- index greenpoint_ledger_reservation
CREATE UNIQUE INDEX greenpoint_ledger_reservation on greenpoint_ledger (reservation_id) where reservation_id is not null;

-- index greenpoint_ledger_user_idx
CREATE INDEX greenpoint_ledger_user_idx on greenpoint_ledger (user_id, created_at);

-- index greenpoint_redemptions_code_idx
CREATE INDEX greenpoint_redemptions_code_idx on greenpoint_redemptions (code) where status = 'open';

-- index greenpoint_redemptions_one_open
CREATE UNIQUE INDEX greenpoint_redemptions_one_open on greenpoint_redemptions (user_id) where status = 'open';

-- index merchant_addresses_merchant_idx
CREATE INDEX merchant_addresses_merchant_idx on merchant_addresses (merchant_id, created_at);

-- index merchant_checkins_merchant_idx
CREATE INDEX merchant_checkins_merchant_idx on merchant_checkins (merchant_id, in_at);

-- index merchant_checkins_one_open
CREATE UNIQUE INDEX merchant_checkins_one_open on merchant_checkins (driver_id) where out_at is null;

-- index merchant_drivers_driver_idx
CREATE INDEX merchant_drivers_driver_idx on merchant_drivers (driver_id, status);

-- index merchant_drivers_merchant_idx
CREATE INDEX merchant_drivers_merchant_idx on merchant_drivers (merchant_id, status);

-- index merchant_drivers_one_open
CREATE UNIQUE INDEX merchant_drivers_one_open on merchant_drivers (merchant_id, driver_id, kind) where status in ('pending', 'active');

-- index merchant_invites_merchant_idx
CREATE INDEX merchant_invites_merchant_idx on merchant_invites (merchant_id, status);

-- index merchant_invites_one_pending
CREATE UNIQUE INDEX merchant_invites_one_pending on merchant_invites (merchant_id, phone) where status = 'pending';

-- index merchant_invites_phone_idx
CREATE INDEX merchant_invites_phone_idx on merchant_invites (phone, status);

-- index merchant_members_merchant_idx
CREATE INDEX merchant_members_merchant_idx on merchant_members (merchant_id);

-- index merchants_status_idx
CREATE INDEX merchants_status_idx on merchants (status, created_at);

-- index ocpp_transactions_open_idx
CREATE INDEX ocpp_transactions_open_idx on ocpp_transactions (external_id, connector_id) where stopped_at is null;

-- index operator_owners_user_idx
CREATE INDEX operator_owners_user_idx on operator_owners (user_id);

-- index otp_codes_created_idx
CREATE INDEX otp_codes_created_idx on otp_codes (created_at);

-- index otp_codes_phone_idx
CREATE INDEX otp_codes_phone_idx on otp_codes (phone, created_at);

-- index parcel_code_failures_idx
CREATE INDEX parcel_code_failures_idx on parcel_code_failures (station_id, at);

-- index parcel_code_failures_station_idx
CREATE INDEX parcel_code_failures_station_idx on parcel_code_failures (at_station, at) where at_station is not null;

-- index parcel_events_parcel_idx
CREATE INDEX parcel_events_parcel_idx on parcel_events (parcel_id, id);

-- index parcel_notifications_at_idx
CREATE INDEX parcel_notifications_at_idx on parcel_notifications (channel, at);

-- index parcel_runs_driver_idx
CREATE INDEX parcel_runs_driver_idx on parcel_runs (driver_id, created_at);

-- index parcel_runs_station_idx
CREATE INDEX parcel_runs_station_idx on parcel_runs (station_id, status);

-- index parcel_scans_once
CREATE UNIQUE INDEX parcel_scans_once on parcel_scans (parcel_id, run_id, kind);

-- index parcel_scans_parcel_idx
CREATE INDEX parcel_scans_parcel_idx on parcel_scans (parcel_id, id);

-- index parcels_code_per_station
CREATE UNIQUE INDEX parcels_code_per_station on parcels (to_station_id, pickup_code) where status = 'arrived';

-- index parcels_created_idx
CREATE INDEX parcels_created_idx on parcels (created_at);

-- index parcels_from_idx
CREATE INDEX parcels_from_idx on parcels (from_station_id, status);

-- index parcels_partner_idx
CREATE INDEX parcels_partner_idx on parcels (partner_id, created_at);

-- index parcels_recipient_idx
CREATE INDEX parcels_recipient_idx on parcels (recipient_user_id);

-- index parcels_run_idx
CREATE INDEX parcels_run_idx on parcels (run_id);

-- index parcels_sender_idx
CREATE INDEX parcels_sender_idx on parcels (sender_user_id);

-- index parcels_to_idx
CREATE INDEX parcels_to_idx on parcels (to_station_id, status);

-- index partner_api_keys_partner_idx
CREATE INDEX partner_api_keys_partner_idx on partner_api_keys (partner_id);

-- index partner_bookings_partner_idx
CREATE INDEX partner_bookings_partner_idx on partner_bookings (partner_id, created_at);

-- index partner_bookings_station_idx
CREATE INDEX partner_bookings_station_idx on partner_bookings (from_station_id, status);

-- index partner_events_booking_idx
CREATE INDEX partner_events_booking_idx on partner_events (booking_id, created_at);

-- index partner_events_due_idx
CREATE INDEX partner_events_due_idx on partner_events (next_attempt_at) where next_attempt_at is not null;

-- index partner_events_partner_idx
CREATE INDEX partner_events_partner_idx on partner_events (partner_id, created_at);

-- index payments_one_per_charge
CREATE UNIQUE INDEX payments_one_per_charge on payments (charging_session_id) where charging_session_id is not null and status in ('pending', 'succeeded');

-- index payments_one_per_reservation
CREATE UNIQUE INDEX payments_one_per_reservation on payments (reservation_id) where status in ('pending', 'succeeded');

-- index payments_one_per_share_ride
CREATE UNIQUE INDEX payments_one_per_share_ride on payments (share_ride_id) where share_ride_id is not null and status in ('pending', 'succeeded');

-- index payments_user_idx
CREATE INDEX payments_user_idx on payments (user_id, created_at);

-- index point_partner_accounts_partner_idx
CREATE INDEX point_partner_accounts_partner_idx on point_partner_accounts (partner_id);

-- index push_tokens_user
CREATE INDEX push_tokens_user on push_tokens (user_id);

-- index reservation_code_failures_idx
CREATE INDEX reservation_code_failures_idx on reservation_code_failures (reservation_id, at);

-- index reservations_created_idx
CREATE INDEX reservations_created_idx on reservations (created_at);

-- index reservations_one_active_per_user
CREATE UNIQUE INDEX reservations_one_active_per_user on reservations (user_id) where status = 'active';

-- index reservations_station_active_idx
CREATE INDEX reservations_station_active_idx on reservations (station_id) where status = 'active';

-- index reservations_target_active_idx
CREATE INDEX reservations_target_active_idx on reservations (station_id, kind, target) where status = 'active';

-- index reservations_user_idx
CREATE INDEX reservations_user_idx on reservations (user_id, created_at);

-- index security_events_at
CREATE INDEX security_events_at on security_events (at);

-- index security_events_ip
CREATE INDEX security_events_ip on security_events (ip, kind, at) where ip is not null;

-- index security_events_kind_at
CREATE INDEX security_events_kind_at on security_events (kind, at);

-- index security_events_subject
CREATE INDEX security_events_subject on security_events (subject, kind, at) where subject is not null;

-- index sessions_user_idx
CREATE INDEX sessions_user_idx on sessions (user_id);

-- index share_incidents_one_open
CREATE UNIQUE INDEX share_incidents_one_open on share_incidents (ride_id, kind) where resolved_at is null and ride_id is not null;

-- index share_incidents_open_idx
CREATE INDEX share_incidents_open_idx on share_incidents (resolved_at, created_at);

-- index share_ride_points_ride_idx
CREATE INDEX share_ride_points_ride_idx on share_ride_points (ride_id, at);

-- index share_rides_one_per_user
CREATE UNIQUE INDEX share_rides_one_per_user on share_rides (user_id) where status in ('reserved', 'riding', 'paused');

-- index share_rides_one_per_vehicle
CREATE UNIQUE INDEX share_rides_one_per_vehicle on share_rides (vehicle_id) where status in ('reserved', 'riding', 'paused');

-- index share_rides_user_idx
CREATE INDEX share_rides_user_idx on share_rides (user_id, created_at);

-- index share_rides_vehicle_idx
CREATE INDEX share_rides_vehicle_idx on share_rides (vehicle_id, created_at);

-- index share_vehicles_station_idx
CREATE INDEX share_vehicles_station_idx on share_vehicles (station_id, status);

-- index staff_invites_contact_idx
CREATE INDEX staff_invites_contact_idx on staff_invites (contact, status);

-- index staff_invites_one_pending
CREATE UNIQUE INDEX staff_invites_one_pending on staff_invites (station_id, contact) where status = 'pending';

-- index staff_invites_station_idx
CREATE INDEX staff_invites_station_idx on staff_invites (station_id, status);

-- index staff_reassignments_operator_idx
CREATE INDEX staff_reassignments_operator_idx on staff_reassignments (operator_id, resolved_at);

-- index station_actions_person_idx
CREATE INDEX station_actions_person_idx on station_actions (person_id, created_at);

-- index station_actions_station_idx
CREATE INDEX station_actions_station_idx on station_actions (station_id, created_at);

-- index station_battery_types_type_idx
CREATE INDEX station_battery_types_type_idx on station_battery_types (battery_type_id);

-- index station_reviews_station
CREATE INDEX station_reviews_station on station_reviews (station_id, created_at);

-- index station_services_pending_idx
CREATE INDEX station_services_pending_idx on station_services (status) where status = 'pending';

-- index station_staff_one_station
CREATE UNIQUE INDEX station_staff_one_station on station_staff (user_id);

-- index swap_log_driver_idx
CREATE INDEX swap_log_driver_idx on swap_log (driver_id) where driver_id is not null;

-- index swap_log_station_idx
CREATE INDEX swap_log_station_idx on swap_log (station_id, created_at);

-- index wallet_topups_user_idx
CREATE INDEX wallet_topups_user_idx on wallet_topups (user_id, created_at);

-- index wallet_transactions_created_idx
CREATE INDEX wallet_transactions_created_idx on wallet_transactions (created_at);

-- index wallet_transactions_idempotency
CREATE UNIQUE INDEX wallet_transactions_idempotency on wallet_transactions (user_id, idempotency_key) where idempotency_key is not null;

-- index wallet_transactions_station_idx
CREATE INDEX wallet_transactions_station_idx on wallet_transactions (station_id, created_at) where station_id is not null;

-- index wallet_transactions_user_idx
CREATE INDEX wallet_transactions_user_idx on wallet_transactions (user_id, created_at);

-- table app_settings
CREATE TABLE app_settings (key text primary key, value text not null, updated_by text, updated_at text not null);

-- table audit_log
CREATE TABLE audit_log (id integer primary key autoincrement, at text not null, actor text, table_name text not null, action text not null check (action in ('insert', 'update', 'delete')), row_id text not null, station_id text, user_id text, changes text not null default '{}' -- JSON);

-- table auth_ip_requests
CREATE TABLE auth_ip_requests (ip text not null, kind text not null, at text not null);

-- table batteries
CREATE TABLE batteries (id text primary key, serial text not null check (length(serial) between 1 and 60), -- as cleanBatteryLabel() writes it (upper case) brand text not null default '' check (length(brand) <= 60), -- battery_types.brand; '' = not known yet battery_type_id text references battery_types (id) on delete set null, status text not null default 'in_service' check (status in ('in_service', 'repair', 'lost', 'retired')), source text not null check (source in ('registered', 'swap')), location text not null default 'unknown' check (location in ('station', 'customer', 'unknown')), station_id text references stations (id) on delete set null, -- location = 'station' holder_user_id text references users (id) on delete set null, -- location = 'customer', when known last_swap_at text, created_at text not null, unique (brand, serial));

-- table battery_counter
CREATE TABLE battery_counter (station_id text not null references stations (id) on delete cascade, battery_type_id text not null default '', full integer not null default 0 check (full >= 0), empty integer not null default 0 check (empty >= 0), updated_at text not null, primary key (station_id, battery_type_id));

-- table battery_events
CREATE TABLE battery_events (id text primary key, request_id text not null unique, station_id text not null references stations (id) on delete cascade, battery_type_id text not null default '', type text not null check (type in ('issue', 'full', 'correction', 'empty_in')), delta integer not null, full_after integer not null check (full_after >= 0), empty_after integer not null check (empty_after >= 0), reason text check (reason is null or length(reason) between 1 and 200), swap_id text, -- swap_log.id when the event is part of a swap (0028) person_id text not null, -- user id, no foreign key (as audit_log.actor) role text not null check (role in ('staff', 'owner', 'admin')), created_at text not null, check (type <> 'issue' or delta = -1), check (type not in ('full', 'empty_in') or delta = 1), check (type <> 'correction' or (delta <> 0 and reason is not null)));

-- table battery_history
CREATE TABLE battery_history (id text primary key, battery_id text not null references batteries (id) on delete cascade, type text not null check (type in ('registered', 'added_at_swap', 'out', 'in', 'status')), station_id text references stations (id) on delete set null, swap_id text, -- swap_log.id holder_user_id text references users (id) on delete set null, -- out / in: the customer or driver status text check (status is null or status in ('in_service', 'repair', 'lost', 'retired')), reason text check (reason is null or length(reason) between 1 and 200), person_id text not null, -- who did it, user id, no foreign key (as audit_log.actor) role text not null check (role in ('staff', 'owner', 'admin')), created_at text not null, check (type <> 'status' or status is not null));

-- table battery_types
CREATE TABLE battery_types (id text primary key, brand text not null check (length(brand) between 1 and 60), -- motorbike brand or battery operator name text not null check (length(name) between 1 and 80), -- model, e.g. "72V 40Ah" is_active integer not null default 1 check (is_active in (0, 1)), created_at text not null, unique (brand, name));

-- table cash_handovers
CREATE TABLE cash_handovers (id text primary key, station_id text not null references stations (id) on delete cascade, period_from text not null, period_until text not null, cash_xof integer not null, -- cash taken for poinderecharge in the period carry_xof integer not null, -- left over from earlier closings, at the time commission_xof integer not null default 0 check (commission_xof >= 0), -- kept back (deduct) due_xof integer not null, -- cash + carry - commission amount_xof integer not null check (amount_xof >= 0), -- handed over method text not null check (method in ('cash', 'mobile_money', 'bank')), reference text not null check (length(reference) between 1 and 80), -- agent's name or transaction/receipt number note text check (note is null or length(note) <= 200), -- why the amount differs status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')), created_by text not null, created_at text not null, decided_by text, decided_at text, reject_reason text check (reject_reason is null or length(reject_reason) between 1 and 200) , staff_id text);

-- table charge_card_transactions
CREATE TABLE charge_card_transactions (id text primary key, id_tag text not null, -- no foreign key: the history stays when a card is deleted type text not null check (type in ('topup', 'charge', 'adjust')), amount_xof integer not null check (amount_xof <> 0), -- + credit, - debit balance_after_xof integer not null, station_id text, -- where it was topped up or charged charging_session_id text, -- type 'charge': the charge it paid reason text check (reason is null or length(reason) <= 120), created_by text, -- staff or admin; null for a charge created_at text not null);

-- table charge_cards
CREATE TABLE charge_cards (-- The card number as the charge point sends it (OCPP idTag, at most 20 characters), upper case. id_tag text primary key check (length(id_tag) between 1 and 20 and id_tag = upper(id_tag)), -- Optional: the customer the card belongs to (greenpoints, shown in the app). user_id text references users (id) on delete set null, label text check (label is null or length(label) <= 60), blocked integer not null default 0 check (blocked in (0, 1)), -- Credit in FCFA. Can go below 0 when a stop reached the charge point late; such a card -- starts nothing until it is topped up again. balance_xof integer not null default 0, created_by text, -- the admin or staff who added it; null when a swipe added it created_at text not null, last_swiped_at text, last_device_id text);

-- table charging_points
CREATE TABLE charging_points (id text primary key, station_id text not null references stations (id) on delete cascade, label text not null, status text not null default 'free' check (status in ('free', 'reserved', 'charging', 'done', 'fault')), device_id text, power_watts integer, last_seen_at text, created_at text not null, outlet integer check (outlet >= 1), energy_wh integer check (energy_wh >= 0), qr_start integer not null default 0, unique (station_id, label));

-- table charging_sessions
CREATE TABLE "charging_sessions" (id text primary key, station_id text not null references stations (id) on delete cascade, charging_point_id text references charging_points (id) on delete set null, device_id text not null, outlet integer not null check (outlet >= 1), point_label text not null, order_no text, user_id text references users (id) on delete set null, status text not null default 'charging' check (status in ('charging', 'stopped', 'paid', 'cancelled')), kwh_xof integer not null check (kwh_xof > 0), min_xof integer not null check (min_xof >= 0), energy_wh integer not null default 0 check (energy_wh >= 0), last_reading_wh integer, seen_charging integer not null default 0, started_by text not null, started_at text not null, stopped_by text, stopped_at text, amount_xof integer check (amount_xof >= 0), payment_method text check (payment_method in ('cash', 'wallet', 'flooz', 'tmoney', 'card')), payment_ref text, paid_by text, paid_at text, partner_id text references point_partners (id), -- The card that started the charge and pays it. charge_card text , credit_limit_xof integer check (credit_limit_xof is null or credit_limit_xof >= 0), credit_held_xof integer check (credit_held_xof is null or credit_held_xof >= 0), credit_hold_trx text, ocpp_transaction_id integer);

-- table counter_code_tries
CREATE TABLE counter_code_tries (staff_id text not null, kind text not null, at text not null);

-- table credit_codes
CREATE TABLE "credit_codes" (code_hash text primary key, user_id text not null references users (id) on delete cascade, created_at text not null, expires_at text not null, used_at text, used_at_station text, used_for text check (used_for in ('topup', 'swap', 'charge')), used_by_request text);

-- table delivery_jobs
CREATE TABLE "delivery_jobs" (id text primary key, kind text not null check (kind in ('express', 'pickup', 'delivery', 'ride', 'courier')), status text not null check (status in ('open', 'assigned', 'accepted', 'picked_up', 'at_door', 'returning', 'done', 'failed', 'cancelled')), parcel_id text references parcels (id), customer_user_id text, -- pickup and courier: the sender; delivery: the recipient; ride: the passenger; express: null customer_name text, from_station_id text references stations (id), to_station_id text references stations (id), home_lat real, -- ride: where the customer gets on; courier: the sender's door home_lng real, home_note text check (home_note is null or length(home_note) <= 300), home_phone text, size text not null check (size in ('S', 'M', 'L', 'XL')), weight_kg real, content text not null default '', declared_value integer, recipient_phone text, -- pickup and courier bookings recipient_name text, distance_m integer not null, fare_fcfa integer not null check (fare_fcfa >= 0), collect_fcfa integer not null default 0 check (collect_fcfa >= 0), driver_id text, driver_station_id text, -- where the driver was in line when offered the trip declined text not null default '', -- drivers who said no, comma-separated, so it is not offered to them again created_at text not null, assigned_at text, accepted_at text, picked_up_at text, -- ride: the customer got on at_door_at text, done_at text, cancelled_by text, proof_key text, -- R2 key of the photo at the door dropoff_lat real, -- ride: where the customer gets off; courier: the recipient's door dropoff_lng real, dropoff_note text check (dropoff_note is null or length(dropoff_note) <= 300), passengers integer check (passengers is null or passengers between 1 and 4), vehicle_type text check (vehicle_type is null or vehicle_type in ('moto', 'tricycle', 'cargo_tricycle', 'car')) , handover_code text check (handover_code is null or length(handover_code) = 6), merchant_id text, booked_by text, prepaid_fcfa integer not null default 0 check (prepaid_fcfa >= 0), prepaid_refunded_at text, tour_slot integer not null default 1 check (tour_slot between 1 and 5), proof_review text check (proof_review in ('pending', 'approved', 'rejected')), proof_reject_reason text);

-- table device_callbacks
CREATE TABLE device_callbacks (key text primary key, -- device:action:messageId[:status] received_at text not null);

-- table device_commands
CREATE TABLE device_commands (id integer primary key autoincrement, external_id text not null references devices (external_id) on delete cascade, outlet integer not null check (outlet >= 1), kind text not null check (kind in ('start', 'stop')), order_no text not null, line text not null, -- exactly what the bridge sends status text not null default 'pending' check (status in ('pending', 'sent', 'done', 'failed', 'expired')), result text, -- the device's MSG code created_by text, created_at text not null, sent_at text, done_at text , message_id text);

-- table device_messages
CREATE TABLE device_messages (id integer primary key autoincrement, external_id text not null, received_at text not null, payload text not null -- JSON);

-- table devices
CREATE TABLE "devices" (external_id text primary key check (external_id = upper(external_id)), -- DevEUI or the vendor's id station_id text references stations (id) on delete set null, -- null until assigned vendor text not null default '', model text not null default '', link text not null default 'lorawan' check (link in ('lorawan', 'vendor_cloud', 'own_server')), outlets integer not null default 2 check (outlets between 1 and 16), last_seen_at text, created_at text not null, vendor_ref text, protocol text check (protocol in ('ocpp1.6')), ocpp_key_hash text, partner_id text references point_partners (id), qr_token text, qr_code text);

-- table driver_ledger
CREATE TABLE driver_ledger (id text primary key, driver_id text not null, -- no foreign key: accounting stays when the account is deleted at text not null, kind text not null check (kind in ('collected', 'earning', 'settlement')), amount_fcfa integer not null, job_id text, station_id text, actor text);

-- table driver_payouts
CREATE TABLE driver_payouts (id text primary key, driver_id text not null, amount_fcfa integer not null check (amount_fcfa > 0), network text not null check (network in ('flooz', 'tmoney')), phone text not null, status text not null default 'requested' check (status in ('requested', 'paid', 'rejected')), reference text check (reference is null or length(reference) <= 80), requested_at text not null, decided_at text, decided_by text);

-- table driver_positions
CREATE TABLE driver_positions (driver_id text primary key references users (id) on delete cascade, lat real not null, lng real not null, accuracy_m real, at text not null);

-- table driver_queue
CREATE TABLE driver_queue (driver_id text primary key references drivers (user_id) on delete cascade, station_id text not null references stations (id) on delete cascade, since text not null);

-- table driver_settings
CREATE TABLE driver_settings (id integer primary key check (id = 1), settings text not null, -- JSON of DriverSettings updated_at text not null);

-- table drivers
CREATE TABLE drivers (user_id text primary key references users (id) on delete cascade, status text not null default 'pending' check (status in ('pending', 'active', 'rejected', 'suspended')), full_name text not null check (length(full_name) between 2 and 80), id_number text not null check (length(id_number) between 3 and 40), license_number text not null check (length(license_number) between 3 and 40), wanted_type text not null check (wanted_type in ('moto', 'tricycle', 'cargo_tricycle', 'car')), id_doc_key text, -- R2 keys of the photos (private, admins only) license_doc_key text, portrait_key text, vehicle_id text unique references fleet_vehicles (id) on delete set null, code text not null unique, -- shown under the driver's QR code created_at text not null, reviewed_at text, reviewed_by text);

-- table ev_chargers
CREATE TABLE "ev_chargers" (id text primary key, name text not null check (length(name) between 1 and 80), connector text not null check (connector in ('type2', 'ccs2', 'chademo', 'gbt_ac', 'gbt_dc', 'schuko')), power_kw real not null check (power_kw > 0 and power_kw <= 400), station_id text references stations (id) on delete set null, -- null until assigned is_active integer not null default 1 check (is_active in (0, 1)), created_at text not null , point_id text references charging_points (id) on delete set null);

-- table fleet_invites
CREATE TABLE fleet_invites (id text primary key, manager_id text not null references fleets (manager_id) on delete cascade, phone text not null, invited_by text not null, -- user id (the manager or an admin), no foreign key (as audit_log.actor) status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked', 'expired')), token text not null unique check (length(token) between 6 and 16), created_at text not null, expires_at text not null, decided_at text, user_id text -- the account that accepted or declined);

-- table fleet_manager_drivers
CREATE TABLE fleet_manager_drivers (driver_id text primary key references drivers (user_id) on delete cascade, manager_id text not null references users (id) on delete cascade, created_at text not null);

-- table fleet_vehicles
CREATE TABLE fleet_vehicles (id text primary key, type text not null check (type in ('moto', 'tricycle', 'cargo_tricycle', 'car')), plate text not null unique check (length(plate) between 2 and 20), is_active integer not null default 1, created_at text not null);

-- table fleets
CREATE TABLE fleets (manager_id text primary key references users (id) on delete cascade, name text not null check (length(name) between 2 and 80), status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')), tier text not null default 'standard' check (tier in ('standard', 'unlocked')), created_at text not null, reviewed_at text, reviewed_by text, tier_set_at text, tier_set_by text);

-- table former_rider_accounts
CREATE TABLE former_rider_accounts (driver_id text primary key, -- Null: nothing to move, the row only carries the cancelled reservations. rider_id text unique, -- What moved, for the record and the driver page. balance_xof integer not null default 0, points integer not null default 0, cancelled_reservations integer not null default 0, created_at text not null, claimed_at text);

-- table greenpoint_ledger
CREATE TABLE greenpoint_ledger (id text primary key, user_id text not null references users (id) on delete cascade, kind text not null check (kind in ('swap', 'charge', 'visit', 'delivery', 'redeem', 'admin_adjust')), co2_grams integer not null default 0 check (co2_grams >= 0), points integer not null, vehicle text, station_id text references stations (id) on delete set null, reservation_id text references reservations (id) on delete set null, redemption_id text, job_id text, -- delivery_jobs (no foreign key: trips are kept apart) distance_m integer, created_by text, created_at text not null , charging_session_id text);

-- table greenpoint_redemptions
CREATE TABLE greenpoint_redemptions (id text primary key, user_id text not null references users (id) on delete cascade, reward_id text not null references greenpoint_rewards (id), code text not null check (length(code) = 6), cost_points integer not null, status text not null default 'open' check (status in ('open', 'used', 'cancelled')), expires_at text not null, used_at text, used_by text, station_id text references stations (id) on delete set null, created_at text not null);

-- table greenpoint_rewards
CREATE TABLE greenpoint_rewards (id text primary key, title text not null, description text not null default '', cost_points integer not null check (cost_points > 0), provider text not null default 'network' check (provider in ('network', 'partner')), partner_name text, stock integer check (stock is null or stock >= 0), -- null = unlimited valid_until text, is_active integer not null default 1, created_at text not null, updated_at text not null);

-- table merchant_addresses
CREATE TABLE merchant_addresses (id text primary key, merchant_id text not null references merchants (id) on delete cascade, label text not null check (length(label) between 2 and 40), address text not null check (length(address) between 2 and 200), -- The phone number the driver calls at this address (Togo). phone text not null check (phone glob '+228[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'), lat real not null, lng real not null, created_at text not null, created_by text not null);

-- table merchant_checkins
CREATE TABLE merchant_checkins (id text primary key, merchant_id text not null references merchants (id) on delete cascade, driver_id text not null references users (id) on delete cascade, assignment_id text not null, pay_mode text not null check (pay_mode in ('per_trip', 'hourly')), rate_per_hour_fcfa integer, in_at text not null, out_at text, out_by text check (out_by in ('driver', 'merchant', 'admin', 'auto')), out_actor text, amount_fcfa integer, received_at text);

-- table merchant_drivers
CREATE TABLE merchant_drivers (id text primary key, merchant_id text not null references merchants (id) on delete cascade, driver_id text not null references users (id) on delete cascade, kind text not null check (kind in ('favorite', 'assigned')), status text not null check (status in ('pending', 'active', 'declined', 'ended')), pay_mode text check (pay_mode in ('per_trip', 'hourly')), rate_per_hour_fcfa integer check (rate_per_hour_fcfa is null or rate_per_hour_fcfa > 0), created_at text not null, created_by text not null, approved_at text, approved_by text, approved_as text check (approved_as in ('driver', 'fleet_manager', 'admin')), ended_at text, ended_by text, check (kind = 'favorite' or pay_mode is not null), check (pay_mode is null or (pay_mode = 'hourly') = (rate_per_hour_fcfa is not null)));

-- table merchant_invites
CREATE TABLE merchant_invites (id text primary key, merchant_id text not null references merchants (id) on delete cascade, phone text not null, invited_by text not null, status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked', 'expired')), token text not null unique check (length(token) between 6 and 16), created_at text not null, expires_at text not null, decided_at text, user_id text);

-- table merchant_members
CREATE TABLE merchant_members (user_id text primary key references users (id) on delete cascade, merchant_id text not null references merchants (id) on delete cascade, is_owner integer not null default 0 check (is_owner in (0, 1)), created_at text not null, added_by text);

-- table merchants
CREATE TABLE merchants (id text primary key, owner_id text not null unique references users (id) on delete cascade, name text not null check (length(name) between 2 and 80), phone text not null check (phone glob '+228[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'), address text not null default '' check (length(address) <= 200), lat real not null, lng real not null, -- pending: registered, waiting for an admin. suspended: an approved shop an admin stopped. status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'suspended')), -- standard: at most 3 employees besides the merchant, no statistics. unlocked: set by an admin. tier text not null default 'standard' check (tier in ('standard', 'unlocked')), created_at text not null, reviewed_at text, reviewed_by text, tier_set_at text, tier_set_by text);

-- table ocpp_transactions
CREATE TABLE ocpp_transactions (id integer primary key autoincrement, external_id text not null references devices (external_id) on delete cascade, connector_id integer not null check (connector_id >= 1), id_tag text not null, meter_start integer not null, -- Wh meter_stop integer, -- Wh started_at text not null, stopped_at text, stop_reason text);

-- table operator_owners
CREATE TABLE operator_owners (operator_id text not null references operators (id) on delete cascade, user_id text not null references users (id) on delete cascade, created_at text not null, primary key (operator_id, user_id));

-- table operators
CREATE TABLE operators (id text primary key, name text not null, is_own integer not null default 0, contact_phone text, created_at text not null);

-- table otp_codes
CREATE TABLE otp_codes (id integer primary key autoincrement, phone text not null, code_hash text not null, created_at text not null, expires_at text not null, attempts integer not null default 0, used integer not null default 0);

-- table parcel_code_failures
CREATE TABLE parcel_code_failures (id integer primary key autoincrement, station_id text not null, at text not null , at_station text);

-- table parcel_depots
CREATE TABLE parcel_depots (station_id text primary key references stations (id) on delete cascade, is_active integer not null default 1, note text not null default '' check (length(note) <= 200), -- where at the station, e.g. "au comptoir" lockers integer not null default 0 check (lockers between 0 and 500), -- compartments of a future locker updated_at text not null , has_counter integer not null default 1 check (has_counter in (0, 1)));

-- table parcel_events
CREATE TABLE parcel_events (id integer primary key autoincrement, parcel_id text not null references parcels (id) on delete cascade, at text not null, actor text, status text not null, station_id text);

-- table parcel_notifications
CREATE TABLE parcel_notifications (id integer primary key autoincrement, parcel_id text not null references parcels (id) on delete cascade, at text not null, kind text not null, -- deposited, arrived, reminder, picked_up, stored channel text not null check (channel in ('sms', 'email')), target text not null, ok integer not null default 0, error text);

-- table parcel_runs
CREATE TABLE parcel_runs (id text primary key, station_id text not null references stations (id), driver_id text not null, -- the driver account; no foreign key, the run stays on record status text not null check (status in ('loading', 'under_way', 'done', 'cancelled')), created_by text not null, created_role text not null check (created_role in ('staff', 'owner', 'admin')), created_at text not null, departed_at text, done_at text);

-- table parcel_scans
CREATE TABLE parcel_scans (id integer primary key autoincrement, parcel_id text not null references parcels (id) on delete cascade, run_id text not null, kind text not null check (kind in ('handover_to_driver', 'received_at_station', 'delivered')), driver_id text, station_id text, scanned_by text not null, role text not null check (role in ('staff', 'owner', 'admin', 'driver')), created_at text not null);

-- table parcel_sizes
CREATE TABLE parcel_sizes (size text primary key check (size in ('S', 'M', 'L', 'XL')), max_length_cm real not null check (max_length_cm > 0), max_width_cm real not null check (max_width_cm > 0), max_height_cm real not null check (max_height_cm > 0), max_weight_kg real not null check (max_weight_kg > 0 and max_weight_kg <= 50), price_fcfa integer not null check (price_fcfa >= 0), updated_at text not null);

-- table parcels
CREATE TABLE parcels (id text primary key, tracking_no text not null unique, -- "GP-7K3M9Q" from_station_id text not null references stations (id), to_station_id text not null references stations (id), sender_user_id text, sender_phone text not null, sender_name text, recipient_user_id text, recipient_phone text not null, recipient_name text, content text not null check (length(content) between 1 and 300), declared_value integer check (declared_value is null or declared_value >= 0), length_cm real not null check (length_cm > 0), width_cm real not null check (width_cm > 0), height_cm real not null check (height_cm > 0), weight_kg real not null check (weight_kg > 0 and weight_kg <= 50), size text not null check (size in ('S', 'M', 'L', 'XL')), price_fcfa integer not null check (price_fcfa >= 0), payment_method text not null default 'cash', paid_at text, status text not null check (status in ('deposited', 'in_transit', 'arrived', 'picked_up', 'cancelled', 'stored', 'released', 'auctioned')), pickup_code text check (pickup_code is null or length(pickup_code) = 6), -- set on arrival locker_no integer, pickup_deadline text, reminders_sent integer not null default 0, created_by text, created_at text not null, in_transit_at text, arrived_at text, picked_up_at text, picked_up_by text, stored_at text, -- not picked up in time, put into storage closed_at text, express integer not null default 0, delivery_status text check (delivery_status is null or delivery_status in ('booked', 'out_for_delivery', 'delivered', 'failed')), job_id text, partner_id text, partner_booking_id text, run_id text, label_printed_at text, -- cancelled, released or auctioned check (from_station_id <> to_station_id));

-- table partner_api_keys
CREATE TABLE partner_api_keys (id text primary key, partner_id text not null references partners (id) on delete cascade, label text not null default '' check (length(label) <= 60), prefix text not null, key_hash text not null unique, created_by text, created_at text not null, last_used_at text, revoked_at text);

-- table partner_bookings
CREATE TABLE partner_bookings (id text primary key, partner_id text not null references partners (id), reference text not null check (length(reference) between 1 and 64), tracking_no text not null unique, status text not null check (status in ('booked', 'handed_in', 'cancelled', 'expired')), from_station_id text not null references stations (id), to_station_id text not null references stations (id), sender_phone text not null, sender_name text, recipient_phone text not null, recipient_name text, content text not null check (length(content) between 1 and 300), declared_value integer check (declared_value is null or declared_value >= 0), length_cm real not null check (length_cm > 0), width_cm real not null check (width_cm > 0), height_cm real not null check (height_cm > 0), weight_kg real not null check (weight_kg > 0 and weight_kg <= 50), size text not null check (size in ('S', 'M', 'L', 'XL')), price_fcfa integer not null check (price_fcfa >= 0), parcel_id text, created_at text not null, expires_at text not null, handed_in_at text, closed_at text, unique (partner_id, reference), check (from_station_id <> to_station_id));

-- table partner_events
CREATE TABLE partner_events (id text primary key, -- "evt_…" partner_id text not null references partners (id) on delete cascade, booking_id text not null, type text not null, -- "booking.created", "parcel.arrived" … source_key text not null unique, -- what it was made from, so it is queued once payload text not null, -- the JSON body sent created_at text not null, attempts integer not null default 0, next_attempt_at text, -- null: delivered, given up, or no webhook delivered_at text, last_status integer, last_error text);

-- table partner_state
CREATE TABLE partner_state (key text primary key, value text not null);

-- table partners
CREATE TABLE partners (id text primary key, name text not null check (length(name) between 1 and 80), contact_email text, contact_phone text not null, -- sender of bookings that name none is_active integer not null default 1, webhook_url text, -- https; null = the partner polls GET /events webhook_secret text not null, -- signs webhooks (HMAC-SHA256) share_pickup_code integer not null default 0, -- send the recipient's pickup code to the partner created_by text, created_at text not null, updated_at text not null);

-- table payments
CREATE TABLE payments (id text primary key, -- Sent to the provider as our order reference; unique so a retry never pays twice. identifier text not null unique, -- Null once the rider deleted the account: the payment stays (accounting records), the person does not. user_id text references users (id) on delete set null, station_id text not null references stations (id), reservation_id text references reservations (id) on delete set null, amount_xof integer not null check (amount_xof > 0), network text not null check (network in ('flooz', 'tmoney')), phone text check (phone glob '+228[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'), -- wallet number; null after account deletion provider text not null, -- 'paygate', 'mock', later others provider_reference text, -- provider's transaction id (PayGate: tx_reference) status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'expired', 'cancelled')), failure_reason text, created_at text not null, updated_at text not null, paid_at text , charging_session_id text, share_ride_id text);

-- table point_partner_accounts
CREATE TABLE point_partner_accounts (user_id text primary key references users (id) on delete cascade, partner_id text not null references point_partners (id) on delete cascade, created_at text not null);

-- table point_partners
CREATE TABLE point_partners (id text primary key, name text not null check (length(name) between 1 and 80), contact_phone text check (contact_phone is null or contact_phone glob '+228[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'), -- suspended: the accounts lose the dashboard; sockets and charges stay as they are. status text not null default 'active' check (status in ('active', 'suspended')), created_at text not null);

-- table promotions
CREATE TABLE promotions (id text primary key, title text not null check (length(title) between 1 and 120), body text not null default '' check (length(body) <= 1000), image_url text, link_url text, link_label text, is_active integer not null default 0, starts_at text, ends_at text, created_at text not null, updated_at text not null);

-- table push_tokens
CREATE TABLE push_tokens (token text primary key, user_id text not null references users (id) on delete cascade, platform text not null, updated_at text not null);

-- table repair_centers
CREATE TABLE repair_centers (id text primary key, operator_id text references operators (id) on delete set null, -- the brand it repairs for, if any name text not null check (length(name) between 1 and 80), address text not null default '' check (length(address) <= 200), lat real not null check (lat between -90 and 90), lng real not null check (lng between -180 and 180), phone text, opening_hours text not null default '', -- days and times (src/lib/opening-hours.ts), '' = not known is_active integer not null default 1 check (is_active in (0, 1)), created_at text not null);

-- table reservation_code_failures
CREATE TABLE reservation_code_failures (id integer primary key autoincrement, reservation_id text not null, station_id text not null, at text not null);

-- table reservations
CREATE TABLE reservations (id text primary key, user_id text not null references users (id) on delete cascade, station_id text not null references stations (id) on delete cascade, type text not null check (type in ('battery', 'slot')), status text not null default 'active' check (status in ('active', 'completed', 'cancelled', 'expired')), created_at text not null, expires_at text not null, cancel_reason text, pickup_code text not null check (length(pickup_code) = 4), charging_point_id text references charging_points (id) on delete set null , kind text not null default 'swap' check (kind in ('swap', 'charging_point')), target text);

-- table security_events
CREATE TABLE security_events (id integer primary key autoincrement, at text not null, kind text not null, user_id text, ip text, subject text, detail text, dedupe text unique);

-- table sessions
CREATE TABLE sessions (token_hash text primary key, user_id text not null references users (id) on delete cascade, created_at text not null, expires_at text not null);

-- table share_incidents
CREATE TABLE share_incidents (id text primary key, kind text not null check (kind in ('breakdown', 'damage', 'alarm', 'wrong_drop', 'long_ride', 'offline')), vehicle_id text references share_vehicles (id) on delete set null, ride_id text references share_rides (id) on delete set null, note text not null default '', created_at text not null, resolved_at text, resolved_by text, resolution text);

-- table share_ride_points
CREATE TABLE share_ride_points (ride_id text not null references share_rides (id) on delete cascade, at text not null, lat real not null, lng real not null, speed_kmh real);

-- table share_rides
CREATE TABLE share_rides (id text primary key, user_id text references users (id) on delete set null, vehicle_id text not null references share_vehicles (id), from_station_id text not null references stations (id), to_station_id text references stations (id) on delete set null, end_station_id text references stations (id) on delete set null, status text not null check (status in ('reserved', 'riding', 'paused', 'ended', 'cancelled')), helmet integer not null default 0 check (helmet in (0, 1)), reserved_at text not null, reserve_expires_at text, started_at text, paused_at text, paused_seconds integer not null default 0, ended_at text, ended_by text, -- the customer, or the admin who ended it by hand wrong_drop integer not null default 0 check (wrong_drop in (0, 1)), distance_m integer not null default 0, -- The tariff as it was when the ride started: a later price change does not touch it. unlock_xof integer not null default 0, minute_xof integer not null default 0, pause_minute_xof integer not null default 0, deposit_xof integer not null default 0, wrong_drop_xof integer not null default 0, amount_xof integer not null default 0, payment_status text not null default 'none' check (payment_status in ('none', 'unpaid', 'paid')), paid_with text check (paid_with in ('flooz', 'tmoney', 'wallet', 'cash', 'free')), paid_at text, paid_ref text, -- Green Credit transaction number of a ride paid from the credit cash_by text, -- staff who took the cash photos text not null default '[]', -- R2 keys of the photos at the start and the end created_at text not null);

-- table share_stations
CREATE TABLE share_stations (station_id text primary key references stations (id) on delete cascade, enabled integer not null default 1 check (enabled in (0, 1)), radius_m integer not null default 50 check (radius_m between 10 and 500), helmets integer not null default 0 check (helmets between 0 and 500), updated_at text not null);

-- table share_tariffs
CREATE TABLE share_tariffs (kind text primary key check (kind in ('emoto', 'escooter', 'car')), unlock_xof integer not null default 0 check (unlock_xof >= 0), minute_xof integer not null default 0 check (minute_xof >= 0), pause_minute_xof integer not null default 0 check (pause_minute_xof >= 0), deposit_xof integer not null default 0 check (deposit_xof >= 0), wrong_drop_xof integer not null default 0 check (wrong_drop_xof >= 0), is_active integer not null default 0 check (is_active in (0, 1)), updated_at text not null);

-- table share_vehicles
CREATE TABLE share_vehicles (id text primary key, kind text not null check (kind in ('emoto', 'escooter', 'car')), name text not null check (length(name) between 1 and 60), plate text not null default '', qr_token text not null unique, home_station_id text references stations (id) on delete set null, station_id text references stations (id) on delete set null, status text not null default 'maintenance' check (status in ('available', 'reserved', 'in_ride', 'charging', 'maintenance', 'lost')), tracker_id text unique, -- Tutrack deviceId imei text not null default '', sim text not null default '', unlock_command text not null default '', -- Tutrack cmdCategoryCode that releases the ignition lock_command text not null default '', -- … and the one that cuts it online integer not null default 0 check (online in (0, 1)), ignition integer check (ignition in (0, 1)), battery_percent integer check (battery_percent between 0 and 100), lat real, lng real, fix_at text, -- time of the last position (UTC) last_seen_at text, note text not null default '', created_at text not null);

-- table share_verifications
CREATE TABLE share_verifications (user_id text primary key references users (id) on delete cascade, status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')), id_key text, selfie_key text, licence_key text, submitted_at text, decided_at text, decided_by text, reject_reason text);

-- table staff_invites
CREATE TABLE staff_invites (id text primary key, station_id text not null references stations (id) on delete cascade, -- Normalised as lib/contact.ts: "+228…" or a lower-case e-mail address. contact text not null, invited_by text not null, status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked', 'expired')), created_at text not null, expires_at text not null, decided_at text, -- Who accepted or declined. user_id text);

-- table staff_reassignments
CREATE TABLE staff_reassignments (id text primary key, user_id text not null references users (id) on delete cascade, station_id text not null references stations (id) on delete cascade, operator_id text not null, created_at text not null, resolved_at text, resolved_by text);

-- table station_actions
CREATE TABLE station_actions (id integer primary key autoincrement, station_id text not null, person_id text not null, -- user id, no foreign key (as audit_log.actor) role text not null check (role in ('staff', 'owner', 'admin')), action text not null check (length(action) between 1 and 200), created_at text not null);

-- table station_battery_types
CREATE TABLE station_battery_types (station_id text not null references stations (id) on delete cascade, battery_type_id text not null references battery_types (id) on delete cascade, full_batteries integer not null default 0 check (full_batteries >= 0), capacity integer not null default 0 check (capacity >= 0), primary key (station_id, battery_type_id));

-- table station_reviews
CREATE TABLE station_reviews (id text primary key, station_id text not null references stations (id) on delete cascade, user_id text not null references users (id) on delete cascade, rating integer not null check (rating between 1 and 5), comment text not null default '' check (length(comment) <= 500), created_at text not null, updated_at text not null, unique (station_id, user_id));

-- table station_services
CREATE TABLE station_services (station_id text not null references stations (id) on delete cascade, service text not null check (service in ('swap', 'charging', 'ev', 'parcels', 'drivers')), unlocked integer not null default 0 check (unlocked in (0, 1)), status text check (status in ('pending', 'approved', 'rejected')), requested_by text, -- user id, no foreign key (as audit_log.actor) requested_at text, decided_by text, decided_at text, primary key (station_id, service));

-- table station_staff
CREATE TABLE station_staff (station_id text not null references stations (id) on delete cascade, user_id text not null references users (id) on delete cascade, primary key (station_id, user_id));

-- table station_status
CREATE TABLE station_status (station_id text primary key references stations (id) on delete cascade, is_open integer not null default 1, free_slots integer not null default 0 check (free_slots >= 0), full_batteries integer not null default 0 check (full_batteries >= 0), updated_at text not null, updated_by text);

-- table stations
CREATE TABLE stations (id text primary key, operator_id text not null references operators (id), name text not null, address text not null default '', lat real not null check (lat between -90 and 90), lng real not null check (lng between -180 and 180), kind text not null check (kind in ('charging', 'swap', 'both')), vehicle_types text not null default '["scooter"]', -- JSON array charging_slots integer not null default 0 check (charging_slots >= 0), battery_capacity integer not null default 0 check (battery_capacity >= 0), opening_hours text not null default '', phone text, is_active integer not null default 1, created_at text not null , price_battery_xof integer check (price_battery_xof > 0 and price_battery_xof % 5 = 0), price_slot_xof integer check (price_slot_xof > 0 and price_slot_xof % 5 = 0), has_battery integer not null default 1 check (has_battery in (0, 1)), photos text not null default '[]', amenities text not null default '[]', is_solar integer not null default 0, charge_kwh_xof integer check (charge_kwh_xof > 0 and charge_kwh_xof % 5 = 0), charge_min_xof integer check (charge_min_xof >= 0 and charge_min_xof % 5 = 0), main_activity text check (main_activity in ('charging', 'swap', 'ev', 'restaurant', 'shop')), swap_owner text check (swap_owner in ('operator', 'poinderecharge')), commission_pct integer not null default 0 check (commission_pct between 0 and 100), commission_mode text not null default 'monthly' check (commission_mode in ('deduct', 'monthly')), cash_since text, green_credit integer not null default 0 check (green_credit in (0, 1)), ev_kwh_xof integer check (ev_kwh_xof is null or ev_kwh_xof > 0), ev_min_xof integer check (ev_min_xof is null or ev_min_xof >= 0), counter_cash_since text);

-- table swap_log
CREATE TABLE swap_log (id text primary key, request_id text not null unique, station_id text not null references stations (id) on delete cascade, battery_type_id text not null default '', has_battery_in integer not null check (has_battery_in in (0, 1)), battery_in_id text, battery_in_label text check (battery_in_label is null or length(battery_in_label) between 1 and 60), battery_out_id text, battery_out_label text check (battery_out_label is null or length(battery_out_label) between 1 and 60), customer_type text not null check (customer_type in ('app', 'cash', 'fleet', 'first_purchase')), customer_user_id text references users (id) on delete set null, driver_id text references users (id) on delete set null, fleet_manager_id text, reservation_id text references reservations (id) on delete set null, payment text not null check (payment in ('cash', 'wallet', 'fleet', 'none')), amount_xof integer not null default 0 check (amount_xof >= 0), wallet_trx_id text, staff_id text not null, -- who did it, user id, no foreign key (as audit_log.actor) role text not null check (role in ('staff', 'owner', 'admin')), created_at text not null, owner text check (owner in ('operator', 'poinderecharge')), check (has_battery_in = (customer_type <> 'first_purchase')), check (customer_type <> 'fleet' or (driver_id is not null and payment = 'fleet')), check (payment <> 'wallet' or customer_user_id is not null));

-- table users
CREATE TABLE "users" (id text primary key, phone text unique check (phone is null or phone glob '+228[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'), -- Stored in lower case. email text unique check (email is null or (email = lower(email) and length(email) <= 254 and email like '_%@_%._%')), full_name text, -- 'rider' is the customer (worker/roles.ts). 'merchant': a shop's merchant or employee (0035). role text not null default 'rider' check (role in ('rider', 'operator', 'fleet_manager', 'admin', 'driver', 'merchant')), created_at text not null, last_sign_in_at text, pin_hash text, pin_failures integer not null default 0, pin_locked_until text, greenpoint_vehicle text check (greenpoint_vehicle in ('scooter', 'tricycle', 'ebike', 'moped')), pin_lock_count integer not null default 0, -- A customer account opened for a converted driver waits without contact until claimed (0031). check (phone is not null or email is not null or (role = 'rider' and pin_hash is null)));

-- table wallet_fee_settings
CREATE TABLE wallet_fee_settings (product text primary key check (product in ('transfer')), fixed_xof integer not null default 0 check (fixed_xof >= 0), percent real not null default 0 check (percent >= 0 and percent <= 50), min_xof integer not null default 0 check (min_xof >= 0), max_xof integer not null default 0 check (max_xof >= 0), daily_xof integer not null default 0 check (daily_xof >= 0), monthly_xof integer not null default 0 check (monthly_xof >= 0), is_active integer not null default 1, updated_by text, updated_at text not null);

-- table wallet_topups
CREATE TABLE wallet_topups (id text primary key, -- Sent to the provider as our order reference ("pdw_…"); unique so a retry never pays twice. identifier text not null unique, -- Null once the person deleted the account: the record stays (accounting records). user_id text references users (id) on delete set null, amount_xof integer not null check (amount_xof > 0), network text not null check (network in ('flooz', 'tmoney', 'card')), -- The paying Flooz/T-Money number; null for cards and after account deletion. phone text check (phone glob '+228[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'), provider text not null, provider_reference text, status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'expired', 'cancelled')), failure_reason text, -- The booking that credited the wallet; set in the same batch as the credit, so it happens once. wallet_tx_id text, created_at text not null, updated_at text not null, paid_at text);

-- table wallet_transactions
CREATE TABLE "wallet_transactions" (id text primary key, trx_id text not null, user_id text references users (id) on delete set null, type text not null check (type in ('transfer', 'admin_adjust', 'topup', 'charge', 'trip')), attribute text not null check (attribute in ('send', 'received')), status text not null default 'success' check (status in ('success', 'pending', 'rejected')), amount_xof integer not null check (amount_xof > 0), fee_xof integer not null default 0 check (fee_xof >= 0), total_xof integer not null check (total_xof > 0), balance_after_xof integer not null, counterparty_user_id text references users (id) on delete set null, counterparty_label text, remark text check (remark is null or length(remark) <= 120), admin_id text, idempotency_key text, details text not null default '{}', created_at text not null, station_id text references stations (id) on delete set null, unique (trx_id, attribute));

-- table wallets
CREATE TABLE wallets (user_id text primary key references users (id), currency text not null default 'XOF' check (currency = 'XOF'), balance_xof integer not null default 0 check (balance_xof >= 0), status text not null default 'active' check (status in ('active', 'frozen')), created_at text not null, updated_at text not null);

-- trigger charging_sessions_partner_from_device
CREATE TRIGGER charging_sessions_partner_from_device after insert on charging_sessions begin update charging_sessions set partner_id = (select partner_id from devices where external_id = new.device_id) where id = new.id; end;

-- trigger payments_anonymize_on_user_delete
CREATE TRIGGER payments_anonymize_on_user_delete before delete on users begin update payments set user_id = null, phone = null where user_id = old.id; end;

-- trigger reservations_kind_from_type
CREATE TRIGGER reservations_kind_from_type after insert on reservations when new.type = 'slot' and new.kind = 'swap' begin update reservations set kind = 'charging_point' where id = new.id; end;

-- trigger station_services_on_charger_insert
CREATE TRIGGER station_services_on_charger_insert after insert on ev_chargers when new.station_id is not null begin insert into station_services (station_id, service, unlocked, status) select new.station_id, 'ev', 1, 'approved' where not exists (select 1 from station_services where station_id = new.station_id and service = 'ev'); end;

-- trigger station_services_on_charger_update
CREATE TRIGGER station_services_on_charger_update after update of station_id on ev_chargers when new.station_id is not null begin insert into station_services (station_id, service, unlocked, status) select new.station_id, 'ev', 1, 'approved' where not exists (select 1 from station_services where station_id = new.station_id and service = 'ev'); end;

-- trigger station_services_on_depot_insert
CREATE TRIGGER station_services_on_depot_insert after insert on parcel_depots when new.is_active = 1 begin insert into station_services (station_id, service, unlocked, status) select new.station_id, 'parcels', 1, 'approved' where not exists (select 1 from station_services where station_id = new.station_id and service = 'parcels'); insert into station_services (station_id, service, unlocked, status) select new.station_id, 'drivers', 1, 'approved' where not exists (select 1 from station_services where station_id = new.station_id and service = 'drivers'); end;

-- trigger station_services_on_depot_update
CREATE TRIGGER station_services_on_depot_update after update of is_active on parcel_depots when new.is_active = 1 begin insert into station_services (station_id, service, unlocked, status) select new.station_id, 'parcels', 1, 'approved' where not exists (select 1 from station_services where station_id = new.station_id and service = 'parcels'); insert into station_services (station_id, service, unlocked, status) select new.station_id, 'drivers', 1, 'approved' where not exists (select 1 from station_services where station_id = new.station_id and service = 'drivers'); end;

-- trigger station_services_on_point_insert
CREATE TRIGGER station_services_on_point_insert after insert on charging_points begin insert into station_services (station_id, service, unlocked, status) select new.station_id, 'charging', 1, 'approved' where not exists (select 1 from station_services where station_id = new.station_id and service = 'charging'); end;

-- trigger station_services_on_station_insert
CREATE TRIGGER station_services_on_station_insert after insert on stations begin insert into station_services (station_id, service, unlocked, status) select new.id, 'swap', 1, 'approved' where new.has_battery = 1 and new.kind in ('swap', 'both') and not exists (select 1 from station_services where station_id = new.id and service = 'swap'); insert into station_services (station_id, service, unlocked, status) select new.id, 'charging', 1, 'approved' where new.has_battery = 1 and new.kind in ('charging', 'both') and not exists (select 1 from station_services where station_id = new.id and service = 'charging'); end;

-- trigger station_services_on_station_kind
CREATE TRIGGER station_services_on_station_kind after update of kind, has_battery on stations begin insert into station_services (station_id, service, unlocked, status) select new.id, 'swap', 1, 'approved' where new.has_battery = 1 and new.kind in ('swap', 'both') and not exists (select 1 from station_services where station_id = new.id and service = 'swap'); insert into station_services (station_id, service, unlocked, status) select new.id, 'charging', 1, 'approved' where new.has_battery = 1 and new.kind in ('charging', 'both') and not exists (select 1 from station_services where station_id = new.id and service = 'charging'); end;

-- trigger wallet_transactions_no_transfer_insert
CREATE TRIGGER wallet_transactions_no_transfer_insert before insert on wallet_transactions when new.type = 'transfer' begin select raise(abort, 'wallet_transfer_not_allowed'); end;

-- trigger wallet_transactions_no_transfer_update
CREATE TRIGGER wallet_transactions_no_transfer_update before update of type on wallet_transactions when new.type = 'transfer' and old.type <> 'transfer' begin select raise(abort, 'wallet_transfer_not_allowed'); end;
