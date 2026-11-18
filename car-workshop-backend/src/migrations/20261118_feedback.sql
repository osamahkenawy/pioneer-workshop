-- ═══════════════════════════════════════════════════════════════════════
-- Client feedback (18 Nov 2026).
--
-- Point 4: a supplementary estimate can carry the workshop's fixed cost
-- (Settings → "Supplementary estimate fixed cost"), added with a tick box —
-- e.g. when the main estimate is empty and the technical report is shared
-- on a supplementary estimate alone. estimate_lines.is_fixed_fee marks that
-- line: it is priced from Settings, goes to the customer for approval with
-- the rest, and never becomes a technician's job (lib/job-tasks.js).
--
-- Idempotent: safe to run twice.
-- ═══════════════════════════════════════════════════════════════════════

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'estimate_lines' AND column_name = 'is_fixed_fee');
SET @sql := IF(@col = 0,
  "ALTER TABLE estimate_lines ADD COLUMN is_fixed_fee TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Supplementary estimate: the workshop fixed cost line (Settings)'",
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Point 2: enquiries and customers are one module — the customer list shows
-- each customer's enquiry and filters by stage, so enquiries are looked up
-- by customer.
SET @idx := (SELECT COUNT(*) FROM information_schema.statistics
             WHERE table_schema = DATABASE() AND table_name = 'enquiries' AND index_name = 'idx_enq_customer');
SET @sql := IF(@idx = 0, 'ALTER TABLE enquiries ADD KEY idx_enq_customer (customer_id, status)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
