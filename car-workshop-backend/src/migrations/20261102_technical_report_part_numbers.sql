-- ═══════════════════════════════════════════════════════════════════════
-- Technical inspection and part numbers per type (client review, 2026-11-02).
--
-- 1. technical_inspections — once the job card is open (the customer
--    acknowledged the physical inspection), the Supervisor / Workshop
--    Foreman inspects the car and writes the technical report: findings and
--    the service lines, each a specific labour with its parts. The estimate
--    is raised from it. One per work order; `service_lines` is JSON
--    [{ job, service_type, labour, hours, parts: [{ description, part_number,
--    quantity }], notes }] while the client settles the fields.
-- 2. estimate_lines.genuine_part_number / aftermarket_part_number /
--    used_part_number — each part type has its own part number, entered by
--    the Storekeeper with the price (part_number stays the requested part).
--
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS technical_inspections (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  workshop_id   INT NOT NULL,
  work_order_id INT NOT NULL,
  job_card_id   INT NULL,
  status        ENUM('draft','completed') NOT NULL DEFAULT 'draft',
  findings      TEXT NULL,
  service_lines JSON NULL,
  inspected_by  INT NULL,
  completed_by  INT NULL,
  completed_at  DATETIME NULL,
  created_at    TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_technical_inspection_wo (work_order_id),
  KEY idx_technical_inspection_ws (workshop_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'estimate_lines' AND column_name = 'genuine_part_number');
SET @sql := IF(@col = 0, 'ALTER TABLE estimate_lines ADD COLUMN genuine_part_number VARCHAR(100) NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'estimate_lines' AND column_name = 'aftermarket_part_number');
SET @sql := IF(@col = 0, 'ALTER TABLE estimate_lines ADD COLUMN aftermarket_part_number VARCHAR(100) NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'estimate_lines' AND column_name = 'used_part_number');
SET @sql := IF(@col = 0, 'ALTER TABLE estimate_lines ADD COLUMN used_part_number VARCHAR(100) NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
