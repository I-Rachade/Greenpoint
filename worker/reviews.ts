// Customer reviews of stations: 1 to 5 stars and an optional comment.
// One review per customer and station; writing again replaces the old one.
import { cleanReview, shortName, type ReviewInput, type StationReview } from "../src/lib/station-extras";
import type { Profile } from "../src/lib/types";
import { ApiError, nowIso, uuid } from "./http";
import { refuseNonCustomer } from "./roles";

interface ReviewRow {
  id: string;
  station_id: string;
  user_id: string;
  rating: number;
  comment: string;
  created_at: string;
  updated_at: string;
  full_name: string | null;
}

/** Latest reviews of a station, newest first. */
export async function stationReviews(db: D1Database, stationId: string, viewer: Profile | null): Promise<StationReview[]> {
  const { results } = await db
    .prepare(
      `select r.*, u.full_name from station_reviews r left join users u on u.id = r.user_id
       where r.station_id = ? order by r.updated_at desc limit 100`,
    )
    .bind(stationId)
    .all<ReviewRow>();
  return results.map((r) => ({
    id: r.id,
    stationId: r.station_id,
    authorName: shortName(r.full_name),
    rating: r.rating,
    comment: r.comment,
    createdAt: r.updated_at,
    isMine: !!viewer && viewer.id === r.user_id,
  }));
}

/** Creates or replaces the signed-in customer's review of an active station. */
export async function saveReview(db: D1Database, user: Profile, stationId: string, input: ReviewInput) {
  // Customers rate stations; staff and owners would rate their own or a rival station.
  refuseNonCustomer(user);
  const review = cleanReview(input);
  if (!review) throw new ApiError("invalid_review");
  const station = await db.prepare("select 1 from stations where id = ? and is_active = 1").bind(stationId).first();
  if (!station) throw new ApiError("station_not_found", 404);
  const now = nowIso();
  await db
    .prepare(
      `insert into station_reviews (id, station_id, user_id, rating, comment, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?)
       on conflict (station_id, user_id) do update set rating = excluded.rating, comment = excluded.comment, updated_at = excluded.updated_at`,
    )
    .bind(uuid(), stationId, user.id, review.rating, review.comment, now, now)
    .run();
}

/**
 * The author deletes their own review; an admin may remove anyone's (logged).
 * `audit` builds the activity log statement for an admin removal.
 */
export async function deleteReview(
  db: D1Database,
  user: Profile,
  id: string,
  audit: (stationId: string, changes: Record<string, unknown>) => D1PreparedStatement,
) {
  const row = await db.prepare("select station_id, user_id, rating, comment from station_reviews where id = ?").bind(id).first<ReviewRow>();
  if (!row) return;
  if (row.user_id === user.id) {
    await db.prepare("delete from station_reviews where id = ?").bind(id).run();
    return;
  }
  if (user.role !== "admin") throw new ApiError("forbidden", 403);
  await db.batch([
    db.prepare("delete from station_reviews where id = ?").bind(id),
    audit(row.station_id, { review_removed: { rating: row.rating, comment: row.comment } }),
  ]);
}
