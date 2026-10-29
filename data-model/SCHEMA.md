
# ChatLedger Database Schema

## 1. users

Purpose: identify the owner of each private record.

Fields:
- id: UUID, primary key
- auth_provider: text, nullable initially
- auth_subject: text, nullable initially
- created_at: timestamp with time zone

Constraints:
- Unique authentication provider and subject when both are present.
- No credentials or passwords stored in plaintext.

## 2. projects

Purpose: organize work by goal or domain.

Fields:
- id: UUID, primary key
- user_id: UUID, foreign key to users
- name: text, required
- description: text, optional
- status: text, required
- created_at: timestamp with time zone
- updated_at: timestamp with time zone

Constraints:
- Project names cannot be blank.
- Index projects by user and status.

## 3. conversations

Purpose: represent discussions linked to ChatLedger.

Fields:
- id: UUID, primary key
- user_id: UUID, foreign key to users
- title: text, required
- source: text, required
- external_ref: text, optional
- chat_url: text, optional
- created_at: timestamp with time zone
- updated_at: timestamp with time zone

Constraints:
- External references must not be invented.
- If a stable external reference is available, prevent accidental duplicate imports for the same user and source.

## 4. projects_conversations

Purpose: link projects to conversations.

Fields:
- project_id: UUID, foreign key to projects
- conversation_id: UUID, foreign key to conversations
- linked_at: timestamp with time zone

Constraints:
- Composite primary key: project_id and conversation_id.

## 5. tasks

Purpose: store canonical task state.

Fields:
- id: UUID, primary key
- user_id: UUID, foreign key to users
- project_id: UUID, nullable foreign key to projects
- parent_task_id: UUID, nullable self-reference
- title: text, required
- description: text, optional
- status: text, required
- priority: text, required
- origin_type: text, required
- due_at: timestamp with time zone, optional
- created_at: timestamp with time zone
- updated_at: timestamp with time zone
- completed_at: timestamp with time zone, optional
- version: integer, required

Constraints:
- Version starts at 1.
- Status and priority values must be validated.
- A task cannot be its own parent.
- Project and parent task must belong to the same user.
- Index by user, status, project, and due date.

## 6. task_conversations

Purpose: associate tasks with multiple conversations.

Fields:
- task_id: UUID, foreign key to tasks
- conversation_id: UUID, foreign key to conversations
- relationship_type: text, required
- linked_at: timestamp with time zone

Constraints:
- Composite primary key: task_id and conversation_id.
- Relationship type distinguishes origin from subsequent discussion.
- A task and conversation must have the same owner.

## 7. task_dependencies

Purpose: represent prerequisites between tasks.

Fields:
- task_id: UUID, foreign key to tasks
- depends_on_task_id: UUID, foreign key to tasks
- dependency_type: text, required
- created_at: timestamp with time zone

Constraints:
- Composite primary key: task_id and depends_on_task_id.
- A task cannot depend on itself.
- Both tasks must have the same owner.
- Circular dependencies must be prevented by application-level validation.

## 8. decisions

Purpose: preserve important agreed choices and their rationale.

Fields:
- id: UUID, primary key
- user_id: UUID, foreign key to users
- project_id: UUID, nullable foreign key to projects
- conversation_id: UUID, nullable foreign key to conversations
- summary: text, required
- rationale: text, optional
- status: text, required
- decided_at: timestamp with time zone, optional
- supersedes_id: UUID, nullable self-reference
- created_at: timestamp with time zone
- updated_at: timestamp with time zone

Constraints:
- Summary cannot be blank.
- Superseded decisions remain in history.
- All referenced records must belong to the same user.

## 9. activity_events

Purpose: maintain an append-only audit history.

Fields:
- id: UUID, primary key
- user_id: UUID, foreign key to users
- task_id: UUID, nullable foreign key to tasks
- project_id: UUID, nullable foreign key to projects
- conversation_id: UUID, nullable foreign key to conversations
- decision_id: UUID, nullable foreign key to decisions
- actor_type: text, required
- actor_id: UUID, optional
- event_type: text, required
- old_value: JSONB, optional
- new_value: JSONB, optional
- idempotency_key: text, optional
- occurred_at: timestamp with time zone

Constraints:
- Each event must reference its affected entity or entities.
- Idempotency keys are unique within the appropriate user and operation scope.
- Events cannot be silently rewritten or deleted through ordinary application operations.
- The related state mutation and event insertion must occur in one transaction.

## 10. Database-wide rules

- Use UUID primary keys.
- Use TIMESTAMPTZ for timestamps.
- Enforce ownership and foreign-key integrity.
- Index columns used frequently in filters and joins.
- Validate allowed statuses and types.
- Use transactions for multi-table mutations.
- Use optimistic concurrency through tasks.version.
- Keep migrations version-controlled and reversible where practical.



