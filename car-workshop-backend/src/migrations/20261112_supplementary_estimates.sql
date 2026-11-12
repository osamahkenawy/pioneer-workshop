-- ═══════════════════════════════════════════════════════════════════════
-- Main and supplementary estimates, and the customer's consent (client
-- decisions, 3 Nov 2026).
--
-- 1. service_estimates.kind — 'main': the estimate raised once the work
--    order's technical inspection is completed (EST-…); 'supplementary':
--    extra work found later on the same job (SEST-…), at a fixed cost —
--    one price per line, no choice of part types — that the customer
--    approves with their consent.
-- 2. service_estimates.parent_estimate_id — a supplementary estimate's main
--    estimate. The column was already there, unused ("Previous version":
--    an edit raises the version in place), so it is reused for the link.
-- 3. estimate_consents — the consent given when a supplementary estimate is
--    approved, one per approval (a line, several or all at once): the
--    statement shown, the fixed cost it states (incl. VAT), the name typed,
--    when, and the IP; in person, the staff member who recorded it.
--    estimate_lines.consent_id — the consent a line was approved under.
--
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'service_estimates' AND column_name = 'kind');
SET @sql := IF(@col = 0,
  "ALTER TABLE service_estimates ADD COLUMN kind ENUM('main','supplementary') NOT NULL DEFAULT 'main' AFTER estimate_number",
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'service_estimates' AND column_name = 'parent_estimate_id');
SET @sql := IF(@col = 0,
  "ALTER TABLE service_estimates ADD COLUMN parent_estimate_id INT NULL COMMENT 'Supplementary estimate: its main estimate'",
  "ALTER TABLE service_estimates MODIFY COLUMN parent_estimate_id INT NULL COMMENT 'Supplementary estimate: its main estimate'");
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @idx := (SELECT COUNT(*) FROM information_schema.statistics
             WHERE table_schema = DATABASE() AND table_name = 'service_estimates' AND index_name = 'idx_se_parent');
SET @sql := IF(@idx = 0, 'ALTER TABLE service_estimates ADD KEY idx_se_parent (parent_estimate_id)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

CREATE TABLE IF NOT EXISTS estimate_consents (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  workshop_id   INT NOT NULL,
  estimate_id   INT NOT NULL,
  line_ids      JSON NULL COMMENT 'The estimate lines approved under this consent',
  amount        DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'The fixed cost the statement gives, incl. VAT',
  consent_text  VARCHAR(1000) NOT NULL,
  consent_name  VARCHAR(200) NOT NULL,
  channel       ENUM('link','in_person') NOT NULL DEFAULT 'link',
  recorded_by   INT NULL COMMENT 'Staff member who recorded an in-person consent',
  ip_address    VARCHAR(64) NULL,
  user_agent    VARCHAR(300) NULL,
  created_at    TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_consent_estimate (estimate_id),
  KEY idx_consent_workshop (workshop_id),
  CONSTRAINT fk_consent_estimate FOREIGN KEY (estimate_id) REFERENCES service_estimates (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'estimate_lines' AND column_name = 'consent_id');
SET @sql := IF(@col = 0, 'ALTER TABLE estimate_lines ADD COLUMN consent_id INT NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
