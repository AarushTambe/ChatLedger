import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "pg";

const MIGRATIONS_DIR = resolve(
  process.cwd(),
  "services/api/migrations",
);

const INITIAL_MIGRATION = "001_initial_schema.sql";

export type Migration = {
  filename: string;
  version: string;
  sql: string;
};

export type RunMigrationOptions = {
  pool?: Pool;
  migrationsDir?: string;
};

export type RunMigrationResult = {
  applied: string[];
  skipped: string[];
};

async function tableExists(
  client: PoolClient,
  tableName: string,
): Promise<boolean> {
  const result = await client.query(
    "SELECT to_regclass($1) IS NOT NULL AS exists",
    [`public.${tableName}`],
  );

  return result.rows[0].exists;
}

async function getAppliedMigrations(
  client: PoolClient,
): Promise<Set<string>> {
  if (!(await tableExists(client, "schema_migrations"))) {
    return new Set();
  }

  const result = await client.query<{ version: string }>(
    "SELECT version FROM schema_migrations",
  );

  return new Set(result.rows.map((row) => row.version));
}

async function loadMigrations(
  migrationsDir: string = MIGRATIONS_DIR,
): Promise<Migration[]> {
  const files = (await readdir(migrationsDir))
    .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/i.test(file))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

  if (files.length === 0) {
    throw new Error(
      `No migration files found in ${migrationsDir}`,
    );
  }

  return Promise.all(
    files.map(async (filename) => ({
      filename,
      version: basename(filename, ".sql"),
      sql: await readFile(resolve(migrationsDir, filename), "utf8"),
    })),
  );
}

async function refuseUntrackedExistingSchema(
  client: PoolClient,
): Promise<void> {
  const result = await client.query(`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name IN (
        'users',
        'projects',
        'conversations',
        'tasks',
        'activity_events'
      )
    ORDER BY table_name
  `);

  if (result.rows.length > 0) {
    const names = result.rows
      .map((row: { table_name: string }) => row.table_name)
      .join(", ");

    throw new Error(
      "The initial migration is not recorded, but application tables " +
      `already exist: ${names}. Stopping to protect existing data. ` +
      "Inspect schema_migrations before proceeding.",
    );
  }
}

export async function runMigration(
  options: RunMigrationOptions = {},
): Promise<RunMigrationResult> {
  const databaseUrl = process.env.DATABASE_URL;

  if (!options.pool && !databaseUrl) {
    throw new Error(
      "DATABASE_URL is missing. Check your project .env configuration.",
    );
  }

  const pool =
    options.pool ??
    new Pool({
      connectionString: databaseUrl,
      application_name: "chatledger-migration",
    });

  const client = await pool.connect();
  let lockAcquired = false;
  const appliedList: string[] = [];
  const skippedList: string[] = [];

  try {
    await client.query(
      "SELECT pg_advisory_lock(hashtext('chatledger:migrations'))",
    );
    lockAcquired = true;

    const migrations = await loadMigrations(options.migrationsDir);
    let applied = await getAppliedMigrations(client);

    if (!applied.has("001_initial_schema")) {
      await refuseUntrackedExistingSchema(client);

      const firstMigration = migrations[0];

      if (firstMigration?.filename !== INITIAL_MIGRATION) {
        throw new Error(
          `The first migration must be ${INITIAL_MIGRATION}.`,
        );
      }
    }

    for (const migration of migrations) {
      // Refresh tracking after each migration, including the initial one.
      applied = await getAppliedMigrations(client);

      if (applied.has(migration.version)) {
        console.log(`Skipping ${migration.filename} (already applied).`);
        skippedList.push(migration.version);
        continue;
      }

      console.log(`Applying ${migration.filename}...`);

      if (migration.filename === INITIAL_MIGRATION) {
        // The existing initial migration manages its own transaction
        // and inserts its own schema_migrations record.
        await client.query(migration.sql);

        // Also ensure the migration is recorded if the SQL is adjusted later.
        await client.query(
          `INSERT INTO schema_migrations (version)
           VALUES ($1)
           ON CONFLICT (version) DO NOTHING`,
          [migration.version],
        );
      } else {
        // Future migrations must not include their own BEGIN, COMMIT,
        // or schema_migrations INSERT. The runner handles all three.
        await client.query("BEGIN");

        try {
          await client.query(migration.sql);

          await client.query(
            `INSERT INTO schema_migrations (version)
             VALUES ($1)`,
            [migration.version],
          );

          await client.query("COMMIT");
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        }
      }

      appliedList.push(migration.version);
      console.log(`Applied ${migration.filename} successfully.`);
    }

    console.log("All migrations are up to date.");
    return { applied: appliedList, skipped: skippedList };
  } finally {
    if (lockAcquired) {
      await client.query(
        "SELECT pg_advisory_unlock(hashtext('chatledger:migrations'))",
      );
    }

    client.release();
    if (!options.pool) {
      await pool.end();
    }
  }
}

export const runMigrations = runMigration;

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isMain) {
  runMigration().catch((error: unknown) => {
    console.error("Migration failed:", error);
    process.exitCode = 1;
  });
}