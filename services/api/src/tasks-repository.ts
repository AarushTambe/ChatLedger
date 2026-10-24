
import { pool } from "./db";

export type TaskStatus =
  | "Proposed"
  | "Open"
  | "In Progress"
  | "Blocked"
  | "Done"
  | "Cancelled";

export type TaskPriority = "low" | "medium" | "high" | "urgent";

export interface Task {
  id: string;
  user_id: string;
  project_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_at: Date | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

const validStatuses: TaskStatus[] = [
  "Proposed",
  "Open",
  "In Progress",
  "Blocked",
  "Done",
  "Cancelled",
];

export async function createTask(
  userId: string,
  title: string,
  projectId: string | null = null,
  description: string | null = null,
  priority: TaskPriority = "medium",
): Promise<Task> {
  const cleanTitle = title.trim();

  if (!userId) throw new Error("A user ID is required.");
  if (!cleanTitle) throw new Error("Task title cannot be empty.");

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query<Task>(
      `INSERT INTO tasks (user_id, project_id, title, description, priority)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, projectId, cleanTitle, description, priority],
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
        JSON.stringify({ title: task.title, status: task.status }),
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

    // Lock the task row while checking and updating its state.
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

