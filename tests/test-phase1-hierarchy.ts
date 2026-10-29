import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pool } from "../services/api/src/db";
import {
  archiveNode,
  createNode,
  getProjectRootNode,
  listChildNodes,
} from "../services/api/src/nodes-repository";
import { createProject } from "../services/api/src/projects-repository";
import { runMigration } from "../services/api/src/run-migration";
import {
  createTask,
  getTaskNodes,
  linkTaskToNode,
} from "../services/api/src/tasks-repository";

async function expectReject(
  fn: () => Promise<unknown>,
  description: string,
): Promise<void> {
  let failed = false;
  try {
    await fn();
  } catch {
    failed = true;
  }
  if (!failed) {
    throw new Error(`Expected failure did not occur: ${description}`);
  }
}

async function testPhase1Hierarchy() {
  const testId = randomUUID();
  let userA: string | undefined;
  let userB: string | undefined;

  try {
    // 1. Run migrations (including 003 triggers) and verify idempotency
    await runMigration({ pool });
    const secondRun = await runMigration({ pool });
    if (
      secondRun.applied.length !== 0 ||
      !secondRun.skipped.includes("001_initial_schema") ||
      !secondRun.skipped.includes("002_filesystem_and_task_hierarchy") ||
      !secondRun.skipped.includes("003_hierarchy_and_deletion_triggers")
    ) {
      throw new Error("Repeat migration execution was not idempotent.");
    }
    console.log("PASS: migration runner idempotency");

    // 2. Verify migration failure rollback leaves schema_migrations untouched
    const tempDir = await mkdtemp(join(tmpdir(), "chatledger-mig-test-"));
    try {
      const badMigrationName = `999_simulated_failure.sql`;
      await writeFile(
        join(tempDir, badMigrationName),
        `CREATE TABLE temp_should_rollback_${testId.replaceAll("-", "_")} (id INT);
         SELECT 1 / 0;`,
        "utf8",
      );

      await expectReject(
        () => runMigration({ pool, migrationsDir: tempDir }),
        "failing migration should reject and rollback",
      );

      const checkLedger = await pool.query(
        "SELECT 1 FROM schema_migrations WHERE version = '999_simulated_failure'",
      );
      if (checkLedger.rowCount !== 0) {
        throw new Error("Failed migration was recorded in schema_migrations.");
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
    console.log("PASS: migration failure rollback");

    // 3. Create isolated test users
    const resUserA = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name)
       VALUES ($1, $2) RETURNING id`,
      [`phase1-a-${testId}@example.com`, "Phase 1 User A"],
    );
    userA = resUserA.rows[0].id;

    const resUserB = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name)
       VALUES ($1, $2) RETURNING id`,
      [`phase1-b-${testId}@example.com`, "Phase 1 User B"],
    );
    userB = resUserB.rows[0].id;

    // 4. Atomic createProject and root node invariants
    const projectA1 = await createProject(
      userA,
      `Project A1 ${testId}`,
      "Testing atomic root creation",
    );
    const projectA2 = await createProject(
      userA,
      `Project A2 ${testId}`,
      "Second project for cross-project scope tests",
    );
    const projectB1 = await createProject(
      userB,
      `Project B1 ${testId}`,
      "User B project",
    );

    const rootA1 = await getProjectRootNode(userA, projectA1.id);
    const rootA2 = await getProjectRootNode(userA, projectA2.id);
    const rootB1 = await getProjectRootNode(userB, projectB1.id);

    if (
      !rootA1 ||
      rootA1.parent_id !== null ||
      rootA1.node_type !== "folder" ||
      rootA1.lifecycle_state !== "planned"
    ) {
      throw new Error("Atomic createProject did not create a valid planned root node.");
    }

    // Cannot create a second root node for the same project
    await expectReject(
      () =>
        pool.query(
          `INSERT INTO project_nodes (user_id, project_id, parent_id, node_type, name, lifecycle_state)
           VALUES ($1, $2, NULL, 'folder', 'Second Root', 'planned')`,
          [userA, projectA1.id],
        ),
      "second root node in same project",
    );

    // Cannot archive or delete the root node while project exists
    await expectReject(
      () => archiveNode(userA!, rootA1.id, rootA1.version),
      "archiving root node",
    );
    await expectReject(
      () => pool.query("DELETE FROM project_nodes WHERE id = $1", [rootA1.id]),
      "deleting root node while project exists",
    );
    console.log("PASS: atomic createProject and root node invariants");

    // 5. Filesystem hierarchy, sibling uniqueness, archival reuse, and cycle prevention
    const backendNode = await createNode({
      userId: userA,
      projectId: projectA1.id,
      parentId: rootA1.id,
      nodeType: "subsystem",
      name: "Backend",
      relativePath: "services/api",
    });

    const apiFolder = await createNode({
      userId: userA,
      projectId: projectA1.id,
      parentId: backendNode.id,
      nodeType: "folder",
      name: "src",
      relativePath: "services/api/src",
    });

    const serverFile = await createNode({
      userId: userA,
      projectId: projectA1.id,
      parentId: apiFolder.id,
      nodeType: "file",
      name: "server.ts",
      relativePath: "services/api/src/server.ts",
    });

    // Duplicate active sibling name (case-insensitive) must fail
    await expectReject(
      () =>
        createNode({
          userId: userA!,
          projectId: projectA1.id,
          parentId: apiFolder.id,
          nodeType: "file",
          name: "SERVER.TS",
        }),
      "duplicate active sibling name",
    );

    // Archiving the sibling frees the name for reuse
    const archivedServer = await archiveNode(
      userA,
      serverFile.id,
      serverFile.version,
    );
    if (
      archivedServer.lifecycle_state !== "archived" ||
      !archivedServer.archived_at
    ) {
      throw new Error("Node archival did not set archived state and timestamp.");
    }

    const replacementServer = await createNode({
      userId: userA,
      projectId: projectA1.id,
      parentId: apiFolder.id,
      nodeType: "file",
      name: "server.ts",
      relativePath: "services/api/src/server.ts",
      lifecycleState: "present",
    });

    const activeChildren = await listChildNodes(
      userA,
      projectA1.id,
      apiFolder.id,
      false,
    );
    if (
      activeChildren.length !== 1 ||
      activeChildren[0].id !== replacementServer.id
    ) {
      throw new Error("listChildNodes did not filter archived nodes properly.");
    }

    // Cross-project and cross-user parent assignment must fail
    await expectReject(
      () =>
        createNode({
          userId: userA!,
          projectId: projectA1.id,
          parentId: rootA2!.id,
          nodeType: "folder",
          name: "CrossProjectInvalid",
        }),
      "cross-project parent_id",
    );
    await expectReject(
      () =>
        createNode({
          userId: userA!,
          projectId: projectA1.id,
          parentId: rootB1!.id,
          nodeType: "folder",
          name: "CrossUserInvalid",
        }),
      "cross-user parent_id",
    );

    // Cycle check: moving backendNode under replacementServer (its own descendant) must fail
    await expectReject(
      () =>
        pool.query(
          "UPDATE project_nodes SET parent_id = $1 WHERE id = $2",
          [replacementServer.id, backendNode.id],
        ),
      "node hierarchy cycle",
    );
    console.log("PASS: node hierarchy, sibling uniqueness, archival reuse, and cycle guard");

    // 6. Task hierarchy, nullable project scope matching, and cycle guard
    const parentTask = await createTask(
      userA,
      "Implement Phase 1",
      projectA1.id,
      "Parent task",
      "high",
      { acceptanceCriteria: "All Phase 1 tests pass" },
    );

    const subTask = await createTask(
      userA,
      "Write migration 002",
      projectA1.id,
      "Subtask",
      "high",
      { parentTaskId: parentTask.id },
    );

    if (subTask.parent_task_id !== parentTask.id) {
      throw new Error("Subtask parent_task_id was not persisted.");
    }

    // Unassigned parent + unassigned subtask (both project_id = NULL) must succeed
    const unassignedParent = await createTask(
      userA,
      "Unassigned Parent",
      null,
    );
    const unassignedChild = await createTask(
      userA,
      "Unassigned Subtask",
      null,
      null,
      "medium",
      { parentTaskId: unassignedParent.id },
    );
    if (unassignedChild.parent_task_id !== unassignedParent.id) {
      throw new Error("Unassigned parent/subtask hierarchy failed.");
    }

    // Mismatched project scope (parent in projectA1, child in NULL or projectA2) must fail
    await expectReject(
      () =>
        createTask(userA!, "Mismatched NULL child", null, null, "medium", {
          parentTaskId: parentTask.id,
        }),
      "subtask with NULL project_id under project-assigned parent",
    );
    await expectReject(
      () =>
        createTask(
          userA!,
          "Mismatched Project A2 child",
          projectA2.id,
          null,
          "medium",
          { parentTaskId: parentTask.id },
        ),
      "subtask in Project A2 under Project A1 parent",
    );

    // Task cycle check: setting parentTask.parent_task_id = subTask.id must fail
    await expectReject(
      () =>
        pool.query("UPDATE tasks SET parent_task_id = $1 WHERE id = $2", [
          subTask.id,
          parentTask.id,
        ]),
      "task hierarchy cycle",
    );
    console.log("PASS: task hierarchy, nullable project scope matching, and cycle guard");

    // 7. task_nodes associations and scope validation
    const link = await linkTaskToNode(
      userA,
      subTask.id,
      replacementServer.id,
      "target",
    );
    const links = await getTaskNodes(userA, subTask.id);
    if (links.length !== 1 || links[0].node_id !== link.node_id) {
      throw new Error("Task-to-node link was not retrieved.");
    }

    // Linking unassigned task or wrong-project task to a node must fail
    await expectReject(
      () => linkTaskToNode(userA!, unassignedParent.id, replacementServer.id),
      "linking unassigned task to project node",
    );
    const taskInA2 = await createTask(userA, "Task in A2", projectA2.id);
    await expectReject(
      () => linkTaskToNode(userA!, taskInA2.id, replacementServer.id),
      "linking task from Project A2 to node in Project A1",
    );
    console.log("PASS: task_nodes association integrity");

    // 8. Deletion policies
    // 8a. Deleting a non-root node with children is restricted
    await expectReject(
      () =>
        pool.query("DELETE FROM project_nodes WHERE id = $1", [backendNode.id]),
      "deleting non-root node that still has children",
    );

    // 8b. Deleting a parent task with subtasks is restricted
    await expectReject(
      () => pool.query("DELETE FROM tasks WHERE id = $1", [parentTask.id]),
      "deleting parent task that still has subtasks",
    );

    // 8c. Deleting a project while tasks still reference it is restricted
    await expectReject(
      () => pool.query("DELETE FROM projects WHERE id = $1", [projectA1.id]),
      "deleting project that still has tasks",
    );

    // 8d. Once tasks are deleted from projectA2, deleting projectA2 with a multi-level node tree succeeds
    const childA2 = await createNode({
      userId: userA,
      projectId: projectA2.id,
      parentId: rootA2!.id,
      nodeType: "folder",
      name: "Docs",
    });
    await createNode({
      userId: userA,
      projectId: projectA2.id,
      parentId: childA2.id,
      nodeType: "specification",
      name: "Spec",
    });
    await pool.query("DELETE FROM tasks WHERE id = $1", [taskInA2.id]);
    await pool.query("DELETE FROM projects WHERE id = $1", [projectA2.id]);

    const remainingA2Nodes = await pool.query(
      "SELECT 1 FROM project_nodes WHERE project_id = $1",
      [projectA2.id],
    );
    if (remainingA2Nodes.rowCount !== 0) {
      throw new Error("Project deletion did not clean up its project_nodes tree.");
    }
    console.log("PASS: node, task, and project deletion policies");
  } finally {
    try {
      if (userA) {
        await pool.query("DELETE FROM users WHERE id = $1", [userA]);
      }
      if (userB) {
        await pool.query("DELETE FROM users WHERE id = $1", [userB]);
      }
      console.log("PASS: user deletion cascade with multi-level tasks and nodes");
    } finally {
      await pool.end();
    }
  }
}

testPhase1Hierarchy().catch((error: unknown) => {
  console.error("Phase 1 hierarchy test failed:", error);
  process.exitCode = 1;
});