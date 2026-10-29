
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



# Architecture Decision Records

## ADR-001: PostgreSQL is the source of truth
Status: Accepted
Store canonical task state, project structure, decisions, relationships, and activity events in PostgreSQL.

## ADR-002: Conversations are explicit entities
Status: Accepted
Give each ChatLedger conversation an internal ID and link conversations to projects, tasks, nodes, and decisions without assuming automatic visibility into all ChatGPT chats.

## ADR-003: Important changes are auditable
Status: Accepted
Record meaningful mutations as append-only `activity_events` within the same database transaction as the state change.

## ADR-004: Integrations are adapters
Status: Accepted
Keep transport and integration adapters separate from domain and repository logic.

## ADR-005: Logical filesystem tree is distinct from physical files
Status: Accepted
Represent project structure in `project_nodes` with explicit `node_type` (`folder`, `subsystem`, `file`, `specification`, `artifact`) and `lifecycle_state` (`planned`, `present`, `modified`, `missing`, `archived`). A logical path is a reference, not proof of physical file existence.

## ADR-006: Single root node per project and archival name reuse
Status: Accepted
Every project has exactly one root folder (`parent_id IS NULL`, enforced via partial unique index `uq_project_nodes_single_root` and created atomically in `createProject`). Active sibling names are unique per parent via `uq_project_nodes_active_sibling_name`, excluding `archived` nodes so archived names can be cleanly reused.

## ADR-007: Database-enforced hierarchy cycles and nullable project scope
Status: Accepted
Use PostgreSQL composite foreign keys combined with transaction-locked (`pg_advisory_xact_lock`) `BEFORE INSERT OR UPDATE` triggers to prevent ancestor cycles in `project_nodes` and `tasks`, and to guarantee that parent tasks and subtasks share the exact same `project_id` even when `project_id IS NULL`.

## ADR-008: Runner-owned migration transactions
Status: Accepted
`services/api/src/run-migration.ts` is the sole transaction owner for schema migrations, serializing runs via a PostgreSQL advisory lock and rolling back the entire migration file if any statement fails.