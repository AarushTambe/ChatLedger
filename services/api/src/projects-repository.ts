
import { pool } from "./db";

export interface Project {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function createProject(
  userId: string,
  name: string,
  description: string | null = null,
): Promise<Project> {
  const cleanName = name.trim();

  if (!userId) {
    throw new Error("A user ID is required.");
  }

  if (!cleanName) {
    throw new Error("Project name cannot be empty.");
  }

  const result = await pool.query<Project>(
    `INSERT INTO projects (user_id, name, description)
     VALUES ($1, $2, $3)
     RETURNING id, user_id, name, description, created_at, updated_at`,
    [userId, cleanName, description],
  );

  return result.rows[0];
}

export async function listProjects(
  userId: string,
): Promise<Project[]> {
  if (!userId) {
    throw new Error("A user ID is required.");
  }

  const result = await pool.query<Project>(
    `SELECT id, user_id, name, description, created_at, updated_at
     FROM projects
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId],
  );

  return result.rows;
}
