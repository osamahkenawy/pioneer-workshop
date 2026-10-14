-- ═══════════════════════════════════════════════════════════════════════
-- One invoice number per workshop.
--
-- Numbers were "the last row's number + 1" with no constraint, so two
-- invoices raised at the same moment could share a number, and a credit
-- note (CN-INV-…, parsed as 0) could make the next invoice reuse INV-0001.
-- The generator now takes the highest INV- number (routes/invoices.js);
-- this key makes a collision fail loudly instead of saving a duplicate.
-- There are no duplicates in the data today (checked 2026-10-11).
--
-- Idempotent: guarded on information_schema.
-- ═══════════════════════════════════════════════════════════════════════
SET @idx := (SELECT COUNT(*) FROM information_schema.statistics
             WHERE table_schema = DATABASE() AND table_name = 'invoices' AND index_name = 'uq_invoices_workshop_number');
SET @sql := IF(@idx = 0,
  'CREATE UNIQUE INDEX uq_invoices_workshop_number ON invoices (workshop_id, invoice_number)',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
