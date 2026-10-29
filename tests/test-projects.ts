import { randomUUID } from "node:crypto";
import { pool } from "../services/api/src/db";
import {
  createProject,
  listProjects,
} from "../services/api/src/projects-repository";

async function testProjectsRepository() {
  const testId = randomUUID();
  const emailA = `chatledger-test-a-${testId}@example.com`;
  const emailB = `chatledger-test-b-${testId}@example.com`;

  let userA: string | undefined;
  let userB: string | undefined;

  try {
    const firstUser = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name)
       VALUES ($1, $2)
       RETURNING id`,
      [emailA, "ChatLedger Test A"],
    );
    userA = firstUser.rows[0].id;

    const secondUser = await pool.query<{ id: string }>(
      `INSERT INTO users (email, display_name)
       VALUES ($1, $2)
       RETURNING id`,
      [emailB, "ChatLedger Test B"],
    );
    userB = secondUser.rows[0].id;

    const created = await createProject(
      userA,
      "Repository Test Project",
      "Temporary test project",
    );

    if (created.user_id !== userA) {
      throw new Error("Project owner does not match.");
    }

    const projectsA = await listProjects(userA);
    if (!projectsA.some((project) => project.id === created.id)) {
      throw new Error("Created project was not found for its owner.");
    }

    const projectsB = await listProjects(userB);
    if (projectsB.some((project) => project.id === created.id)) {
      throw new Error("Project leaked into another user's project list.");
    }

    console.log("PASS: project creation");
    console.log("PASS: owner can retrieve project");
    console.log("PASS: another user cannot see project");
  } finally {
    try {
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

testProjectsRepository().catch((error: unknown) => {
  console.error("Project repository test failed:", error);
  process.exitCode = 1;
});