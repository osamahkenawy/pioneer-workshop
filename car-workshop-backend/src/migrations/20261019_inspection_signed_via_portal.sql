-- ═══════════════════════════════════════════════════════════════════════
-- Where an inspection was signed: add 'portal'.
--
-- vehicle_inspections.signed_via was ENUM('on_site','link')
-- (20261017_inspection_share_sign.sql): 'on_site' at the car on the staff
-- screen, 'link' from the customer's shared link. A customer signed in to
-- the customer portal (POST /api/customer-portal/inspections/:id/sign) was
-- recorded as 'link' too, so a Service Advisor's "new link"
-- (POST /api/vehicle-inspections/:id/share/reset) took that signature off
-- with the link's. The portal now records 'portal', which the reset keeps:
-- the customer signed in with their own login.
--
-- Signatures made in the portal before this stay 'link' (nothing tells them
-- apart). Idempotent: only alters while 'portal' is missing, and does
-- nothing when the column does not exist yet.
-- ═══════════════════════════════════════════════════════════════════════

SET @needs_portal := (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name   = 'vehicle_inspections'
     AND column_name  = 'signed_via'
     AND column_type NOT LIKE '%''portal''%'
);
SET @sql := IF(@needs_portal > 0,
  "ALTER TABLE vehicle_inspections MODIFY signed_via ENUM('on_site','link','portal') NULL",
  'SELECT "vehicle_inspections.signed_via already has portal" AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
