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

export interface ProjectTreeNode extends ProjectNode {
  depth: number;
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

export interface UpdateNodeInput {
  userId: string;
  nodeId: string;
  expectedVersion: number;
  name?: string;
  nodeType?: NodeType;
  relativePath?: string | null;
  description?: string | null;
  lifecycleState?: Exclude<NodeLifecycleState, "archived">;
  sortOrder?: number;
  metadata?: Record<string, unknown>;
  sourceConversationId?: string | null;
}

export interface MoveNodeInput {
  userId: string;
  nodeId: string;
  expectedVersion: number;
  newParentId: string;
  newSortOrder?: number;
}

export interface TreeQueryOptions {
  maxDepth?: number;
  includeArchived?: boolean;
}

const validNodeTypes: NodeType[] = [
  "folder",
  "subsystem",
  "file",
  "specification",
  "artifact",
];

const validActiveLifecycleStates: Exclude<NodeLifecycleState, "archived">[] = [
  "planned",
  "present",
  "modified",
  "missing",
];

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
  if (!validNodeTypes.includes(input.nodeType)) {
    throw new Error("Invalid node type.");
  }

  const lifecycleState = input.lifecycleState ?? "planned";
  if (!validActiveLifecycleStates.includes(lifecycleState)) {
    throw new Error("Invalid initial node lifecycle state.");
  }

  const sortOrder = input.sortOrder ?? 0;
  const metadata = input.metadata ?? {};

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const parentCheck = await client.query<{
      lifecycle_state: NodeLifecycleState;
    }>(
      `SELECT lifecycle_state
       FROM project_nodes
       WHERE id = $1 AND project_id = $2 AND user_id = $3`,
      [input.parentId, input.projectId, input.userId],
    );

    if (parentCheck.rowCount === 0) {
      throw new Error("Parent node not found in this project.");
    }

    if (parentCheck.rows[0].lifecycle_state === "archived") {
      throw new Error("Cannot create a child under an archived node.");
    }

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
          relative_path: node.relative_path,
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

export async function updateNode(
  input: UpdateNodeInput,
): Promise<ProjectNode> {
  if (!input.userId) throw new Error("A user ID is required.");
  if (!input.nodeId) throw new Error("A node ID is required.");
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new Error("A valid expected node version is required.");
  }

  if (input.nodeType !== undefined && !validNodeTypes.includes(input.nodeType)) {
    throw new Error("Invalid node type.");
  }

