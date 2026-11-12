-- ═══════════════════════════════════════════════════════════════════════
-- Technicians per job, skills and the scan station (client meeting,
-- 3 Nov 2026, points 14, 16 and 17; lib/job-tasks.js, routes/job-tasks.js).
--
-- 1. job_card_tasks — one row per approved job / service on a work order
--    (the approved work_order_items grouped by their estimate line's job
--    name; a labour line without one is its own job). Each has its own
--    technician, its own Code-128 scan code (printed on the job sheet) and
--    its own start / end, so one job card can have several technicians on
--    different jobs. `job_key` is the job name lower-cased, for matching
--    when more work is approved later. Status: open → in_progress ⇄ paused
--    → done; cancelled when its approved lines are gone.
-- 2. technician_time_logs.task_id — the job a booking is for (NULL: booked
--    on the job card as a whole, as before). The booking keeps its
--    job_card_id, so the job card's totals are unchanged.
-- 3. mechanics.skills — JSON array of the service types (lib/intake-rules.js
--    JOB_TYPES keys) the technician is qualified for; NULL = not recorded.
-- 4. mechanics.badge_code — the code on the technician's printed badge,
--    scanned at the station before the job (unique; replaced when a badge
--    is lost).
--
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS job_card_tasks (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  workshop_id     INT NOT NULL,
  work_order_id   INT NOT NULL,
  job_card_id     INT NOT NULL,
  job_key         VARCHAR(200) NOT NULL,
  job_name        VARCHAR(200) NOT NULL,
  service_type    VARCHAR(30) NULL,
  mechanic_id     INT NULL,
  status          ENUM('open','in_progress','paused','done','cancelled') NOT NULL DEFAULT 'open',
  scan_code       VARCHAR(20) NOT NULL,
  started_at      DATETIME NULL,
  finished_at     DATETIME NULL,
  minutes         INT NOT NULL DEFAULT 0,
  assigned_by     INT NULL,
  assigned_at     DATETIME NULL,
  override_reason VARCHAR(255) NULL,
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_job_card_task_job (work_order_id, job_key),
  UNIQUE KEY uq_job_card_task_code (scan_code),
  KEY idx_job_card_task_card (job_card_id),
  KEY idx_job_card_task_mechanic (mechanic_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'technician_time_logs' AND column_name = 'task_id');
SET @sql := IF(@col = 0, 'ALTER TABLE technician_time_logs ADD COLUMN task_id INT NULL AFTER job_card_line_id', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @idx := (SELECT COUNT(*) FROM information_schema.statistics
             WHERE table_schema = DATABASE() AND table_name = 'technician_time_logs' AND index_name = 'idx_time_log_task');
SET @sql := IF(@idx = 0, 'ALTER TABLE technician_time_logs ADD KEY idx_time_log_task (task_id)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'mechanics' AND column_name = 'skills');
SET @sql := IF(@col = 0, 'ALTER TABLE mechanics ADD COLUMN skills JSON NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'mechanics' AND column_name = 'badge_code');
SET @sql := IF(@col = 0, 'ALTER TABLE mechanics ADD COLUMN badge_code VARCHAR(20) NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @idx := (SELECT COUNT(*) FROM information_schema.statistics
             WHERE table_schema = DATABASE() AND table_name = 'mechanics' AND index_name = 'uq_mechanic_badge_code');
SET @sql := IF(@idx = 0, 'ALTER TABLE mechanics ADD UNIQUE KEY uq_mechanic_badge_code (badge_code)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
