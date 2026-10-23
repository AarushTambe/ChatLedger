
# Task State Transitions

## 1. Status values

### Proposed
Suggested by an assistant or another source but not yet confirmed.

### Open
Confirmed and ready to be worked on.

### In Progress
Work has started.

### Blocked
Work cannot proceed until a dependency or obstacle is resolved.

### Done
The task has been explicitly completed or its completion has been verified.

### Cancelled
The task has been intentionally abandoned.

## 2. Allowed transitions

- Proposed -> Open
- Proposed -> Cancelled
- Open -> In Progress
- Open -> Blocked
- Open -> Done
- Open -> Cancelled
- In Progress -> Blocked
- In Progress -> Done
- In Progress -> Open
- In Progress -> Cancelled
- Blocked -> Open
- Blocked -> In Progress
- Blocked -> Cancelled
- Done -> Open, when explicitly reopened
- Cancelled -> Open, when explicitly reinstated

All transitions must be validated by the backend.

## 3. Completion rules

A task is not Done merely because an assistant recommended it.

A task can be marked Done when:
- The user explicitly marks it complete; or
- A trusted integration verifies the relevant action.

Record the actor and source of the completion event.

## 4. Parent and subtask rules

A parent task may have multiple subtasks.

Completing every subtask does not silently complete the parent.

The application may suggest that the parent is ready for completion, but the parent status must follow an explicit completion rule.

## 5. Audit rules

Every status change creates an activity event.

A status change and its event must be committed in the same database transaction.

Retries must not duplicate the same logical mutation.

## 6. Concurrency rules

Updates include the expected task version.

If the stored version has changed, reject the stale update and return the latest state.

The client can then refresh and retry deliberately.
