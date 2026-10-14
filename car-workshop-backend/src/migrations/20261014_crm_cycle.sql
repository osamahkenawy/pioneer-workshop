-- ═══════════════════════════════════════════════════════════════════════
-- The customer cycle, joined up end to end:
--   lead (enquiry) → quote (estimate) → booking (appointment) → visit (job
--   card) → after the visit → service due → a reply to the reminder becomes
--   a new enquiry.
--
-- 1. service_estimates.enquiry_id — a quote raised from an enquiry.
-- 2. appointments.enquiry_id / estimate_id — a booking made from an enquiry
--    or an approved quote (appointments.work_order_id already exists and is
--    filled at check-in).
-- 3. enquiries.contact_method gains 'reminder' and 'referral' (the process
--    map lists both as ways demand reaches the workshop).
-- 4. Bookings get their own menu key ('appointments') for the roles that
--    take bookings.
--
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'service_estimates' AND column_name = 'enquiry_id');
SET @sql := IF(@col = 0, 'ALTER TABLE service_estimates ADD COLUMN enquiry_id INT NULL AFTER intake_work_order_id, ADD INDEX idx_se_enquiry (enquiry_id)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'appointments' AND column_name = 'enquiry_id');
SET @sql := IF(@col = 0, 'ALTER TABLE appointments ADD COLUMN enquiry_id INT NULL AFTER work_order_id, ADD INDEX idx_appt_enquiry (enquiry_id)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'appointments' AND column_name = 'estimate_id');
SET @sql := IF(@col = 0, 'ALTER TABLE appointments ADD COLUMN estimate_id INT NULL AFTER enquiry_id, ADD INDEX idx_appt_estimate (estimate_id)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

ALTER TABLE enquiries MODIFY COLUMN contact_method
  ENUM('phone','whatsapp','website_form','walk_in','partner_handoff','email','reminder','referral') NULL;

-- Bookings menu
UPDATE roles SET modules = JSON_ARRAY_APPEND(COALESCE(modules, JSON_ARRAY()), '$', 'appointments')
 WHERE slug IN ('general_manager','workshop_manager','service_advisor')
   AND NOT JSON_CONTAINS(COALESCE(modules, JSON_ARRAY()), '"appointments"');
