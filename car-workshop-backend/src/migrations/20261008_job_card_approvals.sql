-- ═══════════════════════════════════════════════════════════════════════
-- Two approvals from process steps 5–6 that the system did not record.
--
-- 1. The customer's agreement on a job card (work_orders.customer_*).
--    "No work begins without the customer's agreement" (roadmap Phase 1).
--    A job card born from an approved estimate carries it automatically
--    (channel 'estimate'); one opened at the counter needs the advisor to
--    record how the customer agreed — in person, by phone, in writing —
--    before work can start. customer_approved_total snapshots what they
--    agreed to, so work added afterwards is visible as unapproved.
--    Enforced only for billing_basis = 'itemised' job cards: the imported
--    legacy rows were agreed in the old system.
--
-- 2. Internal sign-off before an estimate goes to an EXTERNAL customer
--    (service_estimates.internal_approved_*). Process step 5: "Supervisor or
--    Workshop Manager approves it first". Internal (fleet/asset) estimates
--    go straight out.
--
-- 3. work_order_status_logs.status widened to match work_orders.status
--    (see the bottom of this file).
--
-- Idempotent: every step guards on information_schema.
-- ═══════════════════════════════════════════════════════════════════════

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'work_orders' AND column_name = 'customer_approved_at');
SET @sql := IF(@col = 0, 'ALTER TABLE work_orders ADD COLUMN customer_approved_at DATETIME NULL AFTER billing_basis', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'work_orders' AND column_name = 'customer_approval_channel');
SET @sql := IF(@col = 0,
  "ALTER TABLE work_orders ADD COLUMN customer_approval_channel ENUM('estimate','in_person','phone','written') NULL AFTER customer_approved_at",
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- The staff member who recorded it (NULL when the customer approved an estimate link themselves)
SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'work_orders' AND column_name = 'customer_approved_by');
SET @sql := IF(@col = 0, 'ALTER TABLE work_orders ADD COLUMN customer_approved_by INT NULL AFTER customer_approval_channel', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'work_orders' AND column_name = 'customer_approval_note');
SET @sql := IF(@col = 0, 'ALTER TABLE work_orders ADD COLUMN customer_approval_note VARCHAR(500) NULL AFTER customer_approved_by', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'work_orders' AND column_name = 'customer_approved_total');
SET @sql := IF(@col = 0, 'ALTER TABLE work_orders ADD COLUMN customer_approved_total DECIMAL(12,2) NULL AFTER customer_approval_note', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'service_estimates' AND column_name = 'internal_approved_by');
SET @sql := IF(@col = 0, 'ALTER TABLE service_estimates ADD COLUMN internal_approved_by INT NULL AFTER status', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'service_estimates' AND column_name = 'internal_approved_at');
SET @sql := IF(@col = 0, 'ALTER TABLE service_estimates ADD COLUMN internal_approved_at DATETIME NULL AFTER internal_approved_by', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- work_order_status_logs.status never got the values the 20260914 rename
-- widened work_orders.status with, so a log row for an estimate_approved job
-- card failed silently. Expand to match (same values, same order).
SET @typ := (SELECT column_type FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'work_order_status_logs' AND column_name = 'status');
SET @sql := IF(@typ NOT LIKE '%estimate_approved%',
  "ALTER TABLE work_order_status_logs MODIFY COLUMN status ENUM('pending','confirmed','assigned','accepted','estimate_approved','auto_assign','in_progress','inspection','ready_for_pickup','completed','cancelled') NOT NULL",
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
