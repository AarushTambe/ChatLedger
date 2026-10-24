
import { pool } from "./db";

let ownerIdPromise: Promise<string> | undefined;

async function loadOwnerId(): Promise<string> {
  const email = process.env.CHATLEDGER_OWNER_EMAIL;
  const name = process.env.CHATLEDGER_OWNER_NAME;

  if (!email || !name) {
    throw new Error(
      "CHATLEDGER_OWNER_EMAIL and CHATLEDGER_OWNER_NAME must be set in .env.",
    );
  }

  const result = await pool.query<{ id: string }>(
    `INSERT INTO users (email, display_name)
     VALUES ($1, $2)
     ON CONFLICT (email)
     DO UPDATE SET display_name = EXCLUDED.display_name
     RETURNING id`,
    [email, name],
  );

  return result.rows[0].id;
}

export function getLocalOwnerId(): Promise<string> {
  ownerIdPromise ??= loadOwnerId().catch((error: unknown) => {
    ownerIdPromise = undefined;
    throw error;
  });

  return ownerIdPromise;
}
