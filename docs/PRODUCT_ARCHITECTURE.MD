# ChatLedger — Product Architecture V2

**Status:** Proposed architecture  
**Product:** ChatLedger  
**Parent system:** Framer  
**Development approach:** Local-first, single-user initially

## 1. Product objective

ChatLedger is the persistent project-state, context-retrieval, and knowledge-organization layer for AI-assisted software development.

Its purpose is to maintain a coherent representation of a software project across conversations, coding sessions, implementation tools, and changes in context.

ChatGPT remains the primary conversational interface. ChatLedger provides the structured state that allows an AI client to understand what a project contains, why it is designed a certain way, what has been implemented, what remains incomplete, and where to resume work.

ChatLedger is intended to become an integrated component of Framer.

### Core principle

The project is hierarchical and interconnected. The conversation is linear. ChatLedger bridges the two.

## 2. Architectural principles

1. **Persistent state over transcript dependence.** Current project state must be retrievable without rereading the entire conversation history.
2. **Hierarchy plus relationships.** Objects have parent-child relationships and may reference related objects elsewhere in the project.
3. **Separation of concerns.** Files, folders, tasks, decisions, conversations, and implementation results are distinct entities.
4. **AI-assisted maintenance.** AI clients should create and update project state through explicit, structured operations.
5. **Traceability.** Important changes must record their source, timestamp, and relevant context.
6. **Idempotency.** Repeating an operation should not create duplicate objects when the intended operation is an update.
7. **Safe mutation.** Structural changes must be validated, version-aware, and auditable.
8. **Retrieval before implementation.** The system should retrieve relevant project context before substantial work begins.
9. **Verification before completion.** Tasks should not be marked complete merely because code was generated.
10. **Integration over duplication.** ChatLedger and Framer should share capabilities through defined interfaces rather than maintain competing representations of project state.

## 3. Conceptual architecture

### 3.1 Conversational interface

The user communicates through ChatGPT or another supported AI client.

The interface is responsible for understanding intent, reasoning about requirements, and coordinating work through available tools.

ChatLedger does not require users to conduct their primary work through a separate chat interface.

### 3.2 ChatLedger service

The service exposes structured operations for:

- Creating and resolving projects.
- Reading and updating the project tree.
- Creating and updating filesystem nodes.
- Creating tasks and subtasks.
- Recording decisions and dependencies.
- Associating conversations and implementation artifacts.
- Searching and retrieving context.
- Recording activity and verification results.

### 3.3 Persistent data layer

PostgreSQL is the authoritative store for structured project state, object relationships, versions, and activity history.

Retrieval indexes may be introduced or reused through Framer. They must remain derived representations of authoritative data, not competing sources of truth.

### 3.4 Implementation environment

The implementation environment provides access to actual source files and supported development operations such as reading files, applying changes, running commands, and executing tests.

A logical filesystem node is not itself a source file. The node must reference the actual artifact when one exists.

### 3.5 Dashboard

The dashboard provides navigation, inspection, correction, and auditing of the project state maintained by the system.

It should expose the hierarchy and relationships rather than reduce the project to a flat list of tasks.

## 4. Domain model

### 4.1 Workspace

Represents the user's working environment and contains projects.

The initial system supports one user. The model should avoid unnecessary assumptions that would prevent future team support.

### 4.2 Project

Represents a software product, application, or other coherent body of work.

A project contains a root node, project metadata, architectural decisions, conversations, implementation artifacts, tasks, and activity history.

### 4.3 Filesystem node

Represents an element in the logical project tree.

Initial node types:

- `folder`: A structural container.
- `subsystem`: A bounded area such as frontend, backend, database, or authentication.
- `file`: A logical representation of a file, whether planned or already present.
- `specification`: A requirements document or technical specification.
- `artifact`: A report, generated output, design, test result, or other deliverable.

Nodes may have a parent node, sibling ordering, metadata, references, and version history.

A node may exist before its implementation. A logical file must not be represented as an actual file on disk until that file has been created or verified.

### 4.4 Task

Represents a unit of work that changes or validates project state.

Tasks support parent-child relationships, dependencies, status, priority, and references to the nodes and artifacts involved.

A task may span multiple files. A file may be associated with multiple tasks over its lifetime.

Initial task statuses:

- `proposed`
- `open`
- `in_progress`
- `blocked`
- `done`
- `cancelled`

