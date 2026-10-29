-- Migration 003: Database triggers for hierarchy cycles, root deletion protection,
-- task/node project scope enforcement, and multi-level deletion cleanup.

-- Trigger 1: Prevent node hierarchy cycles & root demotion/promotion
CREATE OR REPLACE FUNCTION fn_project_nodes_hierarchy_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_cycle_found BOOLEAN;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('project_nodes_tree'), hashtext(NEW.project_id::text));

    IF TG_OP = 'UPDATE' THEN
        IF OLD.parent_id IS NULL AND NEW.parent_id IS NOT NULL THEN
            RAISE EXCEPTION 'Cannot assign a parent to the project root node %', NEW.id
                USING ERRCODE = '23514';
        END IF;
        IF OLD.parent_id IS NOT NULL AND NEW.parent_id IS NULL THEN
            RAISE EXCEPTION 'Cannot promote a child node % to a project root node', NEW.id
                USING ERRCODE = '23514';
        END IF;
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.parent_id IS NOT NULL AND NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
        WITH RECURSIVE ancestors AS (
            SELECT pn.id, pn.parent_id
            FROM project_nodes pn
            WHERE pn.id = NEW.parent_id
              AND pn.project_id = NEW.project_id
              AND pn.user_id = NEW.user_id
            UNION ALL
            SELECT p.id, p.parent_id
            FROM project_nodes p
            INNER JOIN ancestors a ON p.id = a.parent_id
            WHERE p.project_id = NEW.project_id
              AND p.user_id = NEW.user_id
        )
        SELECT EXISTS (
            SELECT 1 FROM ancestors WHERE id = NEW.id
        ) INTO v_cycle_found;

        IF v_cycle_found THEN
            RAISE EXCEPTION 'Node hierarchy cycle detected for node %', NEW.id
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_project_nodes_hierarchy_guard ON project_nodes;
CREATE TRIGGER trg_project_nodes_hierarchy_guard
BEFORE INSERT OR UPDATE OF parent_id, project_id, user_id
ON project_nodes
FOR EACH ROW
EXECUTE FUNCTION fn_project_nodes_hierarchy_guard();


-- Trigger 2: Prevent accidental deletion of a project's root node while the project exists
CREATE OR REPLACE FUNCTION fn_prevent_root_node_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.parent_id IS NULL THEN
        IF current_setting('chatledger.allowing_project_cleanup', true) IS DISTINCT FROM 'true'
           AND EXISTS (SELECT 1 FROM projects p WHERE p.id = OLD.project_id) THEN
            RAISE EXCEPTION 'Cannot delete root node % while project % exists', OLD.id, OLD.project_id
                USING ERRCODE = '23503';
        END IF;
    END IF;
    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_root_node_delete ON project_nodes;
CREATE TRIGGER trg_prevent_root_node_delete
BEFORE DELETE ON project_nodes
FOR EACH ROW
EXECUTE FUNCTION fn_prevent_root_node_delete();


-- Trigger 3: Enforce task parent-child project scope (including NULL) and prevent task cycles
CREATE OR REPLACE FUNCTION fn_tasks_hierarchy_and_scope_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_parent_user_id    UUID;
    v_parent_project_id UUID;
    v_cycle_found       BOOLEAN;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('tasks_tree'), hashtext(NEW.user_id::text));

    IF NEW.parent_task_id IS NOT NULL THEN
        SELECT t.user_id, t.project_id
        INTO v_parent_user_id, v_parent_project_id
        FROM tasks t
        WHERE t.id = NEW.parent_task_id;

        IF v_parent_user_id IS NULL THEN
            RAISE EXCEPTION 'Parent task % does not exist', NEW.parent_task_id
                USING ERRCODE = '23503';
        END IF;

        IF v_parent_user_id <> NEW.user_id THEN
            RAISE EXCEPTION 'Parent task % belongs to a different user', NEW.parent_task_id
                USING ERRCODE = '23503';
        END IF;

        IF v_parent_project_id IS DISTINCT FROM NEW.project_id THEN
            RAISE EXCEPTION 'Parent task and subtask must share the exact same project scope (parent project_id: %, subtask project_id: %)',
                v_parent_project_id, NEW.project_id
                USING ERRCODE = '23514';
        END IF;

        IF TG_OP = 'UPDATE' AND NEW.parent_task_id IS DISTINCT FROM OLD.parent_task_id THEN
            WITH RECURSIVE ancestors AS (
                SELECT t.id, t.parent_task_id
                FROM tasks t
                WHERE t.id = NEW.parent_task_id
                  AND t.user_id = NEW.user_id
                UNION ALL
                SELECT p.id, p.parent_task_id
                FROM tasks p
                INNER JOIN ancestors a ON p.id = a.parent_task_id
                WHERE p.user_id = NEW.user_id
            )
            SELECT EXISTS (
                SELECT 1 FROM ancestors WHERE id = NEW.id
            ) INTO v_cycle_found;

            IF v_cycle_found THEN
                RAISE EXCEPTION 'Task hierarchy cycle detected for task %', NEW.id
                    USING ERRCODE = '23514';
            END IF;
        END IF;
    END IF;

    IF TG_OP = 'UPDATE' AND NEW.project_id IS DISTINCT FROM OLD.project_id THEN
        IF EXISTS (SELECT 1 FROM tasks c WHERE c.parent_task_id = NEW.id) THEN
            RAISE EXCEPTION 'Cannot change project_id of task % while it has subtasks', NEW.id
                USING ERRCODE = '23514';
        END IF;

        IF EXISTS (SELECT 1 FROM task_nodes tn WHERE tn.task_id = NEW.id) THEN
            RAISE EXCEPTION 'Cannot change project_id of task % while it is linked to project nodes', NEW.id
                USING ERRCODE = '23514';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_hierarchy_and_scope_guard ON tasks;
