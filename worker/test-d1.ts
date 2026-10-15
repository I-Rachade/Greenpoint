// A minimal D1 on top of SQLite with the real migrations, for Worker tests.
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

type Value = string | number | null;

export class Statement {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private params: Value[] = [],
  ) {}
  bind(...params: unknown[]) {
    return new Statement(this.db, this.sql, params.map((p) => (p === undefined ? null : typeof p === "boolean" ? Number(p) : (p as Value))));
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.params) as T[] };
  }
  async run() {
    return this.runNow();
  }
  /** Synchronous, so a batch runs as one unit like D1's (no other batch slips in between). */
  runNow() {
    try {
      const res = this.db.prepare(this.sql).run(...this.params);
      return { ...res, meta: { changes: Number(res.changes) } };
    } catch (err) {
      throw new Error(`D1_ERROR: ${(err as Error).message}`);
    }
  }
}

const MIGRATIONS = new URL("./migrations/", import.meta.url);

/** The migration files in the order D1 applies them. */
export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
}

/** Applies one migration file in a transaction, as D1 does (a failing file changes nothing). */
export function applyMigration(db: DatabaseSync, file: string) {
  db.exec("begin");
  try {
    db.exec(readFileSync(new URL(file, MIGRATIONS), "utf8"));
    db.exec("commit");
  } catch (err) {
    db.exec("rollback");
    throw err;
  }
}

/** `before`: only the migrations whose file name sorts before it (to test a migration on data). */
export function fakeD1(options: { before?: string } = {}) {
  const db = new DatabaseSync(":memory:");
  db.exec("pragma foreign_keys = on"); // as in D1
  for (const file of migrationFiles()) if (!options.before || file < options.before) db.exec(readFileSync(new URL(file, MIGRATIONS), "utf8"));
  return { db, d1: d1Of(db) };
}

/** A D1 binding on an open SQLite database (for example a copy of a prepared one). */
export function d1Of(db: DatabaseSync) {
  return {
    prepare: (sql: string) => new Statement(db, sql),
    async batch(statements: Statement[]) {
      db.exec("begin");
      try {
        const out = [];
        for (const s of statements) out.push(s.runNow());
        db.exec("commit");
        return out;
      } catch (err) {
        db.exec("rollback");
        throw err;
      }
    },
  };
}
