-- Station photos and amenities (set in the backoffice) and customer reviews.
-- Photos and amenities are JSON arrays: image URLs (first = cover) and
-- amenity ids (see src/lib/station-extras.ts). One review per customer and
-- station; a new review replaces the old one. Only adds columns and a table,
-- so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote
alter table stations add column photos text not null default '[]';
alter table stations add column amenities text not null default '[]';

create table station_reviews (
  id text primary key,
  station_id text not null references stations (id) on delete cascade,
  user_id text not null references users (id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text not null default '' check (length(comment) <= 500),
  created_at text not null,
  updated_at text not null,
  unique (station_id, user_id)
);

create index station_reviews_station on station_reviews (station_id, created_at);
