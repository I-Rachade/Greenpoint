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
    try {
      const res = this.db.prepare(this.sql).run(...this.params);
      return { ...res, meta: { changes: Number(res.changes) } };
    } catch (err) {
      throw new Error(`D1_ERROR: ${(err as Error).message}`);
    }
  }
}

export function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec("pragma foreign_keys = on"); // as in D1
  const dir = new URL("./migrations/", import.meta.url);
  for (const file of readdirSync(dir).sort()) db.exec(readFileSync(new URL(file, dir), "utf8"));
  const d1 = {
    prepare: (sql: string) => new Statement(db, sql),
    async batch(statements: Statement[]) {
      db.exec("begin");
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        db.exec("commit");
        return out;
      } catch (err) {
        db.exec("rollback");
        throw err;
      }
    },
  };
  return { db, d1 };
}
