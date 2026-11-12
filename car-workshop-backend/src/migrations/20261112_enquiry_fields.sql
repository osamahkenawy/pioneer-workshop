-- ═══════════════════════════════════════════════════════════════════════
-- Enquiry fields from the client's meeting notes (2026-11-03).
--
-- 1. enquiries.emirate — the emirate the lead is in, so it reaches the right
--    team: Abu Dhabi, Dubai, Sharjah, Ajman, Umm Al Quwain, Ras Al Khaimah or
--    Fujairah (the server refuses anything else). Required on the
--    staff enquiry form, optional on the website form; copied onto the
--    customer record the enquiry creates or links when that has none.
--    NULL = not recorded (enquiries logged before this).
-- 2. enquiries.vehicle_make / vehicle_model / vehicle_year — the only car
--    details asked at the enquiry now (the free-text vehicle and the plate
--    are no longer on the form). vehicle_description keeps being written as
--    "Make Model Year" for the older screens and reports; enquiries logged
--    before this keep their vehicle_description / vehicle_plate as they are.
--    The work order's "Add a new vehicle" starts from them.
--
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'enquiries' AND column_name = 'emirate');
SET @sql := IF(@col = 0, 'ALTER TABLE enquiries ADD COLUMN emirate VARCHAR(30) NULL AFTER contact_email', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'enquiries' AND column_name = 'vehicle_make');
SET @sql := IF(@col = 0, 'ALTER TABLE enquiries ADD COLUMN vehicle_make VARCHAR(100) NULL AFTER vehicle_description', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'enquiries' AND column_name = 'vehicle_model');
SET @sql := IF(@col = 0, 'ALTER TABLE enquiries ADD COLUMN vehicle_model VARCHAR(100) NULL AFTER vehicle_make', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'enquiries' AND column_name = 'vehicle_year');
SET @sql := IF(@col = 0, 'ALTER TABLE enquiries ADD COLUMN vehicle_year SMALLINT NULL AFTER vehicle_model', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
