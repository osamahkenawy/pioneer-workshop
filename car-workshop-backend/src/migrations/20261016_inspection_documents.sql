-- ═══════════════════════════════════════════════════════════════════════
-- Intake inspection: fill the form on screen OR upload the paper form.
--
-- vehicle_inspections.entry_mode — 'form' (marked on the diagram, as before)
--   or 'document' (the inspection was done on paper and uploaded: a scan,
--   photos of the pages or a PDF).
-- vehicle_inspections.documents — JSON list of the uploaded files
--   [{id, name, type, size, file, uploaded_at, uploaded_by}]. The files sit in
--   private-uploads/inspections (not served publicly) and are read through
--   GET /api/vehicle-inspections/:id/documents/:docId.
--
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'vehicle_inspections' AND column_name = 'entry_mode');
SET @sql := IF(@col = 0, "ALTER TABLE vehicle_inspections ADD COLUMN entry_mode ENUM('form','document') NOT NULL DEFAULT 'form' AFTER inspection_type", 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'vehicle_inspections' AND column_name = 'documents');
SET @sql := IF(@col = 0, 'ALTER TABLE vehicle_inspections ADD COLUMN documents JSON NULL AFTER marks', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
