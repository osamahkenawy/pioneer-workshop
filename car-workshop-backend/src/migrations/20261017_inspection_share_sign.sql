-- ═══════════════════════════════════════════════════════════════════════
-- Vehicle inspection: the customer's sign-off, and a copy for the customer.
--
-- The walk-around (intake at drop-off, joint at handover) ends with the
-- customer's acknowledgement — signed on the screen at the car, or later from
-- a link sent by WhatsApp / e-mail when they could not stay — and the customer
-- gets the link either way, as their copy.
--
-- vehicle_inspections.share_token — the customer's link (/inspection/<token>),
--   created the first time it is sent and reused after that.
-- shared_at / shared_via — when it was last sent and how ('whatsapp',
--   'email' or 'link' when staff copied it).
-- customer_present — 0 when the customer was not at the car: the inspection
--   can then be completed unsigned and they sign from the link.
-- signed_by_name / signed_at / signed_via — who signed, when, and where
--   ('on_site' on the staff screen, 'link' from the customer's page).
--
-- Signatures captured on screen before this change are recorded as on-site.
--
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'vehicle_inspections' AND column_name = 'share_token');
SET @sql := IF(@col = 0, 'ALTER TABLE vehicle_inspections ADD COLUMN share_token VARCHAR(64) NULL AFTER signature_url', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @idx := (SELECT COUNT(*) FROM information_schema.statistics
             WHERE table_schema = DATABASE() AND table_name = 'vehicle_inspections' AND index_name = 'uq_vi_share_token');
SET @sql := IF(@idx = 0, 'ALTER TABLE vehicle_inspections ADD UNIQUE KEY uq_vi_share_token (share_token)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'vehicle_inspections' AND column_name = 'shared_at');
SET @sql := IF(@col = 0, 'ALTER TABLE vehicle_inspections ADD COLUMN shared_at DATETIME NULL AFTER share_token', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'vehicle_inspections' AND column_name = 'shared_via');
SET @sql := IF(@col = 0, 'ALTER TABLE vehicle_inspections ADD COLUMN shared_via VARCHAR(20) NULL AFTER shared_at', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'vehicle_inspections' AND column_name = 'customer_present');
SET @sql := IF(@col = 0, 'ALTER TABLE vehicle_inspections ADD COLUMN customer_present TINYINT(1) NOT NULL DEFAULT 1 AFTER shared_via', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'vehicle_inspections' AND column_name = 'signed_by_name');
SET @sql := IF(@col = 0, 'ALTER TABLE vehicle_inspections ADD COLUMN signed_by_name VARCHAR(150) NULL AFTER customer_present', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'vehicle_inspections' AND column_name = 'signed_at');
SET @sql := IF(@col = 0, 'ALTER TABLE vehicle_inspections ADD COLUMN signed_at DATETIME NULL AFTER signed_by_name', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'vehicle_inspections' AND column_name = 'signed_via');
SET @sql := IF(@col = 0, "ALTER TABLE vehicle_inspections ADD COLUMN signed_via ENUM('on_site','link') NULL AFTER signed_at", 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

UPDATE vehicle_inspections
   SET signed_at = COALESCE(completed_at, updated_at), signed_via = 'on_site'
 WHERE signature_url IS NOT NULL AND signed_at IS NULL;
