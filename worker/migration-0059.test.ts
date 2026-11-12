import { describe, expect, it } from "vitest";
import { applyMigration, fakeD1 } from "./test-d1";

// Migration 0059 widens the CHECK of delivery_jobs.proof_review (0053) to 'rejected' by copying
// the column into a new one: what was there stays, and the index on pending reviews is back.

const T = "2026-10-19T10:00:00.000Z";

describe("migration 0059", () => {
  it("keeps every proof review, allows 'rejected' and nothing else, and keeps the index", () => {
    const { db } = fakeD1({ before: "0059" });
    const insert = db.prepare(
      "insert into delivery_jobs (id, kind, status, size, distance_m, fare_fcfa, created_at, proof_review) values (?, 'courier', 'done', 'S', 1000, 500, ?, ?)",
    );
    insert.run("pending", T, "pending");
    insert.run("approved", T, "approved");
    insert.run("none", T, null);
    expect(() => insert.run("early", T, "rejected")).toThrow(/CHECK/);
    applyMigration(db, "0059_courier_proof_reject.sql");
    expect(db.prepare("select id, proof_review, proof_reject_reason from delivery_jobs order by id").all()).toEqual([
      { id: "approved", proof_review: "approved", proof_reject_reason: null },
      { id: "none", proof_review: null, proof_reject_reason: null },
      { id: "pending", proof_review: "pending", proof_reject_reason: null },
    ]);
    db.prepare("update delivery_jobs set proof_review = 'rejected', proof_reject_reason = 'Photo floue' where id = 'pending'").run();
    expect(() => db.prepare("update delivery_jobs set proof_review = 'maybe' where id = 'none'").run()).toThrow(/CHECK/);
    const columns = (db.prepare("pragma table_info(delivery_jobs)").all() as { name: string }[]).map((c) => c.name);
    expect(columns).not.toContain("proof_review_next");
    expect(db.prepare("select sql from sqlite_master where name = 'delivery_jobs_proof_review_idx'").get()).toBeTruthy();
  });
});
