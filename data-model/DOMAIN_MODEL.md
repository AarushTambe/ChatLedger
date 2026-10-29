
# ChatLedger Domain Model

## 1. Project

A project is a logical workspace for a goal or body of work.

Examples:
- Internship search
- LinkFlow
- College coursework
- ChatLedger development

A project can contain multiple tasks, conversations, and decisions.

## 2. Conversation

A conversation is a record of a discussion associated with a project or task.

Fields:
- Internal ID
- Title
- Source
- Optional external reference
- Optional conversation URL
- Created timestamp

A conversation can be associated with multiple projects and tasks.

An internal ChatLedger conversation ID does not imply that ChatGPT exposes its own conversation ID.

## 3. Task

A task is a specific, actionable unit of work.

Fields:
- Internal ID
- Title
- Description
- Status
- Priority
- Optional due date
- Optional parent task
- Optional project
- Created timestamp
- Updated timestamp
- Version number

A task may be associated with multiple conversations.

Tasks are not duplicated merely because they appear in multiple conversations.

## 4. Task origin

A task records how it entered the system.

Supported origin types:
- User-created
- Assistant-proposed
- User-confirmed
- Imported
- Integration-created

An assistant-proposed task must not be treated as a confirmed commitment without an explicit confirmation rule.

## 5. Decision

A decision is an agreed choice, policy, or constraint that may influence future work.

Fields:
- Internal ID
- Summary
- Rationale
- Status
- Decision timestamp
- Optional project
- Optional originating conversation
- Optional superseded decision

Changing a decision must preserve its history.

## 6. Activity event

An activity event records an important action or state change.

Examples:
- Task created
- Task confirmed
- Task started
- Task completed
- Due date changed
- Decision recorded
- Task reopened

Events contain:
- Internal ID
- Event type
- Actor
- Timestamp
- Relevant entity references
- Previous value, when applicable
- New value, when applicable
- Optional idempotency key

Events are append-only. Corrections create new events rather than silently rewriting history.

## 7. Relationships

- A project has many tasks.
- A project can be linked to many conversations.
- A conversation can be linked to many projects.
- A task can be linked to many conversations.
- A task may have subtasks.
- A decision may belong to a project and originate in a conversation.
- An activity event references the entity it affects.

## 8. Canonical state

The database stores the authoritative state of tasks and decisions.

Summaries, search indexes, and AI-generated context are derived representations.

Derived representations must never override canonical records.

## 9. Identity and ownership

All entities have stable internal IDs.

Every private entity belongs to an authorized user or workspace.

All reads and writes enforce ownership and authorization on the server.

## 10. Time and concurrency

Store timestamps in UTC.

Use a version number for optimistic concurrency control.

A stale update must be rejected or explicitly reconciled.


# ChatLedger Domain Model (V2)

## 1. Workspace and User

A workspace represents the user's working environment and owns all private records.
All queries and mutations enforce `user_id` ownership on the server.

## 2. Project

A project is the primary scope for structured software project state.

A project owns or organizes:
- Exactly one logical root filesystem node (`parent_id IS NULL`).
- A hierarchical tree of nested filesystem nodes.
- Tasks and subtasks.
- Linked conversations.
- Architectural decisions.
- Artifacts, verification evidence, and activity history.

## 3. Filesystem Node (`project_nodes`)

A filesystem node represents a logical part of the project structure. It is distinct from physical files on disk.

### Node Types
- `folder`: Structural container.
- `subsystem`: Bounded architectural area (e.g., Frontend, Backend, Database).
- `file`: Logical file representation.
- `specification`: Requirements or design specification.
- `artifact`: Generated output, build/test report, or deliverable.

### Lifecycle States
- `planned`: Expresses architectural or implementation intent.
- `present`: Grounded in observed physical existence.
- `modified`: Grounded in observed changes.
- `missing`: Expected path was verified as absent.
- `archived`: Historically preserved; excluded from active sibling name uniqueness so names can be reused.

### Tree Invariants
- Each project has exactly one root node (`parent_id IS NULL`, `node_type = 'folder'`, non-archived).
- Containment is acyclic and scoped to the same `project_id` and `user_id`.
- Active sibling names under the same parent are unique (case-insensitive, trimmed).

## 4. Task and Subtask (`tasks`)

A task is an actionable unit of work, independent of filesystem containment.

Fields:
- `id`, `user_id`, `project_id` (nullable for unassigned tasks)
- `parent_task_id` (nullable self-reference)
- `title`, `description`, `acceptance_criteria`
- `status`: `Proposed`, `Open`, `In Progress`, `Blocked`, `Done`, `Cancelled`
- `priority`: `low`, `medium`, `high`, `urgent`
- `due_at`, `version`, `created_at`, `updated_at`

### Task Hierarchy Rules
- Parent tasks and subtasks must share the exact same `user_id` and `project_id` (including when both `project_id` values are `NULL`).
- Parent-child task cycles are prohibited.
- Task hierarchy and filesystem hierarchy are independent: one task can link to multiple nodes via `task_nodes`, and one node can be linked to multiple tasks.

## 5. Task Dependencies (`task_dependencies`)

Dependencies express execution prerequisites (`task_id` depends on `depends_on_task_id`), not containment. Self-dependencies and circular dependencies are rejected.

## 6. Conversation (`conversations`)

A conversation is a known source of project context. It may link to projects (`projects_conversations`), tasks (`task_conversations`), nodes (`source_conversation_id`), and decisions. External identifiers are stored only when explicitly provided.

## 7. Decision (`decisions`)

A decision records an agreed architectural or product choice, its rationale, and its provenance. Historical decisions remain retrievable when superseded.

## 8. Activity Event (`activity_events`)

Append-only audit records written in the same database transaction as the mutation they describe.