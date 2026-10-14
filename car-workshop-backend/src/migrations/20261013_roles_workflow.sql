-- ═══════════════════════════════════════════════════════════════════════
-- Roles for the Steps 1–7 workflow.
--
-- 1. roles.capabilities — the workflow responsibilities a role holds
--    (lib/roles.js CAPABILITIES: job.open, estimate.raise, estimate.price_parts,
--    estimate.approve, customer.approval, job.assign, time.book,
--    parts.request, store.issue, qc.perform, delivery.handover).
--    NULL = the defaults for the role's slug, from the process document.
--    Settings → Roles writes an explicit list when someone changes it.
--
-- 2. Menu modules. Estimates, Fleet Intake, Team Board and Store used to ride
--    on other modules (work-orders, job-assignment, inventory), so they could
--    not be granted on their own. They now have their own keys. This only
--    ADDS keys — no role loses a screen it can open today, except that the
--    floor roles (Team Leader, Foreman) and the Store no longer see Fleet
--    Intake / Estimates they had only by accident of sharing a key.
--
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'roles' AND column_name = 'capabilities');
SET @sql := IF(@col = 0, 'ALTER TABLE roles ADD COLUMN capabilities JSON NULL AFTER modules', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Helper pattern: append a module key to the roles listed, if missing.
-- estimates
UPDATE roles SET modules = JSON_ARRAY_APPEND(COALESCE(modules, JSON_ARRAY()), '$', 'estimates')
 WHERE slug IN ('general_manager','workshop_manager','service_advisor','supervisor','storekeeper','part_advisor')
   AND NOT JSON_CONTAINS(COALESCE(modules, JSON_ARRAY()), '"estimates"');
-- fleet-intake
UPDATE roles SET modules = JSON_ARRAY_APPEND(COALESCE(modules, JSON_ARRAY()), '$', 'fleet-intake')
 WHERE slug IN ('general_manager','workshop_manager','service_advisor')
   AND NOT JSON_CONTAINS(COALESCE(modules, JSON_ARRAY()), '"fleet-intake"');
-- team-leader (Team Board)
UPDATE roles SET modules = JSON_ARRAY_APPEND(COALESCE(modules, JSON_ARRAY()), '$', 'team-leader')
 WHERE slug IN ('general_manager','workshop_manager','supervisor','workshop_foreman','team_leader')
   AND NOT JSON_CONTAINS(COALESCE(modules, JSON_ARRAY()), '"team-leader"');
-- store
UPDATE roles SET modules = JSON_ARRAY_APPEND(COALESCE(modules, JSON_ARRAY()), '$', 'store')
 WHERE slug IN ('general_manager','workshop_manager','storekeeper','part_advisor')
   AND NOT JSON_CONTAINS(COALESCE(modules, JSON_ARRAY()), '"store"');
-- the Workshop Manager also gets parts / inventory; the Supervisor the technicians list
UPDATE roles SET modules = JSON_ARRAY_APPEND(modules, '$', 'parts')
 WHERE slug = 'workshop_manager' AND NOT JSON_CONTAINS(COALESCE(modules, JSON_ARRAY()), '"parts"');
UPDATE roles SET modules = JSON_ARRAY_APPEND(modules, '$', 'inventory')
 WHERE slug = 'workshop_manager' AND NOT JSON_CONTAINS(COALESCE(modules, JSON_ARRAY()), '"inventory"');
UPDATE roles SET modules = JSON_ARRAY_APPEND(modules, '$', 'mechanics')
 WHERE slug = 'supervisor' AND NOT JSON_CONTAINS(COALESCE(modules, JSON_ARRAY()), '"mechanics"');

-- Custom roles keep exactly what they could open before. (The seeded roles
-- are not flagged is_system on every install, so match them by slug.)
UPDATE roles SET modules = JSON_ARRAY_APPEND(modules, '$', 'estimates')
 WHERE slug NOT IN ('general_manager','workshop_manager','service_advisor','part_advisor','supervisor','workshop_foreman','team_leader','storekeeper','customer','super_admin') AND JSON_CONTAINS(COALESCE(modules, JSON_ARRAY()), '"work-orders"') AND NOT JSON_CONTAINS(modules, '"estimates"');
UPDATE roles SET modules = JSON_ARRAY_APPEND(modules, '$', 'fleet-intake')
 WHERE slug NOT IN ('general_manager','workshop_manager','service_advisor','part_advisor','supervisor','workshop_foreman','team_leader','storekeeper','customer','super_admin') AND JSON_CONTAINS(COALESCE(modules, JSON_ARRAY()), '"work-orders"') AND NOT JSON_CONTAINS(modules, '"fleet-intake"');
UPDATE roles SET modules = JSON_ARRAY_APPEND(modules, '$', 'team-leader')
 WHERE slug NOT IN ('general_manager','workshop_manager','service_advisor','part_advisor','supervisor','workshop_foreman','team_leader','storekeeper','customer','super_admin') AND JSON_CONTAINS(COALESCE(modules, JSON_ARRAY()), '"job-assignment"') AND NOT JSON_CONTAINS(modules, '"team-leader"');
UPDATE roles SET modules = JSON_ARRAY_APPEND(modules, '$', 'store')
 WHERE slug NOT IN ('general_manager','workshop_manager','service_advisor','part_advisor','supervisor','workshop_foreman','team_leader','storekeeper','customer','super_admin') AND JSON_CONTAINS(COALESCE(modules, JSON_ARRAY()), '"inventory"') AND NOT JSON_CONTAINS(modules, '"store"');

-- The technician's "My jobs" menu item is keyed my-work-orders; the role
-- editor offered "my-jobs", which matched nothing.
UPDATE roles SET modules = JSON_ARRAY_APPEND(modules, '$', 'my-work-orders')
 WHERE JSON_CONTAINS(COALESCE(modules, JSON_ARRAY()), '"my-jobs"') AND NOT JSON_CONTAINS(modules, '"my-work-orders"');

-- Keys that belong to other roles' work (an earlier draft of this file added
-- them to the seeded roles by mistake). Nobody could have granted these keys
-- before this migration — they did not exist.
UPDATE roles SET modules = JSON_REMOVE(modules, JSON_UNQUOTE(JSON_SEARCH(modules, 'one', 'fleet-intake')))
 WHERE slug IN ('part_advisor','storekeeper','supervisor','workshop_foreman','team_leader') AND JSON_SEARCH(modules, 'one', 'fleet-intake') IS NOT NULL;
