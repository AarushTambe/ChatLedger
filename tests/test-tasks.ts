import { randomUUID } from "node:crypto";
import { pool } from "../services/api/src/db";
import { createProject } from "../services/api/src/projects-repository";
import {
  createTask,
  getTask,
  updateTaskStatus,
} from "../services/api/src/tasks-repository";

async function testTasksRepository() {
  const testId = randomUUID();
  const emailA = `task-test-a-${testId}@example.com`;
  const emailB = `task-test-b-${testId}@example.com`;

  let userA: string | undefined;
  let userB: string | undefined;
  let projectA: string | undefined;
  let taskA: string | undefined;

  try {
    const firstUser = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name)
       VALUES ($1, $2) RETURNING id`,
      [emailA, "Task Test A"],
    );
    userA = firstUser.rows[0].id;

    const secondUser = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name)
       VALUES ($1, $2) RETURNING id`,
      [emailB, "Task Test B"],
    );
    userB = secondUser.rows[0].id;

    const project = await createProject(
      userA,
      `Task Test Project ${testId}`,
    );
    projectA = project.id;

    const task = await createTask(
      userA,
      "Verify task repository",
      projectA,
      "Temporary regression test",
      "high",
    );
    taskA = task.id;

    if (task.status !== "Open" || task.version !== 1) {
      throw new Error("Unexpected initial task state.");
    }
    console.log("PASS: task creation");

    const ownerTask = await getTask(userA, task.id);
    if (!ownerTask || ownerTask.id !== task.id) {
      throw new Error("Owner could not retrieve the task.");
    }

    const otherUserTask = await getTask(userB, task.id);
    if (otherUserTask !== null) {
      throw new Error("Task was visible to another user.");
    }
    console.log("PASS: task retrieval and owner isolation");

    const updated = await updateTaskStatus(
      userA,
      task.id,
      1,
      "In Progress",
    );

    if (updated.status !== "In Progress" || updated.version !== 2) {
      throw new Error("Status update or version increment failed.");
    }

    const events = await pool.query<{
      event_type: string;
      payload: {
        previous_status?: string;
        new_status?: string;
        previous_version?: number;
        new_version?: number;
      };
    }>(
      `SELECT event_type, payload
       FROM activity_events
       WHERE task_id = $1
       ORDER BY occurred_at, id`,
      [task.id],
    );

    if (
      events.rows.length !== 2 ||
      events.rows[0].event_type !== "task.created" ||
      events.rows[1].event_type !== "task.status_changed" ||
      events.rows[1].payload.previous_status !== "Open" ||
      events.rows[1].payload.new_status !== "In Progress" ||
      events.rows[1].payload.previous_version !== 1 ||
      events.rows[1].payload.new_version !== 2
    ) {
      throw new Error("Expected task activity events were not recorded.");
    }
    console.log("PASS: status update and activity history");

    let conflictDetected = false;

    try {
      await updateTaskStatus(userA, task.id, 1, "Done");
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("version conflict")
      ) {
        conflictDetected = true;
      } else {
        throw error;
      }
    }

    if (!conflictDetected) {
      throw new Error("Stale task version was not rejected.");
    }

    const unchanged = await getTask(userA, task.id);
    if (
      !unchanged ||
      unchanged.status !== "In Progress" ||
      unchanged.version !== 2
    ) {
      throw new Error("Stale update changed the task.");
    }
    console.log("PASS: stale update rejected");
  } finally {
    try {
      if (taskA) {
        await pool.query("DELETE FROM tasks WHERE id = $1", [taskA]);
      }
      if (projectA) {
        await pool.query("DELETE FROM projects WHERE id = $1", [projectA]);
      }
      if (userA) {
        await pool.query("DELETE FROM users WHERE id = $1", [userA]);
      }
      if (userB) {
        await pool.query("DELETE FROM users WHERE id = $1", [userB]);
      }
    } finally {
      await pool.end();
    }
  }
}

testTasksRepository().catch((error: unknown) => {
  console.error("Task repository test failed:", error);
  process.exitCode = 1;
});