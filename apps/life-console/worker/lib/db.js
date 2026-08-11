import { HttpError } from "./errors.js";

export function requireDatabase(env) {
  if (!env.DB?.prepare) {
    throw new HttpError(503, "database_not_configured", "D1 database is not configured.");
  }
  return env.DB;
}

export async function first(db, sql, bindings = []) {
  return db.prepare(sql).bind(...bindings).first();
}

export async function all(db, sql, bindings = []) {
  const result = await db.prepare(sql).bind(...bindings).all();
  return result?.results ?? [];
}

export async function run(db, sql, bindings = []) {
  return db.prepare(sql).bind(...bindings).run();
}

export async function batch(db, statements) {
  if (!db.batch) {
    const results = [];
    for (const [sql, bindings] of statements) {
      results.push(await run(db, sql, bindings));
    }
    return results;
  }
  return db.batch(
    statements.map(([sql, bindings]) => db.prepare(sql).bind(...bindings)),
  );
}

export function parseJson(value, fallback) {
  if (typeof value !== "string" || value === "") return fallback;
  try {
    return JSON.parse(value);
  } catch {
    throw new HttpError(500, "stored_json_invalid", "Stored structured data is invalid.");
  }
}
