
# ChatLedger Architecture

## 1. Purpose

Provide a persistent organizational layer connecting projects, conversations, decisions, and tasks.

## 2. Architectural layers

### Organization layer
Projects, conversations, documents, and their relationships.

### State layer
Tasks, decisions, dependencies, status transitions, and activity history.

### Context layer
Search, retrieval, and concise context packages supplied to an AI assistant.

## 3. Application components

- Web dashboard: task management and project navigation.
- Backend API: authentication, validation, business rules, and persistence.
- PostgreSQL: authoritative persistent state.
- ChatGPT integration: supported tools for reading and updating shared state.

## 4. Data ownership

PostgreSQL owns canonical task statuses, task relationships, decisions, and activity events.

Conversation summaries and AI-generated context are derived information. They must not override canonical records.

## 5. Conversation linkage

Every ChatLedger conversation has an internal identifier.

External conversation identifiers and URLs are optional and must only be stored when actually available or explicitly supplied.

A task can be associated with multiple conversations while remaining one canonical task.

## 6. Synchronization

All mutations pass through validated backend operations.

Task updates and their corresponding activity events are written atomically.

Clients retrieve current state from the backend when fresh information is required.

## 7. Security and reliability

- Authenticate every user.
- Authorize access to every requested record.
- Validate inputs on the server.
- Prevent duplicate writes with idempotency keys where appropriate.
- Detect conflicting edits with version checks.
- Keep an audit history of important changes.

## 8. Platform constraints

The integration must use supported ChatGPT app and MCP capabilities.

Unrestricted access to every existing conversation, automatic modification of built-in memory, and background updates to all open conversations are not assumed.

## 9. Initial implementation sequence

1. Repository foundation.
2. Domain model and database schema.
3. Backend API and automated tests.
4. Web dashboard.
5. ChatGPT integration.
6. Cross-conversation continuity and deployment.



# ChatLedger Architecture (V2)

## 1. System Role & Boundaries

ChatLedger is the persistent project-state and context-organization subsystem within **Framer**.

### ChatLedger Owns
- Canonical structured project state in PostgreSQL.
- Project and logical filesystem-node hierarchy (`project_nodes`).
- Task hierarchy, dependencies, acceptance criteria, and task-to-node links (`tasks`, `task_dependencies`, `task_nodes`).
- Architectural decisions, conversation references, provenance, and append-only `activity_events`.
- Bounded context assembly from structured project state.

### Framer Provides / Reuses
- Repository intelligence, source-file reading/editing, and FTS5/code indexing.
- Command execution and test verification.
- AI workflow orchestration and tool transports.

## 2. Governing Workflow

**Understand → Retrieve → Plan → Implement → Verify → Persist → Resume**

ChatLedger strictly separates intended work (`planned` nodes, `Proposed`/`Open` tasks) from verified implementation (`present`/`modified` nodes, verification evidence, `Done` tasks).

## 3. Application Layers

1. **Transport**: Express HTTP API (`services/api/src/server.ts`) and future MCP/tool adapters.
2. **Validation & Services**: Input validation, optimistic concurrency (`expectedVersion`), and transactional coordination.
3. **Repositories**:
   - `projects-repository.ts`: Atomic project + root node creation and listing.
   - `nodes-repository.ts`: Logical filesystem tree operations, versioned archival, and child queries.
   - `tasks-repository.ts`: Tasks, subtasks, status transitions, and `task_nodes` links.
4. **PostgreSQL Persistence**: Declarative constraints, partial unique indexes, and hierarchy/scope guard triggers (`migrations/001_initial_schema.sql`, `migrations/002_filesystem_and_task_hierarchy.sql`).

# ChatLedger Architecture (V2)

## 1. System Role & Boundaries

ChatLedger is the persistent project-state and context-organization subsystem within **Framer**.

### ChatLedger Owns
- Canonical structured project state in PostgreSQL.
- Project and logical filesystem-node hierarchy (`project_nodes`).
- Task hierarchy, dependencies, acceptance criteria, and task-to-node links (`tasks`, `task_dependencies`, `task_nodes`).
- Architectural decisions, conversation references, provenance, and append-only `activity_events`.
- Bounded context assembly from structured project state.

### Framer Provides / Reuses
- Repository intelligence, source-file reading/editing, and FTS5/code indexing.
- Command execution and test verification.
- AI workflow orchestration and tool transports.

## 2. Governing Workflow

**Understand → Retrieve → Plan → Implement → Verify → Persist → Resume**

ChatLedger strictly separates intended work (`planned` nodes, `Proposed`/`Open` tasks) from verified implementation (`present`/`modified` nodes, verification evidence, `Done` tasks).

## 3. Application Layers & Repository Contracts

1. **Transport**: Express HTTP API (`services/api/src/server.ts`) and future MCP/tool adapters.
2. **Repositories**:
   - `services/api/src/projects-repository.ts`:
     - `createProject(userId, name, description)` — Atomically creates project + root folder node (`planned`) + `project.created` & `node.created` activity events.
     - `listProjects(userId)` — Lists user projects.
   - `services/api/src/nodes-repository.ts`:
     - `getProjectRootNode(userId, projectId)` — Fetches the single root node.
     - `getNode(userId, nodeId)` — Fetches a node by ID.
     - `createNode(input)` — Creates a child node under an active parent (`node.created`).
     - `updateNode(input)` — Version-checked (`expectedVersion`) metadata/state update (`node.updated`).
     - `moveNode(input)` — Version-checked (`expectedVersion`) hierarchy move across active parents in the same project (`node.moved`).
     - `archiveNode(userId, nodeId, expectedVersion)` — Version-checked archival (`node.archived`).
     - `listChildNodes(userId, projectId, parentId, includeArchived?)` — Direct children query.
     - `getProjectTree(userId, projectId, options?)` & `getSubtree(userId, nodeId, options?)` — Bounded recursive tree queries (`maxDepth`, `includeArchived`).
   - `services/api/src/tasks-repository.ts`:
     - `createTask(...)` & `listSubtasks(userId, parentTaskId)` — Task and subtask creation/listing (`task.created`).
     - `updateTaskStatus(userId, taskId, expectedVersion, newStatus)` — Version-checked status transition (`task.status_changed`).
     - `linkTaskToNode` / `unlinkTaskFromNode` / `getTaskNodes` / `getNodeTasks` — Bidirectional task-to-node associations (`task.node_linked`, `task.node_unlinked`).
     - `addTaskDependency` / `listTaskDependencies` — Cycle-checked task execution prerequisites (`task.dependency_added`).
3. **PostgreSQL Persistence**: Declarative constraints, partial unique indexes, and hierarchy/scope guard triggers (`migrations/001`–`003`).