-- ═══════════════════════════════════════════════════════════════════════
-- The job card waits for the physical inspection (client e-mail, 2026-10-29).
--
-- An EXTERNAL customer's main job card no longer opens with the work order:
-- it opens when the customer acknowledges the physical inspection (the
-- walk-around at drop-off, vehicle_inspections.inspection_type 'intake') —
-- signed at the car, from the link or in the portal, or the paper form
-- uploaded (lib/physical-inspection.js). Internal customers skip it.
--
-- 1. work_orders.inspection_override_at / _by / _reason — a manager opened
--    the job card without the acknowledgement (Step 3 on the job card
--    screen), and why. Also written to work_order_status_logs and the audit log.
-- 2. vehicle_inspections.photos — the vehicle photos taken during the
--    inspection, JSON [{id, name, type, size, file, uploaded_at, uploaded_by}]
--    as `documents` (20261016_inspection_documents.sql): the files sit in
--    private-uploads/inspections and are read through
--    GET /api/vehicle-inspections/:id/photos/:photoId (staff), the customer's
--    link and the customer portal. Locked once the inspection is completed.
--
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'work_orders' AND column_name = 'inspection_override_at');
SET @sql := IF(@col = 0, 'ALTER TABLE work_orders ADD COLUMN inspection_override_at DATETIME NULL AFTER intake_inspection_at', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'work_orders' AND column_name = 'inspection_override_by');
SET @sql := IF(@col = 0, 'ALTER TABLE work_orders ADD COLUMN inspection_override_by INT NULL AFTER inspection_override_at', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'work_orders' AND column_name = 'inspection_override_reason');
SET @sql := IF(@col = 0, 'ALTER TABLE work_orders ADD COLUMN inspection_override_reason VARCHAR(500) NULL AFTER inspection_override_by', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'vehicle_inspections' AND column_name = 'photos');
SET @sql := IF(@col = 0, 'ALTER TABLE vehicle_inspections ADD COLUMN photos JSON NULL AFTER documents', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
