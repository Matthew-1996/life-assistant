import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";

const helperDirectory = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(helperDirectory, "../../..");
const migration = readFileSync(
  resolve(appRoot, "d1/migrations/0001_init.sql"),
  "utf8",
);

class StatementAdapter {
  private bindings: SQLInputValue[] = [];

  constructor(private readonly statement: ReturnType<DatabaseSync["prepare"]>) {}

  bind(...bindings: SQLInputValue[]) {
    this.bindings = bindings;
    return this;
  }

  async first() {
    return this.statement.get(...this.bindings) ?? null;
  }

  async all() {
    return { results: this.statement.all(...this.bindings) };
  }

  async run() {
    return this.statement.run(...this.bindings);
  }
}

export class D1TestDatabase {
  readonly database = new DatabaseSync(":memory:");

  constructor() {
    this.database.exec(migration);
  }

  prepare(sql: string) {
    return new StatementAdapter(this.database.prepare(sql));
  }

  async batch(statements: StatementAdapter[]) {
    this.database.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.database.close();
  }
}
