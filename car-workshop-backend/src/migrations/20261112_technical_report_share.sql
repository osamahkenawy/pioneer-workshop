-- ═══════════════════════════════════════════════════════════════════════
-- The technical report goes to the customer (client meeting, 2026-11-03).
--
-- Once the Supervisor / Workshop Foreman completes the technical inspection
-- (Step 4, routes/technical-inspections.js), the customer gets the report —
-- only what is to be done: each job / service, its service type, the labour
-- and the parts' names (no hours, quantities or part numbers). It is sent
-- like the inspection link (WhatsApp / e-mail / copy link), opened at
-- /technical-report/<token> (routes/public-technical-reports.js), and shown
-- on the job's page in the customer portal.
--
-- technical_inspections.share_token — the customer's link, made when the
--   report is completed (so it is ready at once) and reused after that; a
--   "New link" clears it and the next send makes another.
-- shared_at / shared_via — when it was last sent and how ('whatsapp',
--   'email' or 'link' when staff copied it).
--
-- The findings field left the report at the same meeting; the column stays,
-- read-only, for the reports that already have findings.
--
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'technical_inspections' AND column_name = 'share_token');
SET @sql := IF(@col = 0, 'ALTER TABLE technical_inspections ADD COLUMN share_token VARCHAR(64) NULL AFTER completed_at', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @idx := (SELECT COUNT(*) FROM information_schema.statistics
             WHERE table_schema = DATABASE() AND table_name = 'technical_inspections' AND index_name = 'uq_ti_share_token');
SET @sql := IF(@idx = 0, 'ALTER TABLE technical_inspections ADD UNIQUE KEY uq_ti_share_token (share_token)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'technical_inspections' AND column_name = 'shared_at');
SET @sql := IF(@col = 0, 'ALTER TABLE technical_inspections ADD COLUMN shared_at DATETIME NULL AFTER share_token', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'technical_inspections' AND column_name = 'shared_via');
SET @sql := IF(@col = 0, 'ALTER TABLE technical_inspections ADD COLUMN shared_via VARCHAR(20) NULL AFTER shared_at', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- Reports completed before this change get their link now, as a newly
-- completed one would: 32 random bytes, base64url without padding (43
-- characters), as crypto.randomBytes(32).toString('base64url') makes it.
UPDATE technical_inspections
   SET share_token = REPLACE(REPLACE(REPLACE(TO_BASE64(RANDOM_BYTES(32)), '+', '-'), '/', '_'), '=', '')
 WHERE status = 'completed' AND share_token IS NULL;
