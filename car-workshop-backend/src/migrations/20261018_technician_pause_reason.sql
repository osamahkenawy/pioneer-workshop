-- ═══════════════════════════════════════════════════════════════════════
-- Technician app (Step 6): why the clock was paused, and the scan lookup.
--
--  1. technician_time_logs.pause_reason — why a booking ended with Pause:
--       break | waiting_parts | waiting_info | other_job | other
--     (lib/status-labels.js PAUSE_REASONS). 'other_job' is also written by
--     POST /job-cards/:id/time/start {pause_other:true}, which pauses the
--     technician's other running clock (one clock per technician).
--     end_reason ENUM('pause','stop') stays as it is (20261012).
--  2. technician_time_logs.end_note — the technician's note with the pause
--     (required for 'other'), up to 255 characters.
--  3. work_order_scan_logs.scan_type gains 'technician_lookup' — every
--     "Scan job card" lookup (GET /job-cards/mine/lookup) that finds a job
--     is logged against its work order. The existing values are kept.
--  4. job_cards (mechanic_id, status) index — "my job cards" is read on every
--     refresh of the technician's screen.
--
-- Idempotent: every step guards on information_schema.
-- ═══════════════════════════════════════════════════════════════════════

-- 1. Pause reason ─────────────────────────────────────────────────────────
SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'technician_time_logs' AND column_name = 'pause_reason');
SET @sql := IF(@col = 0, 'ALTER TABLE technician_time_logs ADD COLUMN pause_reason VARCHAR(20) NULL AFTER end_reason', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 2. Pause note ───────────────────────────────────────────────────────────
SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'technician_time_logs' AND column_name = 'end_note');
SET @sql := IF(@col = 0, 'ALTER TABLE technician_time_logs ADD COLUMN end_note VARCHAR(255) NULL AFTER pause_reason', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 3. Scan log type for the technician lookup ─────────────────────────────
--    Appends the value to whatever the ENUM holds today, so values added by
--    other migrations are kept. Appending to an ENUM does not rebuild the table.
SET @typ := (SELECT column_type FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'work_order_scan_logs' AND column_name = 'scan_type');
SET @def := (SELECT column_default FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'work_order_scan_logs' AND column_name = 'scan_type');
SET @sql := IF(@typ IS NOT NULL AND @typ LIKE 'enum(%' AND @typ NOT LIKE '%''technician_lookup''%',
  CONCAT('ALTER TABLE work_order_scan_logs MODIFY COLUMN scan_type ', LEFT(@typ, CHAR_LENGTH(@typ) - 1), ',''technician_lookup'') NULL',
         IF(@def IS NULL, '', CONCAT(' DEFAULT ', QUOTE(@def)))),
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 4. My job cards ─────────────────────────────────────────────────────────
SET @idx := (SELECT COUNT(*) FROM information_schema.statistics
             WHERE table_schema = DATABASE() AND table_name = 'job_cards' AND index_name = 'idx_jc_mechanic');
SET @sql := IF(@idx = 0, 'ALTER TABLE job_cards ADD INDEX idx_jc_mechanic (mechanic_id, status)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