UPDATE roles SET modules = JSON_REMOVE(modules, JSON_UNQUOTE(JSON_SEARCH(modules, 'one', 'estimates')))
 WHERE slug IN ('workshop_foreman','team_leader') AND JSON_SEARCH(modules, 'one', 'estimates') IS NOT NULL;
UPDATE roles SET modules = JSON_REMOVE(modules, JSON_UNQUOTE(JSON_SEARCH(modules, 'one', 'team-leader')))
 WHERE slug IN ('service_advisor') AND JSON_SEARCH(modules, 'one', 'team-leader') IS NOT NULL;

-- Descriptions in line with the process (only where they are still the
-- seeded text, so a workshop's own wording is kept).
UPDATE roles SET description = 'Workshop Manager: everything operational, including the Store; approves external estimates.'
 WHERE slug = 'workshop_manager' AND description = 'Runs the workshop. Everything operational except parts and stock.';
UPDATE roles SET description = 'Front desk: opens job cards, raises and sends estimates (prices labour), records the customer''s decision, hands the car back (pickup, payment, gate pass, closing).'
 WHERE slug = 'service_advisor' AND description = 'Front desk. Creates and assigns jobs, raises invoices and quotations.';
UPDATE roles SET description = 'Parts: prices estimate parts (Genuine / After-Market), checks the shelf and issues parts to job cards.'
 WHERE slug = 'part_advisor' AND description = 'Parts and stock only. No access to labour or technician assignment.';
UPDATE roles SET description = 'Approves estimates for external customers, assigns technicians, does the quality check and test drive.'
 WHERE slug = 'supervisor' AND description = 'Operations and analytics: job progress, delivered vehicles, customer data.';
UPDATE roles SET description = 'Shop floor lead: assigns technicians, manages bays, does the quality check and test drive.'
 WHERE slug = 'workshop_foreman' AND description = 'Shop floor lead: assigns technicians, manages bays and job progress.';
UPDATE roles SET description = 'Owns a group of technicians: assigns job cards, books their time, handles rework, does the quality check.'
 WHERE slug = 'team_leader' AND description = 'Owns a group of technicians. Assigns job cards to them and books their working window.';
