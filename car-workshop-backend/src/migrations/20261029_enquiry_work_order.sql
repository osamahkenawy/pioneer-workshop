-- ═══════════════════════════════════════════════════════════════════════
-- Every enquiry gets its work order when it is submitted (client e-mail,
-- 2026-10-29): staff CRM enquiries, the website form, the v1 API and the
-- fleet coordinator link.
--
-- enquiries.work_order_id — the enquiry's work order (the visit), set the
--   moment the enquiry is submitted. The other half of the link is
--   work_orders.enquiry_id. converted_work_order_id keeps its meaning — the
--   lead was won (direct convert, booking check-in, approved quote) — and
--   names the same work order; the CRM funnel and "converted" still read it.
--
-- Enquiries converted before this change point at the job they became.
--
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'enquiries' AND column_name = 'work_order_id');
SET @sql := IF(@col = 0, 'ALTER TABLE enquiries ADD COLUMN work_order_id INT NULL AFTER follow_up_at, ADD INDEX idx_enq_work_order (work_order_id)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

UPDATE enquiries SET work_order_id = converted_work_order_id
 WHERE work_order_id IS NULL AND converted_work_order_id IS NOT NULL;
