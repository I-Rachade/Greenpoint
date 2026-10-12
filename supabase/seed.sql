-- Example data for Lomé. Replace with the real stations before going live.
-- Coordinates are approximate placeholders.

insert into public.operators (id, name, is_own, contact_phone) values
  ('00000000-0000-0000-0000-000000000001', 'poinderecharge', true, null),
  ('00000000-0000-0000-0000-000000000002', 'Exemple Opérateur', false, null);

insert into public.stations
  (operator_id, name, address, lat, lng, kind, vehicle_types, charging_slots, battery_capacity, opening_hours)
values
  ('00000000-0000-0000-0000-000000000001', 'poinderecharge Grand Marché', 'Boulevard du 13 Janvier', 6.1262, 1.2236, 'both', '{scooter,ebike,moped}', 6, 12, '07:00-21:00'),
  ('00000000-0000-0000-0000-000000000001', 'poinderecharge Tokoin', 'Avenue de la Libération', 6.1496, 1.2187, 'swap', '{scooter,moped,tricycle}', 0, 20, '06:00-22:00'),
  ('00000000-0000-0000-0000-000000000001', 'poinderecharge Université', 'Université de Lomé', 6.1735, 1.2115, 'charging', '{scooter,ebike}', 8, 0, '07:00-20:00'),
  ('00000000-0000-0000-0000-000000000001', 'poinderecharge Bè', 'Bè Kpota', 6.1370, 1.2420, 'both', '{scooter,tricycle,moped}', 4, 10, '06:30-21:30'),
  ('00000000-0000-0000-0000-000000000001', 'poinderecharge Agoè', 'Agoè Assiyéyé', 6.2245, 1.2080, 'swap', '{scooter,moped,tricycle}', 0, 16, '06:00-22:00'),
  ('00000000-0000-0000-0000-000000000002', 'Exemple Hédzranawoé', 'Hédzranawoé', 6.1605, 1.2470, 'charging', '{scooter,ebike}', 4, 0, '08:00-19:00');
