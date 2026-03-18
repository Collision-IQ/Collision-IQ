import { Pool, type QueryResult, type QueryResultRow } from "pg";

const globalForDb = globalThis as typeof globalThis & {
  pgPool?: Pool;
};

const pool =
  globalForDb.pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.pgPool = pool;
}

export async function sql<T extends QueryResultRow = QueryResultRow>(
  strings: TemplateStringsArray,
  ...values: unknown[]
): Promise<QueryResult<T>> {
  const text = strings.reduce((acc, part, index) => {
    const valuePlaceholder = index < values.length ? `$${index + 1}` : "";
    return `${acc}${part}${valuePlaceholder}`;
  }, "");

  return pool.query<T>(text, values);
}
