
BEGIN;

-- 1. Record which migrations have been applied.
CREATE TABLE schema_migrations (
    version     TEXT PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Users
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Projects
CREATE TABLE projects (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, name),
    UNIQUE (id, user_id)
);

-- 4. Conversations
CREATE TABLE conversations (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    source       TEXT NOT NULL DEFAULT 'manual',
    external_ref TEXT,
    started_at   TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (id, user_id)
);

-- 5. Projects can link to multiple conversations.
CREATE TABLE projects_conversations (
    project_id     UUID NOT NULL,
    conversation_id UUID NOT NULL,
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    linked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (project_id, conversation_id),

    FOREIGN KEY (project_id, user_id)
        REFERENCES projects(id, user_id) ON DELETE CASCADE,

    FOREIGN KEY (conversation_id, user_id)
        REFERENCES conversations(id, user_id) ON DELETE CASCADE
);

-- 6. Tasks
CREATE TABLE tasks (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id  UUID,
    title       TEXT NOT NULL,
    description TEXT,
    status      TEXT NOT NULL DEFAULT 'Open'
        CHECK (status IN (
            'Proposed', 'Open', 'In Progress',
            'Blocked', 'Done', 'Cancelled'
        )),
    priority    TEXT NOT NULL DEFAULT 'medium'
        CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    due_at      TIMESTAMPTZ,
    version     INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    FOREIGN KEY (project_id, user_id)
        REFERENCES projects(id, user_id) ON DELETE RESTRICT
);

-- 7. Link tasks to conversations.
CREATE TABLE task_conversations (
    task_id         UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    linked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (task_id, conversation_id)
);

-- 8. Task dependencies: task_id depends on depends_on_task_id.
CREATE TABLE task_dependencies (
    task_id            UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    depends_on_task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (task_id, depends_on_task_id),
    CHECK (task_id <> depends_on_task_id)
);

-- 9. Decisions recorded for future retrieval.
CREATE TABLE decisions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id      UUID,
    task_id         UUID REFERENCES tasks(id) ON DELETE SET NULL,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    title           TEXT NOT NULL,
    rationale       TEXT,
    details         TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    FOREIGN KEY (project_id, user_id)
        REFERENCES projects(id, user_id) ON DELETE RESTRICT
);

-- 10. Activity history.
CREATE TABLE activity_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    actor_user_id   UUID REFERENCES users(id) ON DELETE SET NULL,
    project_id      UUID REFERENCES projects(id) ON DELETE SET NULL,
    task_id         UUID REFERENCES tasks(id) ON DELETE SET NULL,
    conversation_id UUID REFERENCES conversations(id) ON DELETE SET NULL,
    event_type      TEXT NOT NULL,
    entity_type     TEXT NOT NULL,
    entity_id       UUID NOT NULL,
    payload         JSONB NOT NULL DEFAULT '{}'::JSONB,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Common retrieval and filtering indexes.
CREATE INDEX idx_projects_user
    ON projects(user_id);

CREATE INDEX idx_conversations_user_updated
    ON conversations(user_id, updated_at DESC);

CREATE INDEX idx_tasks_user_status
    ON tasks(user_id, status);

CREATE INDEX idx_tasks_project
    ON tasks(project_id);

CREATE INDEX idx_task_conversations_conversation
    ON task_conversations(conversation_id);

CREATE INDEX idx_dependencies_prerequisite
    ON task_dependencies(depends_on_task_id);

CREATE INDEX idx_decisions_project
    ON decisions(project_id);

CREATE INDEX idx_activity_user_time
    ON activity_events(user_id, occurred_at DESC);

CREATE INDEX idx_activity_task_time
    ON activity_events(task_id, occurred_at DESC);

-- Mark this migration as applied.
INSERT INTO schema_migrations (version)
VALUES ('001_initial_schema');

COMMIT;
