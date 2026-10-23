
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
