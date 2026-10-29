import { pool } from "./db";

export type NodeType =
  | "folder"
  | "subsystem"
  | "file"
  | "specification"
  | "artifact";

export type NodeLifecycleState =
  | "planned"
  | "present"
  | "modified"
  | "missing"
  | "archived";

export interface ProjectNode {
  id: string;
  user_id: string;
  project_id: string;
  parent_id: string | null;
  node_type: NodeType;
  name: string;
  relative_path: string | null;
  description: string | null;
  lifecycle_state: NodeLifecycleState;
  sort_order: number;
  metadata: Record<string, unknown>;
  source_conversation_id: string | null;
  version: number;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

export interface CreateNodeInput {
  userId: string;
  projectId: string;
  parentId: string;
  nodeType: NodeType;
  name: string;
  relativePath?: string | null;
  description?: string | null;
  lifecycleState?: Exclude<NodeLifecycleState, "archived">;
  sortOrder?: number;
  metadata?: Record<string, unknown>;
  sourceConversationId?: string | null;
}

export async function getProjectRootNode(
  userId: string,
  projectId: string,
): Promise<ProjectNode | null> {
  const result = await pool.query<ProjectNode>(
    `SELECT *
     FROM project_nodes
     WHERE user_id = $1
       AND project_id = $2
       AND parent_id IS NULL`,
    [userId, projectId],
  );

  return result.rows[0] ?? null;
}

export async function getNode(
  userId: string,
  nodeId: string,
): Promise<ProjectNode | null> {
  const result = await pool.query<ProjectNode>(
    `SELECT *
     FROM project_nodes
     WHERE id = $1 AND user_id = $2`,
    [nodeId, userId],
  );

  return result.rows[0] ?? null;
}

export async function createNode(
  input: CreateNodeInput,
): Promise<ProjectNode> {
  const cleanName = input.name.trim();
  if (!input.userId) throw new Error("A user ID is required.");
  if (!input.projectId) throw new Error("A project ID is required.");
  if (!input.parentId) {
    throw new Error("A parent node ID is required for non-root nodes.");
  }
  if (!cleanName) throw new Error("Node name cannot be empty.");

  const lifecycleState = input.lifecycleState ?? "planned";
  const sortOrder = input.sortOrder ?? 0;
  const metadata = input.metadata ?? {};

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query<ProjectNode>(
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
         metadata,
         source_conversation_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
       RETURNING *`,
      [
        input.userId,
        input.projectId,
        input.parentId,
        input.nodeType,
        cleanName,
        input.relativePath ?? null,
        input.description ?? null,
        lifecycleState,
        sortOrder,
        JSON.stringify(metadata),
        input.sourceConversationId ?? null,
      ],
    );

    const node = result.rows[0];

    await client.query(
      `INSERT INTO activity_events
         (user_id, project_id, conversation_id, event_type, entity_type, entity_id, payload)
       VALUES ($1, $2, $3, 'node.created', 'node', $4, $5::jsonb)`,
      [
        input.userId,
        node.project_id,
        node.source_conversation_id,
        node.id,
        JSON.stringify({
          name: node.name,
          parent_id: node.parent_id,
          node_type: node.node_type,
          lifecycle_state: node.lifecycle_state,
        }),
      ],
    );

    await client.query("COMMIT");
    return node;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function archiveNode(
  userId: string,
  nodeId: string,
  expectedVersion: number,
): Promise<ProjectNode> {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new Error("A valid expected node version is required.");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const currentResult = await client.query<ProjectNode>(
      `SELECT *
       FROM project_nodes
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [nodeId, userId],
    );

    if (currentResult.rowCount === 0) {
      throw new Error("Node not found for this user.");
    }

    const current = currentResult.rows[0];

    if (current.parent_id === null) {
      throw new Error("Cannot archive the project root node.");
    }

    if (current.version !== expectedVersion) {
      throw new Error("Node version conflict: reload the node before updating.");
    }

    const updatedResult = await client.query<ProjectNode>(
      `UPDATE project_nodes
       SET lifecycle_state = 'archived',
           archived_at = COALESCE(archived_at, NOW()),
           version = version + 1,
           updated_at = NOW()
       WHERE id = $1 AND user_id = $2 AND version = $3
       RETURNING *`,
      [nodeId, userId, expectedVersion],
    );

    const updated = updatedResult.rows[0];

    await client.query(
      `INSERT INTO activity_events
         (user_id, project_id, event_type, entity_type, entity_id, payload)
       VALUES ($1, $2, 'node.archived', 'node', $3, $4::jsonb)`,
      [
        userId,
        updated.project_id,
        updated.id,
        JSON.stringify({
          previous_lifecycle_state: current.lifecycle_state,
          new_lifecycle_state: updated.lifecycle_state,
          previous_version: current.version,
          new_version: updated.version,
        }),
      ],
    );

    await client.query("COMMIT");
    return updated;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listChildNodes(
  userId: string,
  projectId: string,
  parentId: string,
  includeArchived = false,
): Promise<ProjectNode[]> {
  const result = await pool.query<ProjectNode>(
    `SELECT *
     FROM project_nodes
     WHERE user_id = $1
       AND project_id = $2
       AND parent_id = $3
       AND ($4::boolean = true OR lifecycle_state <> 'archived')
     ORDER BY sort_order ASC, name ASC`,
    [userId, projectId, parentId, includeArchived],
  );

  return result.rows;
}