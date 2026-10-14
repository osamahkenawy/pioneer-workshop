-- ═══════════════════════════════════════════════════════════════════════
-- Workshop workflow, Steps 1–7 (Pioneer_Complete_Workshop_Workflow_Steps_1_to_7.pdf)
--
-- The visit is the work order (WO). The work on it is done through job
-- cards (JC): one MAIN job card per work order, opened at intake (Step 3),
-- plus SUB-job cards when part of the approved work needs its own card
-- (Step 6). The job_cards family of tables (lines, time logs, QC,
-- requisitions, gate passes) already existed but nothing created a row.
--
--  1. job_cards.parent_job_card_id / title / mechanic_id, work_order_items.job_card_id
--                                                   — sub-job cards and who does them (Step 6)
--  2. technician_time_logs.end_reason               — Start / Pause / Stop (Step 6)
--  3. material_requisition_items availability + ETA — store check, expected
--     delivery date, floor alert 24 h before it (Step 6)
--  4. estimate_lines Genuine / After-Market pricing — Storekeeper prices both
--     part types, N/A when one is unavailable (Step 5)
--  5. service_estimates.intake_work_order_id / estimate_format — the estimate
--     belongs to the visit it was raised for; Format 1/2/3 (Step 5)
--  6. work_order_contacts                           — pickup communication log (Step 7)
--  7. Storekeeper role                              — prices parts (Step 5)
--
-- Idempotent: every step guards on information_schema / NOT EXISTS.
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Sub-job cards ───────────────────────────────────────────────────────
SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'job_cards' AND column_name = 'parent_job_card_id');
SET @sql := IF(@col = 0, 'ALTER TABLE job_cards ADD COLUMN parent_job_card_id INT NULL AFTER work_order_id, ADD INDEX idx_parent (parent_job_card_id)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'job_cards' AND column_name = 'title');
SET @sql := IF(@col = 0, 'ALTER TABLE job_cards ADD COLUMN title VARCHAR(255) NULL AFTER parent_job_card_id', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- One main job card per work order: work_order_id + a generated "main" flag.
SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'job_cards' AND column_name = 'main_for_work_order');
SET @sql := IF(@col = 0,
  'ALTER TABLE job_cards ADD COLUMN main_for_work_order INT GENERATED ALWAYS AS (CASE WHEN parent_job_card_id IS NULL AND status <> ''cancelled'' THEN work_order_id ELSE NULL END) STORED, ADD UNIQUE KEY uq_main_job_card (main_for_work_order)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- The technician a job card is assigned to (the main job card follows the
-- work order's technician; a sub-job card can go to someone else).
SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'job_cards' AND column_name = 'mechanic_id');
SET @sql := IF(@col = 0, 'ALTER TABLE job_cards ADD COLUMN mechanic_id INT NULL AFTER foreman_id', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Which job card each approved work item is done under (NULL = the main one).
SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'work_order_items' AND column_name = 'job_card_id');
SET @sql := IF(@col = 0, 'ALTER TABLE work_order_items ADD COLUMN job_card_id INT NULL AFTER work_order_id', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 2. Time booking: why a session ended ────────────────────────────────────
SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'technician_time_logs' AND column_name = 'end_reason');
SET @sql := IF(@col = 0, "ALTER TABLE technician_time_logs ADD COLUMN end_reason ENUM('pause','stop') NULL AFTER clock_out", 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 3. Store availability check ─────────────────────────────────────────────
SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'material_requisition_items' AND column_name = 'availability');
SET @sql := IF(@col = 0, "ALTER TABLE material_requisition_items ADD COLUMN availability ENUM('unchecked','available','not_available') NOT NULL DEFAULT 'unchecked' AFTER status", 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'material_requisition_items' AND column_name = 'expected_date');
SET @sql := IF(@col = 0, 'ALTER TABLE material_requisition_items ADD COLUMN expected_date DATE NULL AFTER availability', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'material_requisition_items' AND column_name = 'eta_alerted_at');
SET @sql := IF(@col = 0, 'ALTER TABLE material_requisition_items ADD COLUMN eta_alerted_at DATETIME NULL AFTER expected_date', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'material_requisition_items' AND column_name = 'checked_by');
SET @sql := IF(@col = 0, 'ALTER TABLE material_requisition_items ADD COLUMN checked_by INT NULL AFTER eta_alerted_at, ADD COLUMN checked_at DATETIME NULL AFTER checked_by', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 4. Genuine / After-Market pricing on estimate lines ──────────────────────
--    job_name groups a job's labour and parts lines ("AC Compressor").
--    A *_available of 0 is the "N/A" of the process chart.
SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'estimate_lines' AND column_name = 'job_name');
SET @sql := IF(@col = 0,
  'ALTER TABLE estimate_lines ADD COLUMN job_name VARCHAR(200) NULL AFTER description,
     ADD COLUMN genuine_price DECIMAL(12,2) NULL AFTER unit_price,
     ADD COLUMN genuine_available TINYINT(1) NULL AFTER genuine_price,
     ADD COLUMN aftermarket_price DECIMAL(12,2) NULL AFTER genuine_available,
     ADD COLUMN aftermarket_available TINYINT(1) NULL AFTER aftermarket_price,
     ADD COLUMN part_option ENUM(''genuine'',''after_market'') NULL AFTER aftermarket_available,
     ADD COLUMN priced_by INT NULL AFTER part_option,
     ADD COLUMN priced_at DATETIME NULL AFTER priced_by',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 5. Estimate ↔ visit, and the format sent ────────────────────────────────
SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'service_estimates' AND column_name = 'intake_work_order_id');
SET @sql := IF(@col = 0, 'ALTER TABLE service_estimates ADD COLUMN intake_work_order_id INT NULL AFTER work_order_id, ADD INDEX idx_intake_wo (intake_work_order_id)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Format 1 = Genuine, Format 2 = After-Market, Format 3 = both side by side
SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'service_estimates' AND column_name = 'estimate_format');
SET @sql := IF(@col = 0, "ALTER TABLE service_estimates ADD COLUMN estimate_format ENUM('genuine','after_market','both') NULL AFTER intake_work_order_id", 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 6. Pickup communication log ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_order_contacts (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  workshop_id    INT NOT NULL,
  work_order_id  INT NOT NULL,
  channel        ENUM('phone','whatsapp','email','sms') NOT NULL,
  purpose        ENUM('pickup','update','other') NOT NULL DEFAULT 'pickup',
  outcome        ENUM('reached','no_answer','message_sent') NULL,
  note           VARCHAR(500) NULL,
  contacted_by   INT NULL,
  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_work_order (work_order_id),
  INDEX idx_workshop (workshop_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 7. Storekeeper ─────────────────────────────────────────────────────────
INSERT INTO roles (workshop_id, name, name_ar, slug, description, modules, is_system, is_active)
SELECT w.id, 'Storekeeper', 'أمين المخزن', 'storekeeper',
       'Prices parts (Genuine and After-Market) on estimates, checks shelf availability and issues parts to job cards.',
       JSON_ARRAY('dashboard','notifications','parts','inventory','work-orders','estimates'),
       0, 1
  FROM workshops w
 WHERE NOT EXISTS (
   SELECT 1 FROM roles r WHERE r.workshop_id = w.id AND r.slug = 'storekeeper'
 );