# ChatLedger Database Schema (V2)

PostgreSQL is the canonical persistence layer. Schema changes are applied incrementally via `services/api/migrations/`.

## 1. `schema_migrations`
Tracks applied migration versions (`001_initial_schema`, `002_filesystem_and_task_hierarchy`, ...).

## 2. `users`
- `id` (UUID PK), `email` (TEXT UNIQUE), `display_name` (TEXT), `created_at`, `updated_at`.
- Deleting a user cleans up dependent `task_nodes`, `tasks`, `decisions`, `projects`, and `project_nodes` via `trg_users_before_delete_cleanup` and `ON DELETE CASCADE`.

## 3. `projects`
- `id` (UUID PK), `user_id` (UUID FK -> `users`), `name` (TEXT), `description` (TEXT), `created_at`, `updated_at`.
- `UNIQUE (user_id, name)` and `UNIQUE (id, user_id)`.
- Creating a project via `createProject` atomically creates its root `project_node` (`parent_id IS NULL`, `node_type = 'folder'`, `lifecycle_state = 'planned'`).
- Deleting a project is restricted (`RESTRICT`) while `tasks` or `decisions` reference it. Once tasks and decisions are cleared, `trg_projects_before_delete_cleanup` removes its multi-level `project_nodes` tree bottom-up.

## 4. `project_nodes`
- `id` (UUID PK)
- `user_id` (UUID FK -> `users`)
- `project_id` (UUID, composite FK `(project_id, user_id)` -> `projects(id, user_id) ON DELETE CASCADE`)
- `parent_id` (UUID, nullable composite FK `(parent_id, project_id, user_id)` -> `project_nodes(id, project_id, user_id) ON DELETE RESTRICT`)
- `node_type` (`folder` | `subsystem` | `file` | `specification` | `artifact`)
- `name` (TEXT, non-blank)
- `relative_path` (TEXT, nullable)
- `description` (TEXT, nullable)
- `lifecycle_state` (`planned` | `present` | `modified` | `missing` | `archived`)
- `sort_order` (INTEGER, default `0`)
- `metadata` (JSONB object, default `'{}'`)
- `source_conversation_id` (UUID, nullable FK -> `conversations(id) ON DELETE SET NULL`)
- `version` (INTEGER, default `1`, `> 0`)
- `created_at`, `updated_at`, `archived_at` (TIMESTAMPTZ)

### Key Constraints & Indexes on `project_nodes`
- `uq_project_nodes_single_root`: `UNIQUE (project_id) WHERE parent_id IS NULL`
- `uq_project_nodes_active_sibling_name`: `UNIQUE (project_id, parent_id, lower(btrim(name))) WHERE parent_id IS NOT NULL AND lifecycle_state <> 'archived'`
- `chk_project_nodes_root_invariants`: Root node must have `node_type = 'folder'`, `lifecycle_state <> 'archived'`, and `archived_at IS NULL`.
- `trg_project_nodes_hierarchy_guard`: Serializes project tree moves with `pg_advisory_xact_lock`, validates `source_conversation_id` ownership, and rejects ancestor cycles.
- `trg_prevent_root_node_delete`: Blocks deleting a project's root node while the project exists.

## 5. `tasks`
- `id` (UUID PK), `user_id` (UUID FK -> `users`), `project_id` (UUID, nullable composite FK -> `projects(id, user_id) ON DELETE RESTRICT`)
- `parent_task_id` (UUID, nullable composite FK `(parent_task_id, user_id)` -> `tasks(id, user_id) ON DELETE RESTRICT`)
- `title` (TEXT), `description` (TEXT), `acceptance_criteria` (TEXT)
- `status` (`Proposed` | `Open` | `In Progress` | `Blocked` | `Done` | `Cancelled`)
- `priority` (`low` | `medium` | `high` | `urgent`)
- `due_at` (TIMESTAMPTZ), `version` (INTEGER), `created_at`, `updated_at`
- `trg_tasks_hierarchy_and_scope_guard`: Enforces that `parent.project_id IS NOT DISTINCT FROM child.project_id` (matching both UUIDs and `NULL`), blocks cycles, and prevents changing a task's `project_id` while it has subtasks or linked nodes.

## 6. `task_nodes`
- `task_id` (UUID), `node_id` (UUID), `user_id` (UUID), `relationship` (`target` | `context` | `verification` | `output`), `created_at` (TIMESTAMPTZ).
- Composite PK `(task_id, node_id)`.
- Composite FKs to `tasks(id, user_id)` and `project_nodes(id, user_id)` (`ON DELETE CASCADE`).
- `trg_task_nodes_scope_guard`: Enforces that the task is assigned to a project and matches the node's `project_id`.

## 7. `conversations`, `projects_conversations`, `task_conversations`, `task_dependencies`, `decisions`, `activity_events`
Preserved from `001_initial_schema.sql`.