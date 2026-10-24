
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import "./page.css";

type Project = {
  id: string;
  name: string;
  description: string | null;
};

type TaskStatus =
  | "Proposed"
  | "Open"
  | "In Progress"
  | "Blocked"
  | "Done"
  | "Cancelled";

type Task = {
  id: string;
  project_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: "low" | "medium" | "high" | "urgent";
  version: number;
  created_at: string;
  updated_at: string;
};

const statuses: TaskStatus[] = [
  "Proposed",
  "Open",
  "In Progress",
  "Blocked",
  "Done",
  "Cancelled",
];

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error ?? `Request failed (${response.status})`);
  }

  return data as T;
}

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskDescription, setTaskDescription] = useState("");
  const [taskPriority, setTaskPriority] = useState("medium");
  const [taskProjectId, setTaskProjectId] = useState("");
  const [showProjectForm, setShowProjectForm] = useState(false);
  const [showTaskForm, setShowTaskForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadWorkspace = useCallback(async () => {
    try {
      setError("");
      const [projectData, taskData] = await Promise.all([
        request<{ projects: Project[] }>("/api/projects"),
        request<{ tasks: Task[] }>("/api/tasks"),
      ]);

      setProjects(projectData.projects);
      setTasks(taskData.tasks);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Unable to load your workspace.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const selectedProject = projects.find(
    (project) => project.id === selectedProjectId,
  );

  const visibleTasks = useMemo(
    () =>
      selectedProjectId === "all"
        ? tasks
        : tasks.filter((task) => task.project_id === selectedProjectId),
    [tasks, selectedProjectId],
  );

  const openCount = visibleTasks.filter(
    (task) => task.status !== "Done" && task.status !== "Cancelled",
  ).length;

  async function createProject(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!projectName.trim()) return;

    setSaving(true);
    setError("");

    try {
      const data = await request<{ project: Project }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({
          name: projectName.trim(),
          description: projectDescription.trim() || null,
        }),
      });

      await loadWorkspace();
      setSelectedProjectId(data.project.id);
      setProjectName("");
      setProjectDescription("");
      setShowProjectForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create project.");
    } finally {
      setSaving(false);
    }
  }

  async function createTask(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!taskTitle.trim()) return;

    setSaving(true);
    setError("");

    try {
      await request<{ task: Task }>("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          title: taskTitle.trim(),
          description: taskDescription.trim() || null,
          priority: taskPriority,
          projectId: taskProjectId || null,
        }),
      });

      await loadWorkspace();
      setTaskTitle("");
      setTaskDescription("");
      setTaskPriority("medium");
      setTaskProjectId("");
      setShowTaskForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create task.");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(task: Task, status: TaskStatus) {
    setError("");

    try {
      await request<{ task: Task }>(`/api/tasks/${task.id}/status`, {
        method: "PATCH",
        body: JSON.stringify({
          expectedVersion: task.version,
          status,
        }),
      });

      await loadWorkspace();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update task.");
      await loadWorkspace();
    }
  }

  return (
    <main className="workspace">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">C</div>
          <div>
            <div className="brand-name">ChatLedger</div>
            <div className="brand-subtitle">Your persistent workspace</div>
          </div>
        </div>

        <div className="sidebar-label">WORKSPACE</div>

        <button
          className={`nav-item ${selectedProjectId === "all" ? "active" : ""}`}
          onClick={() => setSelectedProjectId("all")}
        >
          <span className="nav-icon">◫</span>
          All tasks
          <span className="nav-count">{tasks.length}</span>
        </button>

        <div className="section-heading">
          <span>PROJECTS</span>
          <button
            className="icon-button"
            title="Create project"
            onClick={() => setShowProjectForm(!showProjectForm)}
          >
            +
          </button>
        </div>

        {showProjectForm && (
          <form className="sidebar-form" onSubmit={createProject}>
            <input
              autoFocus
              placeholder="Project name"
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              required
            />
            <input
              placeholder="Description (optional)"
              value={projectDescription}
              onChange={(event) => setProjectDescription(event.target.value)}
            />
            <button className="primary-button" disabled={saving}>
              {saving ? "Creating…" : "Create project"}
            </button>
          </form>
        )}

        <nav className="project-nav">
          {projects.map((project) => (
            <button
              key={project.id}
              className={`nav-item ${
                selectedProjectId === project.id ? "active" : ""
              }`}
              onClick={() => setSelectedProjectId(project.id)}
              title={project.name}
            >
              <span className="project-dot" />
              <span className="project-name">{project.name}</span>
              <span className="nav-count">
                {tasks.filter((task) => task.project_id === project.id).length}
              </span>
            </button>
          ))}
          {projects.length === 0 && !loading && (
            <p className="muted sidebar-empty">Your projects will appear here.</p>
          )}
        </nav>

        <div className="sidebar-bottom">
          <div className="connection-indicator">
            <span className="connection-dot" />
            Local workspace
          </div>
          <div className="sidebar-footnote">Your work. Your source of truth.</div>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumb">
            <span>Workspace</span>
            <span className="breadcrumb-divider">/</span>
            <strong>{selectedProject?.name ?? "All tasks"}</strong>
          </div>
          <button className="secondary-button" onClick={() => void loadWorkspace()}>
            ↻ <span>Refresh</span>
          </button>
        </header>

        <div className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">YOUR WORK, CONNECTED</div>
              <h1>{selectedProject?.name ?? "Your workspace"}</h1>
              <p className="page-description">
                {selectedProject?.description ||
                  "Projects and tasks, with persistent state across conversations."}
              </p>
            </div>
            <button
              className="primary-button new-task-button"
              onClick={() => {
                setTaskProjectId(
                  selectedProjectId === "all" ? "" : selectedProjectId,
                );
                setShowTaskForm(!showTaskForm);
              }}
            >
              <span>+</span> New task
            </button>
          </div>

          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button onClick={() => setError("")}>Dismiss</button>
            </div>
          )}

          {showTaskForm && (
            <form className="task-form" onSubmit={createTask}>
              <div className="form-heading">Create a task</div>
              <input
                autoFocus
                placeholder="What needs to get done?"
                value={taskTitle}
                onChange={(event) => setTaskTitle(event.target.value)}
                required
              />
              <textarea
                placeholder="Add context or a description (optional)"
                value={taskDescription}
                onChange={(event) => setTaskDescription(event.target.value)}
                rows={3}
              />
              <div className="form-row">
                <label>
                  Project
                  <select
                    value={taskProjectId}
                    onChange={(event) => setTaskProjectId(event.target.value)}
                  >
                    <option value="">No project</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Priority
                  <select
                    value={taskPriority}
                    onChange={(event) => setTaskPriority(event.target.value)}
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </label>
              </div>
              <div className="form-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => setShowTaskForm(false)}
                >
                  Cancel
                </button>
                <button className="primary-button" disabled={saving}>
                  {saving ? "Saving…" : "Create task"}
                </button>
              </div>
            </form>
          )}

          <div className="stats-grid">
            <div className="stat-card">
              <span className="stat-label">TOTAL TASKS</span>
              <strong>{visibleTasks.length}</strong>
              <span className="stat-footnote">In this view</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">ACTIVE</span>
              <strong>{openCount}</strong>
              <span className="stat-footnote">Still in progress</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">COMPLETED</span>
              <strong>{visibleTasks.filter((task) => task.status === "Done").length}</strong>
              <span className="stat-footnote">Marked as done</span>
            </div>
            <div className="stat-card">
              <span className="stat-label">PROJECTS</span>
              <strong>{projects.length}</strong>
              <span className="stat-footnote">Your workspace</span>
            </div>
          </div>

          <div className="task-section-heading">
            <div>
              <h2>Tasks</h2>
              <p>Track the next action, not just the conversation.</p>
            </div>
            <span className="result-count">{visibleTasks.length} items</span>
          </div>

          {loading ? (
            <div className="empty-state">
              <div className="loading-indicator" />
              <p>Loading your workspace…</p>
            </div>
          ) : visibleTasks.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">↗</div>
              <h3>No tasks here yet</h3>
              <p>Create a task to turn your next action into persistent state.</p>
              <button
                className="primary-button"
                onClick={() => setShowTaskForm(true)}
              >
                + Create your first task
              </button>
            </div>
          ) : (
            <div className="task-list">
              {visibleTasks.map((task) => (
                <article className="task-card" key={task.id}>
                  <div className="task-main">
                    <div className={`task-status-mark status-${task.status.toLowerCase().replaceAll(" ", "-")}`}>
                      {task.status === "Done" ? "✓" : ""}
                    </div>
                    <div className="task-copy">
                      <h3 className={task.status === "Done" ? "completed-title" : ""}>
                        {task.title}
                      </h3>
                      {task.description && <p>{task.description}</p>}
                      <div className="task-metadata">
                        <span className={`priority priority-${task.priority}`}>
                          <span /> {task.priority}
                        </span>
                        <span className="metadata-divider">·</span>
                        <span>v{task.version}</span>
                        <span className="metadata-divider">·</span>
                        <span>
                          {new Date(task.updated_at).toLocaleDateString()}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="task-actions">
                    <select
                      aria-label={`Status for ${task.title}`}
                      className={`status-select status-select-${task.status.toLowerCase().replaceAll(" ", "-")}`}
                      value={task.status}
                      onChange={(event) =>
                        void changeStatus(task, event.target.value as TaskStatus)
                      }
                    >
                      {statuses.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </div>
                </article>
              ))}
            </div>
          )}

          <footer className="page-footer">
            <span>CHATLEDGER</span>
            <span>Persistent state · Traceable progress</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