Task completion must reflect the defined acceptance criteria and available verification evidence.

### 4.5 Conversation

Represents a known conversational session or an identifiable source of project context.

A conversation may contribute requirements, decisions, implementation details, debugging findings, or task updates.

A conversation may relate to many project objects, and each project object may reference multiple conversations.

Conversation content should only be stored or retrieved through supported mechanisms and with appropriate access controls.

### 4.6 Decision

Represents an explicit architectural, technical, or product decision.

A decision records the chosen approach, rationale, alternatives when known, status, and source context.

Decisions may reference projects, nodes, tasks, and conversations.

Superseded decisions remain available for historical traceability but must not be presented as current guidance.

### 4.7 Dependency

Represents a relationship in which one task or component relies on another.

Dependencies must be explicit and validated. Task dependency cycles must be prevented where they would make execution ordering impossible.

### 4.8 Activity event

Represents an auditable change or meaningful event.

Examples include node creation, task completion, decision supersession, file modification, test execution, and retrieval-driven context updates.

Events should identify the actor, affected object, timestamp, source where available, and relevant change details.

## 5. Relationships and hierarchy

The model must support both a tree and a graph.

The tree provides predictable navigation and subsystem boundaries. Cross-references connect objects that cannot be represented adequately by parent-child relationships alone.

Examples:

- A project contains a backend subsystem.
- The backend contains an authentication folder.
- An authentication task references multiple files.
- A file references the conversation that introduced its requirements.
- A decision affects the backend and several tasks.
- A test result references the code revision and task it verifies.

Parent-child relationships must remain acyclic. Cross-references may connect different branches.

The system must distinguish structural containment from semantic relationships.

## 6. AI access contract

The service should expose versioned operations through an API and a supported AI-tool interface, such as MCP where available.

The initial operation groups are:

### Project discovery

- Resolve an existing project.
- Create a project when explicitly required.
- Retrieve project metadata and its root node.

### Tree operations

- Retrieve a project tree.
- Retrieve a selected subtree.
- Create or update a node.
- Move a node after validating the new parent and preserving history.
- Search nodes by name, content, type, or metadata.

### Task operations

- Create tasks and subtasks.
- Link tasks to nodes and conversations.
- Retrieve task dependencies and acceptance criteria.
- Update task state using optimistic concurrency.
- Record verification evidence.

### Context operations

- Search project objects.
- Retrieve related decisions and relevant activity.
- Build a bounded context package for a specific request.
- Return references and provenance for retrieved information.

### History operations

- Record meaningful changes.
- Retrieve object history.
- Identify the source of a change.
- Preserve superseded decisions and prior states where appropriate.

Operations must have defined input schemas, output schemas, authorization rules, validation, and error behavior.

## 7. Context retrieval and resumption

When substantial project work begins, the AI client should retrieve context in a deliberate sequence.

1. Resolve the project and the current objective.
2. Retrieve the project summary and relevant architecture.
3. Identify the affected subsystem or subtree.
4. Retrieve associated tasks, decisions, dependencies, and artifacts.
5. Inspect actual source files through available implementation tools when needed.
6. Construct a bounded working context with references to its sources.
7. Perform the requested work.
8. Persist verified changes and update affected project objects.

Retrieval should prioritize relevance rather than return the entire project indiscriminately.

The context package should distinguish current facts, historical information, assumptions, and unresolved questions.

If information is missing or conflicting, the system must surface that uncertainty rather than invent project state.

## 8. Conversation-to-state workflow

A conversation can introduce requirements, create a subsystem, generate implementation work, or revise an existing decision.

When the AI client has the required tools and invokes them, it should:

1. Resolve the relevant project.
2. Determine which existing objects are affected.
3. Create or update the minimum necessary objects.
4. Establish relationships and provenance.
5. Record meaningful changes.
6. Return a concise summary of what changed and any unresolved issues.

The workflow must be idempotent where possible. Repeated processing of the same source should not create duplicate tasks or nodes.

The system must not assume that every ChatGPT conversation is automatically visible to ChatLedger. Integration depends on supported tool connections, access permissions, and actual tool invocation.

## 9. Implementation and verification workflow

Implementation work should follow a closed loop:

**Understand → Retrieve → Plan → Inspect → Implement → Verify → Persist**

Before modifying source files, the AI client should inspect the relevant current files and applicable decisions.

