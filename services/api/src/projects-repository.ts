import { pool } from "./db";
import type { ProjectNode } from "./nodes-repository";

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

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const projectResult = await client.query<Project>(
      `INSERT INTO projects (user_id, name, description)
       VALUES ($1, $2, $3)
       RETURNING id, user_id, name, description, created_at, updated_at`,
      [userId, cleanName, description],
    );

    const project = projectResult.rows[0];

    const rootNodeResult = await client.query<ProjectNode>(
      `INSERT INTO project_nodes (
         user_id,
         project_id,
         parent_id,
         node_type,
         name,
         relative_path,
         description,
         lifecycle_state,
         sort_order,
         metadata
       )
       VALUES ($1, $2, NULL, 'folder', $3, '', 'Logical project root folder', 'planned', 0, '{"is_root": true}'::jsonb)
       RETURNING *`,
      [userId, project.id, cleanName],
    );

    const rootNode = rootNodeResult.rows[0];

    await client.query(
      `INSERT INTO activity_events
         (user_id, project_id, event_type, entity_type, entity_id, payload)
       VALUES
         ($1, $2, 'project.created', 'project', $2, $3::jsonb),
         ($1, $2, 'node.created', 'node', $4, $5::jsonb)`,
      [
        userId,
        project.id,
        JSON.stringify({
          name: project.name,
          root_node_id: rootNode.id,
        }),
        rootNode.id,
        JSON.stringify({
          name: rootNode.name,
          node_type: rootNode.node_type,
          lifecycle_state: rootNode.lifecycle_state,
          is_root: true,
        }),
      ],
    );

    await client.query("COMMIT");
    return project;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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