CREATE TRIGGER trg_tasks_hierarchy_and_scope_guard
BEFORE INSERT OR UPDATE OF parent_task_id, project_id, user_id
ON tasks
FOR EACH ROW
EXECUTE FUNCTION fn_tasks_hierarchy_and_scope_guard();


-- Trigger 4: Enforce that task_nodes links belong to the same project
CREATE OR REPLACE FUNCTION fn_task_nodes_scope_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_task_project_id UUID;
    v_node_project_id UUID;
BEGIN
    SELECT t.project_id INTO v_task_project_id
    FROM tasks t
    WHERE t.id = NEW.task_id AND t.user_id = NEW.user_id;

    SELECT pn.project_id INTO v_node_project_id
    FROM project_nodes pn
    WHERE pn.id = NEW.node_id AND pn.user_id = NEW.user_id;

    IF v_task_project_id IS NULL THEN
        RAISE EXCEPTION 'Cannot link unassigned task % (project_id IS NULL) to a project node', NEW.task_id
            USING ERRCODE = '23514';
    END IF;

    IF v_task_project_id IS DISTINCT FROM v_node_project_id THEN
        RAISE EXCEPTION 'Task % (project %) and node % (project %) must belong to the same project',
            NEW.task_id, v_task_project_id, NEW.node_id, v_node_project_id
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_task_nodes_scope_guard ON task_nodes;
CREATE TRIGGER trg_task_nodes_scope_guard
BEFORE INSERT OR UPDATE OF task_id, node_id, user_id
ON task_nodes
FOR EACH ROW
EXECUTE FUNCTION fn_task_nodes_scope_guard();


-- Trigger 5: Clean multi-level project_nodes bottom-up when a permitted project deletion occurs
CREATE OR REPLACE FUNCTION fn_projects_before_delete_cleanup()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_deleted INT;
BEGIN
    IF EXISTS (SELECT 1 FROM tasks t WHERE t.project_id = OLD.id) THEN
        RAISE EXCEPTION 'Cannot delete project % because tasks still reference it', OLD.id
            USING ERRCODE = '23503';
    END IF;

    IF EXISTS (SELECT 1 FROM decisions d WHERE d.project_id = OLD.id) THEN
        RAISE EXCEPTION 'Cannot delete project % because decisions still reference it', OLD.id
            USING ERRCODE = '23503';
    END IF;

    PERFORM set_config('chatledger.allowing_project_cleanup', 'true', true);

    LOOP
        DELETE FROM project_nodes pn
        WHERE pn.project_id = OLD.id
          AND NOT EXISTS (
              SELECT 1
              FROM project_nodes child
              WHERE child.project_id = OLD.id
                AND child.parent_id = pn.id
          );
        GET DIAGNOSTICS v_deleted = ROW_COUNT;
        EXIT WHEN v_deleted = 0;
    END LOOP;

    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_projects_before_delete_cleanup ON projects;
CREATE TRIGGER trg_projects_before_delete_cleanup
BEFORE DELETE ON projects
FOR EACH ROW
EXECUTE FUNCTION fn_projects_before_delete_cleanup();


-- Trigger 6: Clean dependent hierarchy records when a user is deleted
CREATE OR REPLACE FUNCTION fn_users_before_delete_cleanup()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM set_config('chatledger.allowing_project_cleanup', 'true', true);

    DELETE FROM task_nodes WHERE user_id = OLD.id;

    UPDATE tasks
    SET parent_task_id = NULL
    WHERE user_id = OLD.id
      AND parent_task_id IS NOT NULL;

    DELETE FROM tasks WHERE user_id = OLD.id;
    DELETE FROM decisions WHERE user_id = OLD.id;

    RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_before_delete_cleanup ON users;
CREATE TRIGGER trg_users_before_delete_cleanup
BEFORE DELETE ON users
FOR EACH ROW
EXECUTE FUNCTION fn_users_before_delete_cleanup();