
import express from "express";
import { createProject, listProjects } from "./projects-repository";
import { getLocalOwnerId } from "./local-owner";
import {
  createTask,
  getTask,
  listTasks,
  updateTaskStatus,
  type TaskPriority,
  type TaskStatus,
} from "./tasks-repository";

const app = express();

app.use(express.json({ limit: "100kb" }));

app.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    service: "chatledger-api",
  });
});

app.get("/api/projects", async (_req, res) => {
  try {
    const ownerId = await getLocalOwnerId();
    const projects = await listProjects(ownerId);

    res.status(200).json({ projects });
  } catch (error) {
    console.error("Failed to list projects:", error);
    res.status(500).json({ error: "Unable to retrieve projects." });
  }
});

app.post("/api/projects", async (req, res) => {
  try {
    const { name, description } = req.body ?? {};

    if (typeof name !== "string" || !name.trim()) {
      res.status(400).json({ error: "A non-empty project name is required." });
      return;
    }

    if (
      description !== undefined &&
      description !== null &&
      typeof description !== "string"
    ) {
      res.status(400).json({ error: "Description must be a string or null." });
      return;
    }

    const ownerId = await getLocalOwnerId();

    const project = await createProject(
      ownerId,
      name,
      description ?? null,
    );

    res.status(201).json({ project });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes("duplicate key")
    ) {
      res.status(409).json({
        error: "A project with that name already exists.",
      });
      return;
    }

    console.error("Failed to create project:", error);
    res.status(500).json({ error: "Unable to create project." });
  }
});


const validPriorities: TaskPriority[] = [
  "low", "medium", "high", "urgent",
];

const validStatuses: TaskStatus[] = [
  "Proposed", "Open", "In Progress",
  "Blocked", "Done", "Cancelled",
];

app.get("/api/tasks", async (req, res) => {
  try {
    const projectId =
      typeof req.query.projectId === "string"
        ? req.query.projectId
        : undefined;

    const ownerId = await getLocalOwnerId();
    const tasks = await listTasks(ownerId, projectId);

    res.status(200).json({ tasks });
  } catch (error) {
    console.error("Failed to list tasks:", error);
    res.status(500).json({ error: "Unable to retrieve tasks." });
  }
});

app.post("/api/tasks", async (req, res) => {
  try {
    const { title, description, projectId, priority } = req.body ?? {};

    if (typeof title !== "string" || !title.trim()) {
      res.status(400).json({ error: "A non-empty task title is required." });
      return;
    }

    if (
      description !== undefined &&
      description !== null &&
      typeof description !== "string"
    ) {
      res.status(400).json({ error: "Description must be a string or null." });
      return;
    }

    if (
      projectId !== undefined &&
      projectId !== null &&
      typeof projectId !== "string"
    ) {
      res.status(400).json({ error: "projectId must be a string or null." });
      return;
    }

    const selectedPriority = priority ?? "medium";

    if (
      typeof selectedPriority !== "string" ||
      !validPriorities.includes(selectedPriority as TaskPriority)
    ) {
      res.status(400).json({ error: "Invalid task priority." });
      return;
    }

    const ownerId = await getLocalOwnerId();

    const task = await createTask(
      ownerId,
      title,
      projectId ?? null,
      description ?? null,
      selectedPriority as TaskPriority,
    );

    res.status(201).json({ task });
  } catch (error) {
    console.error("Failed to create task:", error);
    res.status(500).json({ error: "Unable to create task." });
  }
});

app.patch("/api/tasks/:id/status", async (req, res) => {
  try {
    const { expectedVersion, status } = req.body ?? {};

    if (
      !Number.isInteger(expectedVersion) ||
      expectedVersion < 1
    ) {
      res.status(400).json({
        error: "expectedVersion must be a positive integer.",
      });
      return;
    }

    if (
      typeof status !== "string" ||
      !validStatuses.includes(status as TaskStatus)
    ) {
      res.status(400).json({ error: "Invalid task status." });
      return;
    }

    const ownerId = await getLocalOwnerId();

    const task = await updateTaskStatus(
      ownerId,
      req.params.id,
      expectedVersion,
      status as TaskStatus,
    );

    res.status(200).json({ task });
  } catch (error) {
    if (error instanceof Error && error.message.includes("version conflict")) {
      res.status(409).json({ error: error.message });
      return;
    }

    if (error instanceof Error && error.message.includes("Task not found")) {
      res.status(404).json({ error: error.message });
      return;
    }

    console.error("Failed to update task status:", error);
    res.status(500).json({ error: "Unable to update task status." });
  }
});

export default app;
