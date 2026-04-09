const fs = require('fs');
const { PrismaClient } = require('@prisma/client');

function loadEnvFile(path) {
  const env = {};
  const text = fs.readFileSync(path, 'utf8');

  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const match = rawLine.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;

    const key = match[1];
    let value = match[2] ?? '';

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

Object.assign(process.env, loadEnvFile('.env.local'));

console.log('DATABASE_URL ->', process.env.DATABASE_URL ? 'set' : 'missing');

(async () => {
  const prisma = new PrismaClient();

  try {
    const meta = await prisma.$queryRawUnsafe(`
      SELECT current_database() AS db, current_schema() AS schema
    `);

    const tables = await prisma.$queryRawUnsafe(`
      SELECT table_schema, table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('User', '_prisma_migrations')
      ORDER BY table_name
    `);

    console.log('meta:', JSON.stringify(meta, null, 2));
    console.log('tables:', JSON.stringify(tables, null, 2));
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
})();