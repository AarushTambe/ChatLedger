
# ChatLedger

ChatLedger is a conversation-linked project filesystem and task management system.

It connects conversations, projects, decisions, and tasks through persistent records so work can continue across conversations without losing its state.

## Core principles

- PostgreSQL is the source of truth for task state.
- Tasks can link to multiple conversations.
- Decisions and important state changes are recorded.
- The dashboard and ChatGPT integration use the same backend.
- AI-generated summaries never override authoritative task records.
- Every important state transition is verifiable and auditable.

## Planned architecture

- `apps/` — web interfaces
- `services/` — API, persistence, and integration services
- `data-model/` — domain model and schema documentation
- `docs/` — architecture, requirements, and decisions
- `tests/` — automated verification

## Development status

Phase 0: Repository and development environment.

The application is not yet implemented. Architecture and implementation details will be added as they are verified.

## Design constraint

ChatGPT conversation access and synchronization depend on the integration capabilities actually exposed by the platform. ChatLedger maintains its own durable state and does not assume unrestricted access to ChatGPT's internal memory or conversation history.