  if (
    input.lifecycleState !== undefined &&
    !validActiveLifecycleStates.includes(input.lifecycleState)
  ) {
    throw new Error(
      "Invalid lifecycle state for updateNode (use archiveNode to archive).",
    );
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const currentResult = await client.query<ProjectNode>(
      `SELECT *
       FROM project_nodes
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [input.nodeId, input.userId],
    );

    if (currentResult.rowCount === 0) {
      throw new Error("Node not found for this user.");
    }

    const current = currentResult.rows[0];

    if (current.version !== input.expectedVersion) {
      throw new Error(
        "Node version conflict: reload the node before updating.",
      );
    }

    if (current.lifecycle_state === "archived") {
      throw new Error("Cannot update an archived node.");
    }

    const nextName =
      input.name !== undefined ? input.name.trim() : current.name;
    if (!nextName) {
      throw new Error("Node name cannot be empty.");
    }

    const nextNodeType = input.nodeType ?? current.node_type;
    if (current.parent_id === null && nextNodeType !== "folder") {
      throw new Error("Project root node must remain of type 'folder'.");
    }

    const nextRelativePath =
      input.relativePath !== undefined
        ? input.relativePath
        : current.relative_path;
    const nextDescription =
      input.description !== undefined ? input.description : current.description;
    const nextLifecycleState =
      input.lifecycleState ?? current.lifecycle_state;
    const nextSortOrder = input.sortOrder ?? current.sort_order;
    const nextMetadata = input.metadata ?? current.metadata;
    const nextSourceConversationId =
      input.sourceConversationId !== undefined
        ? input.sourceConversationId
        : current.source_conversation_id;

    const updatedResult = await client.query<ProjectNode>(
      `UPDATE project_nodes
       SET name = $1,
           node_type = $2,
           relative_path = $3,
           description = $4,
           lifecycle_state = $5,
           sort_order = $6,
           metadata = $7::jsonb,
           source_conversation_id = $8,
           version = version + 1,
           updated_at = NOW()
       WHERE id = $9
         AND user_id = $10
         AND version = $11
       RETURNING *`,
      [
        nextName,
        nextNodeType,
        nextRelativePath,
        nextDescription,
        nextLifecycleState,
        nextSortOrder,
        JSON.stringify(nextMetadata),
        nextSourceConversationId,
        input.nodeId,
        input.userId,
        input.expectedVersion,
      ],
    );

    const updated = updatedResult.rows[0];

    await client.query(
      `INSERT INTO activity_events
         (user_id, project_id, conversation_id, event_type, entity_type, entity_id, payload)
       VALUES ($1, $2, $3, 'node.updated', 'node', $4, $5::jsonb)`,
      [
        input.userId,
        updated.project_id,
        updated.source_conversation_id,
        updated.id,
        JSON.stringify({
          previous_version: current.version,
          new_version: updated.version,
          previous_name: current.name,
          new_name: updated.name,
          previous_lifecycle_state: current.lifecycle_state,
          new_lifecycle_state: updated.lifecycle_state,
          relative_path: updated.relative_path,
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

export async function moveNode(
  input: MoveNodeInput,
): Promise<ProjectNode> {
  if (!input.userId) throw new Error("A user ID is required.");
  if (!input.nodeId) throw new Error("A node ID is required.");
  if (!input.newParentId) throw new Error("A target parent ID is required.");
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
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
      [input.nodeId, input.userId],
    );

    if (currentResult.rowCount === 0) {
      throw new Error("Node not found for this user.");
    }

    const current = currentResult.rows[0];

    if (current.parent_id === null) {
      throw new Error("Cannot move the project root node.");
    }

    if (current.lifecycle_state === "archived") {
      throw new Error("Cannot move an archived node.");
    }

    if (current.version !== input.expectedVersion) {
      throw new Error(
        "Node version conflict: reload the node before moving.",
      );
    }

    const targetParentResult = await client.query<ProjectNode>(
      `SELECT *
       FROM project_nodes
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [input.newParentId, input.userId],
    );

    if (targetParentResult.rowCount === 0) {
      throw new Error("Target parent node not found for this user.");
    }

    const targetParent = targetParentResult.rows[0];

    if (targetParent.project_id !== current.project_id) {
      throw new Error("Cannot move a node to a parent in a different project.");
    }

    if (targetParent.lifecycle_state === "archived") {
      throw new Error("Cannot move a node under an archived parent.");
    }

    const nextSortOrder = input.newSortOrder ?? current.sort_order;

    const updatedResult = await client.query<ProjectNode>(
      `UPDATE project_nodes
       SET parent_id = $1,
           sort_order = $2,
           version = version + 1,
           updated_at = NOW()
       WHERE id = $3
         AND user_id = $4
         AND version = $5
       RETURNING *`,
      [
        input.newParentId,
        nextSortOrder,
        input.nodeId,
        input.userId,
        input.expectedVersion,
      ],
    );

    const updated = updatedResult.rows[0];

    await client.query(
      `INSERT INTO activity_events
         (user_id, project_id, event_type, entity_type, entity_id, payload)
       VALUES ($1, $2, 'node.moved', 'node', $3, $4::jsonb)`,
      [
        input.userId,
        updated.project_id,
        updated.id,
        JSON.stringify({
          previous_parent_id: current.parent_id,
          new_parent_id: updated.parent_id,
          previous_sort_order: current.sort_order,
          new_sort_order: updated.sort_order,
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

export async function getProjectTree(
  userId: string,
  projectId: string,
  options: TreeQueryOptions = {},
): Promise<ProjectTreeNode[]> {
  const maxDepth = options.maxDepth ?? 10;
  const includeArchived = options.includeArchived ?? false;

  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 50) {
    throw new Error("maxDepth must be an integer between 0 and 50.");
  }

  const result = await pool.query<ProjectTreeNode>(
    `WITH RECURSIVE tree AS (
       SELECT pn.*, 0 AS depth
       FROM project_nodes pn
       WHERE pn.user_id = $1
         AND pn.project_id = $2
         AND pn.parent_id IS NULL
       UNION ALL
       SELECT child.*, tree.depth + 1 AS depth
       FROM project_nodes child
       INNER JOIN tree ON child.parent_id = tree.id
       WHERE child.user_id = $1
         AND child.project_id = $2
         AND tree.depth < $3
         AND ($4::boolean = true OR child.lifecycle_state <> 'archived')
     )
     SELECT *
     FROM tree
     ORDER BY depth ASC, sort_order ASC, name ASC`,
    [userId, projectId, maxDepth, includeArchived],
  );

  return result.rows;
}

export async function getSubtree(
  userId: string,
  nodeId: string,
  options: TreeQueryOptions = {},
): Promise<ProjectTreeNode[]> {
  const maxDepth = options.maxDepth ?? 10;
  const includeArchived = options.includeArchived ?? false;

  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 50) {
    throw new Error("maxDepth must be an integer between 0 and 50.");
  }

  const result = await pool.query<ProjectTreeNode>(
    `WITH RECURSIVE subtree AS (
       SELECT pn.*, 0 AS depth
       FROM project_nodes pn
       WHERE pn.id = $1
         AND pn.user_id = $2
       UNION ALL
       SELECT child.*, subtree.depth + 1 AS depth
       FROM project_nodes child
       INNER JOIN subtree ON child.parent_id = subtree.id
       WHERE child.user_id = $2
         AND subtree.depth < $3
         AND ($4::boolean = true OR child.lifecycle_state <> 'archived')
     )
     SELECT *
     FROM subtree
     ORDER BY depth ASC, sort_order ASC, name ASC`,
    [nodeId, userId, maxDepth, includeArchived],
  );

  return result.rows;
}