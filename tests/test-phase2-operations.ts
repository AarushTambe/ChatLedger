import { randomUUID } from "node:crypto";
import { pool } from "../services/api/src/db";
import {
  archiveNode,
  createNode,
  getProjectRootNode,
  getProjectTree,
  getSubtree,
  moveNode,
  updateNode,
} from "../services/api/src/nodes-repository";
import { createProject } from "../services/api/src/projects-repository";
import {
  addTaskDependency,
  createTask,
  getNodeTasks,
  linkTaskToNode,
  listSubtasks,
  listTaskDependencies,
  unlinkTaskFromNode,
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

async function testPhase2Operations() {
  const testId = randomUUID();
  let userA: string | undefined;

  try {
    const resUserA = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name)
       VALUES ($1, $2) RETURNING id`,
      [`phase2-a-${testId}@example.com`, "Phase 2 User A"],
    );
    userA = resUserA.rows[0].id;

    const project1 = await createProject(userA, `Phase2 Project 1 ${testId}`);
    const project2 = await createProject(userA, `Phase2 Project 2 ${testId}`);

    const root1 = await getProjectRootNode(userA, project1.id);
    const root2 = await getProjectRootNode(userA, project2.id);
    if (!root1 || !root2) {
      throw new Error("Root nodes missing.");
    }

    // 1. Create subsystem and child nodes
    const backend = await createNode({
      userId: userA,
      projectId: project1.id,
      parentId: root1.id,
      nodeType: "subsystem",
      name: "Backend",
      sortOrder: 1,
    });

    const frontend = await createNode({
      userId: userA,
      projectId: project1.id,
      parentId: root1.id,
      nodeType: "subsystem",
      name: "Frontend",
      sortOrder: 2,
    });

    const apiFolder = await createNode({
      userId: userA,
      projectId: project1.id,
      parentId: backend.id,
      nodeType: "folder",
      name: "api",
    });

    const routesFile = await createNode({
      userId: userA,
      projectId: project1.id,
      parentId: apiFolder.id,
      nodeType: "file",
      name: "routes.ts",
      relativePath: "services/api/src/routes.ts",
    });

    // 2. Version-aware updateNode & stale version rejection
    const updatedRoutes = await updateNode({
      userId: userA,
      nodeId: routesFile.id,
      expectedVersion: 1,
      lifecycleState: "present",
      description: "Express routes module",
      metadata: { verified: true },
    });

    if (
      updatedRoutes.version !== 2 ||
      updatedRoutes.lifecycle_state !== "present" ||
      updatedRoutes.description !== "Express routes module"
    ) {
      throw new Error("updateNode did not persist changes or increment version.");
    }

    await expectReject(
      () =>
        updateNode({
          userId: userA!,
          nodeId: routesFile.id,
          expectedVersion: 1,
          description: "Stale update",
        }),
      "stale expectedVersion on updateNode",
    );
    console.log("PASS: version-aware updateNode and conflict rejection");

    // 3. Version-aware moveNode, cycle guard, cross-project guard, and archived parent guard
    const movedApiFolder = await moveNode({
      userId: userA,
      nodeId: apiFolder.id,
      expectedVersion: apiFolder.version,
      newParentId: frontend.id,
      newSortOrder: 5,
    });

    if (
      movedApiFolder.parent_id !== frontend.id ||
      movedApiFolder.version !== 2 ||
      movedApiFolder.sort_order !== 5
    ) {
      throw new Error("moveNode did not update parent_id, sort_order, or version.");
    }

    // Stale moveNode version must fail
    await expectReject(
      () =>
        moveNode({
          userId: userA!,
          nodeId: apiFolder.id,
          expectedVersion: 1,
          newParentId: backend.id,
        }),
      "stale expectedVersion on moveNode",
    );

    // Moving frontend under routesFile (its own descendant now!) must fail
    await expectReject(
      () =>
        moveNode({
          userId: userA!,
          nodeId: frontend.id,
          expectedVersion: frontend.version,
          newParentId: routesFile.id,
        }),
      "cycle detection in moveNode",
    );

    // Moving a node to a parent in project2 must fail
    await expectReject(
      () =>
        moveNode({
          userId: userA!,
          nodeId: apiFolder.id,
          expectedVersion: movedApiFolder.version,
          newParentId: root2.id,
        }),
      "cross-project moveNode",
    );

    // Move apiFolder back under backend
    const restoredApiFolder = await moveNode({
      userId: userA,
      nodeId: apiFolder.id,
      expectedVersion: movedApiFolder.version,
      newParentId: backend.id,
      newSortOrder: 0,
    });

    // Archive frontend, then verify moving a node under an archived parent fails
    await archiveNode(userA, frontend.id, frontend.version);
    await expectReject(
      () =>
        moveNode({
          userId: userA!,
          nodeId: apiFolder.id,
          expectedVersion: restoredApiFolder.version,
          newParentId: frontend.id,
        }),
      "moving node under an archived parent",
    );
    console.log("PASS: version-aware moveNode and hierarchy guards");

    // 4. Bounded getProjectTree and getSubtree queries
    const activeTree = await getProjectTree(userA, project1.id, {
      maxDepth: 10,
      includeArchived: false,
    });
    // Should contain: root1 (0), backend (1), apiFolder (2), routesFile (3). Frontend is archived!
    if (
      activeTree.length !== 4 ||
      activeTree.some((n) => n.id === frontend.id)
    ) {
      throw new Error("getProjectTree failed to exclude archived nodes or return full depth.");
    }

    const shallowTree = await getProjectTree(userA, project1.id, {
      maxDepth: 1,
      includeArchived: true,
    });
    // Depth 0 (root1) + Depth 1 (backend, frontend) = 3 nodes
    if (shallowTree.length !== 3) {
      throw new Error(`Expected 3 nodes at maxDepth=1, got ${shallowTree.length}.`);
    }

    const backendSubtree = await getSubtree(userA, backend.id, {
      maxDepth: 5,
    });
    // backend (0), apiFolder (1), routesFile (2) = 3 nodes
    if (
      backendSubtree.length !== 3 ||
      backendSubtree[0].id !== backend.id ||
      backendSubtree[2].id !== routesFile.id
    ) {
      throw new Error("getSubtree did not return expected subtree nodes.");
    }
    console.log("PASS: bounded getProjectTree and getSubtree queries");

    // 5. Subtasks, reverse node->task lookup, unlinking, and task dependency cycle prevention
    const parentTask = await createTask(
      userA,
      "Build API Layer",
      project1.id,
    );
    const subtask1 = await createTask(
      userA,
      "Define route handlers",
      project1.id,
      null,
      "high",
      { parentTaskId: parentTask.id },
    );
    const subtask2 = await createTask(
      userA,
      "Write route tests",
      project1.id,
      null,
      "medium",
      { parentTaskId: parentTask.id },
    );

    const subtasks = await listSubtasks(userA, parentTask.id);
    if (subtasks.length !== 2) {
      throw new Error("listSubtasks did not return both subtasks.");
    }

    // Link subtask1 to routesFile, verify getNodeTasks, then unlink
    await linkTaskToNode(userA, subtask1.id, routesFile.id, "target");
    const nodeTasks = await getNodeTasks(userA, routesFile.id);
    if (nodeTasks.length !== 1 || nodeTasks[0].id !== subtask1.id) {
      throw new Error("getNodeTasks did not return linked task.");
    }

    const unlinked = await unlinkTaskFromNode(
      userA,
      subtask1.id,
      routesFile.id,
    );
    if (!unlinked || (await getNodeTasks(userA, routesFile.id)).length !== 0) {
      throw new Error("unlinkTaskFromNode did not remove the association.");
    }

    // Task dependencies: subtask2 depends on subtask1
    await addTaskDependency(userA, subtask2.id, subtask1.id);
    const prereqs = await listTaskDependencies(userA, subtask2.id);
    if (prereqs.length !== 1 || prereqs[0].id !== subtask1.id) {
      throw new Error("listTaskDependencies did not return prerequisite task.");
    }

    // Circular task dependency (subtask1 depends on subtask2) must fail
    await expectReject(
      () => addTaskDependency(userA!, subtask1.id, subtask2.id),
      "circular task dependency",
    );
    console.log("PASS: subtasks, node-task reverse lookup, and dependency cycle guard");

    // 6. Verify activity_events audit trail for Phase 2 operations
    const eventsResult = await pool.query<{ event_type: string }>(
      `SELECT event_type
       FROM activity_events
       WHERE user_id = $1 AND project_id = $2
       ORDER BY occurred_at ASC`,
      [userA, project1.id],
    );
    const eventTypes = new Set(eventsResult.rows.map((r) => r.event_type));
    const expectedTypes = [
      "project.created",
      "node.created",
      "node.updated",
      "node.moved",
      "node.archived",
      "task.created",
      "task.node_linked",
      "task.node_unlinked",
      "task.dependency_added",
    ];
    for (const expectedType of expectedTypes) {
      if (!eventTypes.has(expectedType)) {
        throw new Error(`Missing expected activity event type: ${expectedType}`);
      }
    }
    console.log("PASS: activity_events audit history for all Phase 2 mutations");
  } finally {
    try {
      if (userA) {
        await pool.query("DELETE FROM users WHERE id = $1", [userA]);
      }
    } finally {
      await pool.end();
    }
  }
}

testPhase2Operations().catch((error: unknown) => {
  console.error("Phase 2 operations test failed:", error);
  process.exitCode = 1;
});