After modification, it should record actual changes and verification results. A generated patch is not equivalent to a successfully applied patch, and a successful build is not proof that every acceptance criterion has been met.

Task state should reflect evidence:

- Work not started: `open`
- Work actively underway: `in_progress`
- Work waiting on an identified blocker: `blocked`
- Acceptance criteria satisfied with appropriate evidence: `done`

The service should not infer successful implementation solely from conversation wording.

## 10. Data integrity and concurrency

Every mutable object should have a defined identity and update strategy.

Where concurrent updates are possible, use optimistic concurrency with an expected version or equivalent mechanism.

Mutations must validate:

- Object ownership and project scope.
- Valid parent-child relationships.
- Allowed state transitions.
- Dependency integrity.
- Duplicate prevention.
- Version conflicts.

Important mutations should create activity records within the same transaction where feasible.

Destructive operations should preserve necessary historical information and must not silently restructure unrelated branches.

## 11. Physical files and logical nodes

ChatLedger's logical tree describes the project; the implementation environment contains the actual files.

The relationship between them must be explicit.

For a file node, the system may track a relative path, artifact identifier, observed status, and relevant revision information.

Possible states include planned, present, modified, missing, and archived.

File existence and content must be verified through the implementation environment rather than inferred from a database record.

ChatLedger should not duplicate entire source files into PostgreSQL without a defined need. References, metadata, revision identifiers, and selected content excerpts are generally preferable.

## 12. Framer integration

ChatLedger is intended to become a component of Framer.

The integration boundary should allow Framer to:

- Query project state.
- Retrieve bounded context.
- Search indexed project content.
- Resolve object relationships.
- Access implementation references.
- Record execution outcomes and project updates.

Framer's existing retrieval architecture—repository, index, retrieval engine, and MCP interface—should be evaluated for reuse.

The design should not assume that all responsibilities require separate processes or databases. Shared libraries and services are acceptable when they preserve clear ownership and interfaces.

PostgreSQL remains authoritative for structured project state. Search indexes are optimized retrieval mechanisms and can be rebuilt from their source data when necessary.

## 13. Local-first development and deployment

Initial development runs locally.

The current PostgreSQL database and API should be preserved. Changes to the schema must use incremental migrations rather than dropping and recreating existing tables.

The current Next.js frontend and Express API remain the starting point.

Deployment to Vercel or another environment will be considered after the core data model, retrieval contract, and implementation workflow are validated.

Public deployment requires appropriate authentication, authorization, secret management, and protection of project data. The current local development identity is not sufficient for a publicly accessible service.

## 14. Non-goals for the current phase

The current phase does not aim to:

- Recreate a general-purpose coding agent.
- Build a replacement for ChatGPT.
- Require users to manually manage every task.
- Treat conversations as the sole source of current project truth.
- Introduce a vector database before retrieval requirements justify it.
- Build multi-user collaboration before the single-user workflow is sound.
- Add dashboard features that depend on an unapproved data model.
- Promise automatic access to conversations or files that the integration cannot actually reach.

## 15. Acceptance criteria for the architecture

The architecture is ready to guide implementation when it can support the following end-to-end behavior:

1. A project has a navigable hierarchical structure.
2. Subsystems can have their own nested trees.
3. Planned files and actual files are distinguishable.
4. Tasks can contain subtasks and reference multiple files.
5. Conversations and decisions are linked to relevant project objects.
6. A bounded subtree and its related context can be retrieved efficiently.
7. Changes are traceable and protected against stale updates.
8. AI-tool operations are explicit, validated, and repeatable.
9. Actual implementation and verification results can update project state.
10. Framer can reuse the relevant retrieval and state interfaces without duplicating the source of truth.
11. The existing database can be migrated incrementally without losing valid data.

## 16. Immediate implementation sequence

1. Review the existing database schema, repository functions, and API.
2. Map existing entities to the proposed domain model.
3. Identify missing entities and relationships.
4. Design an incremental migration for the filesystem and graph model.
5. Implement repository-level operations and regression tests.
6. Add the context-retrieval service.
7. Expose the required operations through the API and supported AI-tool interface.
8. Adapt the dashboard to inspect the actual project tree.
9. Validate the complete conversation-to-context-to-implementation workflow.
10. Define the Framer integration contract using the validated implementation.

**Decision rule:** No further feature work should undermine the hierarchical project model or introduce a competing representation of project state.