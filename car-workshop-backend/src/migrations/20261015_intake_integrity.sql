-- ═══════════════════════════════════════════════════════════════════════
-- Step 1 classification recorded on the job (intake snapshot).
--
-- The classification (main category + subcategory, document Step 1) was
-- read live from the customer, so reclassifying an account rewrote Step 1 —
-- and the estimate approval rule — of every job it had ever raised. The job
-- now keeps what it was classified as when it came in:
--
--   work_orders.intake_customer_class        same values as customers.customer_class
--   work_orders.intake_customer_subcategory  same values as customers.customer_subcategory
--
-- POST /api/work-orders fills them from the customer at intake. Existing
-- jobs are backfilled from their customer as it stands today, so Step 1 of
-- an old job keeps showing what it shows now. A job whose snapshot has no
-- subcategory falls back to the customer (lib/workflow.js jobClassification),
-- so completing an unclassified customer later still completes Step 1.
--
-- The backfill sets updated_at to itself so it does not count as an edit
-- (PUT /api/work-orders/:id compares updated_at to catch concurrent edits).
--
-- Idempotent: columns guarded on information_schema; the backfill only
-- touches rows that have no snapshot yet.
-- ═══════════════════════════════════════════════════════════════════════

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'work_orders' AND column_name = 'intake_customer_class');
SET @sql := IF(@col = 0,
  "ALTER TABLE work_orders ADD COLUMN intake_customer_class ENUM('internal','external') NULL COMMENT 'Step 1 main category at intake' AFTER intake_channel",
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'work_orders' AND column_name = 'intake_customer_subcategory');
SET @sql := IF(@col = 0,
  "ALTER TABLE work_orders ADD COLUMN intake_customer_subcategory ENUM('fleet','insurance','asset','walkin') NULL COMMENT 'Step 1 subcategory at intake' AFTER intake_customer_class",
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

UPDATE work_orders wo
  JOIN customers c ON c.id = wo.customer_id AND c.workshop_id = wo.workshop_id
   SET wo.intake_customer_class = c.customer_class,
       wo.intake_customer_subcategory = c.customer_subcategory,
       wo.updated_at = wo.updated_at
 WHERE wo.intake_customer_class IS NULL;
