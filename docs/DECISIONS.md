
# Architecture Decision Records

## ADR-001: PostgreSQL is the source of truth

Status: Accepted

### Context
Conversation text and AI-generated summaries are not reliable transactional storage for task status.

### Decision
Store canonical task state, decisions, relationships, and activity events in PostgreSQL.

### Consequences
Task state persists independently of a chat session. All interfaces must use the backend to read or mutate canonical state.

## ADR-002: Conversations are explicit entities

Status: Accepted

### Context
Tasks may originate in one conversation and be discussed in another.

### Decision
Give each ChatLedger conversation an internal ID and use a relationship table to link tasks to multiple conversations.

### Consequences
Cross-chat work can share a canonical task without duplicating it. External ChatGPT IDs remain optional.

## ADR-003: Important changes are auditable

Status: Accepted

### Context
Overwriting a status without preserving its history makes progress difficult to verify.

### Decision
Record important mutations as append-only activity events. Write each event in the same database transaction as its associated state change.

### Consequences
The system can explain what changed and when. Event history requires explicit access controls and retention policies.

## ADR-004: Integrations are adapters

Status: Accepted

### Context
ChatGPT integration capabilities and permissions may vary.

### Decision
Keep integration-specific logic separate from the domain and persistence layers.

### Consequences
The dashboard and backend remain usable independently of ChatGPT integration availability.
