-- ═══════════════════════════════════════════════════════════════════════
-- Staff subcategory (client meeting 2026-11-03, point 12).
--
-- Internal customers get a fourth subcategory, Staff, next to Fleet,
-- Insurance and Asset. Internal-only, like Asset (routes/customers.js refuses
-- External + Staff). It goes on both ENUMs that hold the Step 1 subcategory:
--   customers.customer_subcategory           the customer's classification
--   work_orders.intake_customer_subcategory  the copy taken at intake
--                                            (lib/crm-cycle.js snapshotIntakeClass)
-- — without the second, a staff customer's job could not record its intake.
--
-- 'staff' is appended to the column's own value list as it stands, so every
-- existing value is kept in its place and no row changes. A column whose
-- type already holds 'staff' (or that does not exist) is left alone.
--
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════

SET @ct := (SELECT column_type FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = 'customers' AND column_name = 'customer_subcategory');
SET @sql := IF(@ct LIKE 'enum(%)' AND @ct NOT LIKE '%''staff''%',
  CONCAT('ALTER TABLE customers MODIFY COLUMN customer_subcategory ', LEFT(@ct, CHAR_LENGTH(@ct) - 1), ',''staff'')',
         ' NULL COMMENT ''Step 1 subcategory; asset and staff are internal-only, walkin external-only'''),
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @ct := (SELECT column_type FROM information_schema.columns
            WHERE table_schema = DATABASE() AND table_name = 'work_orders' AND column_name = 'intake_customer_subcategory');
SET @sql := IF(@ct LIKE 'enum(%)' AND @ct NOT LIKE '%''staff''%',
  CONCAT('ALTER TABLE work_orders MODIFY COLUMN intake_customer_subcategory ', LEFT(@ct, CHAR_LENGTH(@ct) - 1), ',''staff'')',
         ' NULL COMMENT ''Step 1 subcategory at intake'''),
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
