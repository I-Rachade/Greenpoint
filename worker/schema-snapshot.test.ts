import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fakeD1 } from "./test-d1";

// The database schema after all migrations, kept in worker/schema.snapshot.sql. A migration that
// rebuilds a table and forgets an index, a trigger or a check shows up as a diff of this file in
// review instead of silently. After a deliberate schema change, update the file with:
//   UPDATE_SCHEMA_SNAPSHOT=1 npx vitest run worker/schema-snapshot.test.ts

const SNAPSHOT = new URL("./schema.snapshot.sql", import.meta.url);

function currentSchema(): string {
  const { db } = fakeD1();
  const rows = db
    .prepare("select type, name, sql from sqlite_master where sql is not null and name not like 'sqlite_%' order by type, name")
    .all() as { type: string; name: string; sql: string }[];
  // Whitespace inside a statement does not matter, only its content.
  const tidy = (sql: string) => sql.replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").trim();
  return `${rows.map((r) => `-- ${r.type} ${r.name}\n${tidy(r.sql)};`).join("\n\n")}\n`;
}

describe("database schema", () => {
  it("matches worker/schema.snapshot.sql", () => {
    const schema = currentSchema();
    if (process.env.UPDATE_SCHEMA_SNAPSHOT || !existsSync(SNAPSHOT)) writeFileSync(SNAPSHOT, schema);
    expect(schema).toBe(readFileSync(SNAPSHOT, "utf8"));
  });
});
