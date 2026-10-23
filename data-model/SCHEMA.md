
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
