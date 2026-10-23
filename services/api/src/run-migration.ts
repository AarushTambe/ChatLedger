
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";

async function runMigration() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is missing from your .env file.");
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    application_name: "chatledger-migration",
  });

  try {
    const existing = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_type = 'BASE TABLE'
        AND table_name IN (
          'users',
          'projects',
          'conversations',
          'tasks',
          'activity_events',
          'schema_migrations'
        )
    `);

    if (existing.rows.length > 0) {
      const names = existing.rows
        .map((row: { table_name: string }) => row.table_name)
        .join(", ");

      throw new Error(
        `Migration stopped: some target tables already exist: ${names}. ` +
        "Inspect the database before proceeding."
      );
    }

    const migrationPath = resolve(
      process.cwd(),
      "services/api/migrations/001_initial_schema.sql"
    );

    const sql = await readFile(migrationPath, "utf8");

    console.log("Applying migration 001_initial_schema.sql...");

    await pool.query(sql);

    console.log("Migration applied successfully.");
  } finally {
    await pool.end();
  }
}

runMigration().catch((error: unknown) => {
  console.error("Migration failed:", error);
  process.exitCode = 1;
});
