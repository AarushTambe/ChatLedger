import { pool } from "./db";

export type TaskStatus =
  | "Proposed"
  | "Open"
  | "In Progress"
  | "Blocked"
  | "Done"
  | "Cancelled";

export type TaskPriority = "low" | "medium" | "high" | "urgent";

export type TaskNodeRelationship =
  | "target"
  | "context"
  | "verification"
  | "output";

export interface Task {
  id: string;
  user_id: string;
  project_id: string | null;
  parent_task_id: string | null;
  title: string;
  description: string | null;
  acceptance_criteria: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export interface TaskNodeLink {
  task_id: string;
  node_id: string;
  user_id: string;
  relationship: TaskNodeRelationship;
  created_at: Date;
}

export interface TaskDependency {
  task_id: string;
  depends_on_task_id: string;
  created_at: Date;
}

const validStatuses: TaskStatus[] = [
  "Proposed",
  "Open",
  "In Progress",
  "Blocked",
  "Done",
  "Cancelled",
];

export interface CreateTaskOptions {
  parentTaskId?: string | null;
  acceptanceCriteria?: string | null;
}

export async function createTask(
  userId: string,
  title: string,
  projectId: string | null = null,
  description: string | null = null,
  priority: TaskPriority = "medium",
  options: CreateTaskOptions = {},
): Promise<Task> {
  const cleanTitle = title.trim();

  if (!userId) throw new Error("A user ID is required.");
  if (!cleanTitle) throw new Error("Task title cannot be empty.");

  const parentTaskId = options.parentTaskId ?? null;
  const acceptanceCriteria = options.acceptanceCriteria ?? null;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query<Task>(
      `INSERT INTO tasks (
         user_id,
         project_id,
         parent_task_id,
         title,
         description,
         acceptance_criteria,
         priority
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        userId,
        projectId,
        parentTaskId,
        cleanTitle,
        description,
        acceptanceCriteria,
        priority,
      ],
    );

    const task = result.rows[0];

    await client.query(
      `INSERT INTO activity_events
         (user_id, project_id, task_id, event_type, entity_type, entity_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        userId,
        task.project_id,
        task.id,
        "task.created",
        "task",
        task.id,
        JSON.stringify({
          title: task.title,
          status: task.status,
          parent_task_id: task.parent_task_id,
        }),
      ],
    );

    await client.query("COMMIT");
    return task;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listSubtasks(
  userId: string,
  parentTaskId: string,
): Promise<Task[]> {
  if (!userId) throw new Error("A user ID is required.");
  if (!parentTaskId) throw new Error("A parent task ID is required.");

  const result = await pool.query<Task>(
    `SELECT *
     FROM tasks
     WHERE user_id = $1 AND parent_task_id = $2
     ORDER BY created_at ASC`,
    [userId, parentTaskId],
  );

  return result.rows;
}

export async function linkTaskToNode(
  userId: string,
  taskId: string,
  nodeId: string,
  relationship: TaskNodeRelationship = "target",
): Promise<TaskNodeLink> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query<TaskNodeLink>(
      `INSERT INTO task_nodes (task_id, node_id, user_id, relationship)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (task_id, node_id)
       DO UPDATE SET relationship = EXCLUDED.relationship
       RETURNING *`,
      [taskId, nodeId, userId, relationship],
    );

    const link = result.rows[0];

    const taskRow = await client.query<{ project_id: string | null }>(
      "SELECT project_id FROM tasks WHERE id = $1 AND user_id = $2",
      [taskId, userId],
    );

    await client.query(
      `INSERT INTO activity_events
         (user_id, project_id, task_id, event_type, entity_type, entity_id, payload)
       VALUES ($1, $2, $3, 'task.node_linked', 'task', $3, $4::jsonb)`,
      [
        userId,
        taskRow.rows[0]?.project_id ?? null,
        taskId,
        JSON.stringify({
          node_id: nodeId,
          relationship: link.relationship,
        }),
      ],
    );

    await client.query("COMMIT");
    return link;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function unlinkTaskFromNode(
  userId: string,
  taskId: string,
  nodeId: string,
): Promise<boolean> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const delResult = await client.query(
      `DELETE FROM task_nodes
       WHERE user_id = $1 AND task_id = $2 AND node_id = $3`,
      [userId, taskId, nodeId],
    );

    if ((delResult.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return false;
    }

    const taskRow = await client.query<{ project_id: string | null }>(
      "SELECT project_id FROM tasks WHERE id = $1 AND user_id = $2",
      [taskId, userId],
    );

    await client.query(
      `INSERT INTO activity_events
         (user_id, project_id, task_id, event_type, entity_type, entity_id, payload)
       VALUES ($1, $2, $3, 'task.node_unlinked', 'task', $3, $4::jsonb)`,
      [
        userId,
        taskRow.rows[0]?.project_id ?? null,
        taskId,
        JSON.stringify({ node_id: nodeId }),
      ],
    );

    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getTaskNodes(
  userId: string,
  taskId: string,
): Promise<TaskNodeLink[]> {
  const result = await pool.query<TaskNodeLink>(
    `SELECT *
     FROM task_nodes
     WHERE user_id = $1 AND task_id = $2
     ORDER BY created_at ASC`,
    [userId, taskId],
  );

  return result.rows;
}

export async function getNodeTasks(
  userId: string,
  nodeId: string,
): Promise<Task[]> {
  const result = await pool.query<Task>(
    `SELECT t.*
     FROM tasks t
     INNER JOIN task_nodes tn ON tn.task_id = t.id AND tn.user_id = t.user_id
     WHERE tn.user_id = $1 AND tn.node_id = $2
     ORDER BY t.created_at DESC`,
    [userId, nodeId],
  );

  return result.rows;
}

export async function addTaskDependency(
  userId: string,
  taskId: string,
  dependsOnTaskId: string,
): Promise<TaskDependency> {
  if (!userId) throw new Error("A user ID is required.");
  if (!taskId || !dependsOnTaskId) {
    throw new Error("Both taskId and dependsOnTaskId are required.");
  }
  if (taskId === dependsOnTaskId) {
    throw new Error("A task cannot depend on itself.");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('task_dependencies'), hashtext($1))",
      [userId],
    );

    const tasksCheck = await client.query<{
      id: string;
      project_id: string | null;
    }>(
      `SELECT id, project_id
       FROM tasks
       WHERE user_id = $1 AND id IN ($2, $3)`,
      [userId, taskId, dependsOnTaskId],
    );

    if (tasksCheck.rowCount !== 2) {
      throw new Error("Both tasks must exist and belong to the current user.");
    }

    const cycleCheck = await client.query<{ cycle: boolean }>(
      `WITH RECURSIVE prereqs AS (
         SELECT td.depends_on_task_id AS id
         FROM task_dependencies td
         WHERE td.task_id = $1
         UNION
         SELECT td2.depends_on_task_id AS id
         FROM task_dependencies td2
         INNER JOIN prereqs p ON td2.task_id = p.id
       )
       SELECT EXISTS (
         SELECT 1 FROM prereqs WHERE id = $2
       ) AS cycle`,
      [dependsOnTaskId, taskId],
    );

    if (cycleCheck.rows[0]?.cycle) {
      throw new Error(
        "Circular task dependency detected: prerequisite already depends on this task.",
      );
    }

    const insertResult = await client.query<TaskDependency>(
      `INSERT INTO task_dependencies (task_id, depends_on_task_id)
       VALUES ($1, $2)
       ON CONFLICT (task_id, depends_on_task_id) DO UPDATE
       SET task_id = EXCLUDED.task_id
       RETURNING *`,
      [taskId, dependsOnTaskId],
    );

    const dep = insertResult.rows[0];
    const mainTask = tasksCheck.rows.find((r) => r.id === taskId);

    await client.query(
      `INSERT INTO activity_events
         (user_id, project_id, task_id, event_type, entity_type, entity_id, payload)
       VALUES ($1, $2, $3, 'task.dependency_added', 'task', $3, $4::jsonb)`,
      [
        userId,
        mainTask?.project_id ?? null,
        taskId,
        JSON.stringify({ depends_on_task_id: dependsOnTaskId }),
      ],
    );

    await client.query("COMMIT");
    return dep;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listTaskDependencies(
  userId: string,
  taskId: string,
): Promise<Task[]> {
  const result = await pool.query<Task>(
    `SELECT t.*
     FROM tasks t
     INNER JOIN task_dependencies td ON td.depends_on_task_id = t.id
     WHERE td.task_id = $1
       AND t.user_id = $2
     ORDER BY td.created_at ASC`,
    [taskId, userId],
  );

  return result.rows;
}

export async function getTask(
  userId: string,
  taskId: string,
): Promise<Task | null> {
  const result = await pool.query<Task>(
    `SELECT *
     FROM tasks
     WHERE id = $1 AND user_id = $2`,
    [taskId, userId],
  );

  return result.rows[0] ?? null;
}

export async function updateTaskStatus(
  userId: string,
  taskId: string,
  expectedVersion: number,
  newStatus: TaskStatus,
): Promise<Task> {
  if (!validStatuses.includes(newStatus)) {
    throw new Error("Invalid task status.");
  }

  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new Error("A valid expected task version is required.");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const currentResult = await client.query<{
      status: TaskStatus;
      version: number;
    }>(
      `SELECT status, version
       FROM tasks
       WHERE id = $1 AND user_id = $2
       FOR UPDATE`,
      [taskId, userId],
    );

    if (currentResult.rowCount === 0) {
      throw new Error("Task not found for this user.");
    }

    const current = currentResult.rows[0];

    if (current.version !== expectedVersion) {
      throw new Error(
        "Task version conflict: reload the task before updating it.",
      );
    }

    const result = await client.query<Task>(
      `UPDATE tasks
       SET status = $1,
           version = version + 1,
           updated_at = NOW()
       WHERE id = $2
         AND user_id = $3
         AND version = $4
       RETURNING *`,
      [newStatus, taskId, userId, expectedVersion],
    );

    const task = result.rows[0];

    await client.query(
      `INSERT INTO activity_events
         (user_id, project_id, task_id, event_type,
          entity_type, entity_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        userId,
        task.project_id,
        task.id,
        "task.status_changed",
        "task",
        task.id,
        JSON.stringify({
          previous_status: current.status,
          new_status: task.status,
          previous_version: current.version,
          new_version: task.version,
        }),
      ],
    );

    await client.query("COMMIT");
    return task;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listTasks(
  userId: string,
  projectId?: string,
): Promise<Task[]> {
  if (!userId) {
    throw new Error("A user ID is required.");
  }

  const result = projectId
    ? await pool.query<Task>(
        `SELECT *
         FROM tasks
         WHERE user_id = $1 AND project_id = $2
         ORDER BY created_at DESC`,
        [userId, projectId],
      )
    : await pool.query<Task>(
        `SELECT *
         FROM tasks
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [userId],
      );

  return result.rows;
}