
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
