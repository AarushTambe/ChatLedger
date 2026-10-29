CREATE TABLE project_nodes (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id              UUID NOT NULL,
    parent_id               UUID,
    node_type               TEXT NOT NULL
        CHECK (node_type IN ('folder', 'subsystem', 'file', 'specification', 'artifact')),
    name                    TEXT NOT NULL
        CHECK (btrim(name) <> ''),
    relative_path           TEXT,
    description             TEXT,
    lifecycle_state         TEXT NOT NULL DEFAULT 'planned'
        CHECK (lifecycle_state IN ('planned', 'present', 'modified', 'missing', 'archived')),
    sort_order              INTEGER NOT NULL DEFAULT 0,
    metadata                JSONB NOT NULL DEFAULT '{}'::JSONB
        CHECK (jsonb_typeof(metadata) = 'object'),
    source_conversation_id  UUID,
    version                 INTEGER NOT NULL DEFAULT 1
        CHECK (version > 0),
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived_at             TIMESTAMPTZ,

    -- Composite uniqueness for child and cross-table references
    CONSTRAINT uq_project_nodes_id_project_user
        UNIQUE (id, project_id, user_id),
    CONSTRAINT uq_project_nodes_id_user
        UNIQUE (id, user_id),

    -- Ownership and project scope
    CONSTRAINT fk_project_nodes_project_user
        FOREIGN KEY (project_id, user_id)
        REFERENCES projects(id, user_id) ON DELETE CASCADE,

    -- Parent-child same-project and same-user scope
    CONSTRAINT fk_project_nodes_parent
        FOREIGN KEY (parent_id, project_id, user_id)
        REFERENCES project_nodes(id, project_id, user_id) ON DELETE RESTRICT,

    -- Provenance scope
    CONSTRAINT fk_project_nodes_conversation
        FOREIGN KEY (source_conversation_id, user_id)
        REFERENCES conversations(id, user_id) ON DELETE SET NULL (source_conversation_id),

    -- Self-parenting and root constraints
    CONSTRAINT chk_project_nodes_not_self_parent
        CHECK (id <> parent_id),
    CONSTRAINT chk_project_nodes_root_invariants
        CHECK (
            parent_id IS NOT NULL
            OR (node_type = 'folder' AND lifecycle_state <> 'archived' AND archived_at IS NULL)
        ),
    CONSTRAINT chk_project_nodes_archived_consistency
        CHECK (
            (lifecycle_state = 'archived' AND archived_at IS NOT NULL)
            OR (lifecycle_state <> 'archived' AND archived_at IS NULL)
        )
);


ALTER TABLE tasks
    ADD CONSTRAINT uq_tasks_id_user UNIQUE (id, user_id);

ALTER TABLE tasks
    ADD COLUMN parent_task_id UUID,
    ADD COLUMN acceptance_criteria TEXT,
    ADD CONSTRAINT fk_tasks_parent_user
        FOREIGN KEY (parent_task_id, user_id)
        REFERENCES tasks(id, user_id) ON DELETE RESTRICT,
    ADD CONSTRAINT chk_tasks_not_self_parent
        CHECK (id <> parent_task_id);

CREATE TABLE task_nodes (
    task_id       UUID NOT NULL,
    node_id       UUID NOT NULL,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    relationship  TEXT NOT NULL DEFAULT 'target'
        CHECK (relationship IN ('target', 'context', 'verification', 'output')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    PRIMARY KEY (task_id, node_id),

    CONSTRAINT fk_task_nodes_task_user
        FOREIGN KEY (task_id, user_id)
        REFERENCES tasks(id, user_id) ON DELETE CASCADE,

    CONSTRAINT fk_task_nodes_node_user
        FOREIGN KEY (node_id, user_id)
        REFERENCES project_nodes(id, user_id) ON DELETE CASCADE
);


-- Exactly one root node (parent_id IS NULL) per project
CREATE UNIQUE INDEX uq_project_nodes_single_root
    ON project_nodes(project_id)
    WHERE parent_id IS NULL;

-- Active sibling name uniqueness (case-insensitive, trimmed); archived nodes excluded
CREATE UNIQUE INDEX uq_project_nodes_active_sibling_name
    ON project_nodes(project_id, parent_id, lower(btrim(name)))
    WHERE parent_id IS NOT NULL AND lifecycle_state <> 'archived';

-- Tree traversal & ordering
CREATE INDEX idx_project_nodes_parent_order
    ON project_nodes(project_id, parent_id, sort_order, name);

-- Task hierarchy lookup
CREATE INDEX idx_tasks_parent
    ON tasks(parent_task_id)
    WHERE parent_task_id IS NOT NULL;

-- Reverse lookup from node to tasks
CREATE INDEX idx_task_nodes_node
    ON task_nodes(node_id);


INSERT INTO project_nodes (
    user_id,
    project_id,
    parent_id,
    node_type,
    name,
    relative_path,
    description,
    lifecycle_state,
    sort_order,
    metadata
)
SELECT
    p.user_id,
    p.id,
    NULL,
    'folder',
    p.name,
    '',
    'Logical project root folder',
    'planned',
    0,
    '{"is_root": true, "backfilled": true}'::jsonb
FROM projects p
WHERE NOT EXISTS (
    SELECT 1
    FROM project_nodes pn
    WHERE pn.project_id = p.id
      AND pn.parent_id IS NULL
);