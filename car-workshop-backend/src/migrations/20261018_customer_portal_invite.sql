-- ═══════════════════════════════════════════════════════════════════════
-- Customer portal: staff give a workshop customer their portal login.
--
-- customers.portal_invited_at — when staff last sent the customer their
--   set-password link ("Give portal access" / "Send a new link" on the
--   customer page, POST /api/customers/:id/portal-access). The customer page
--   shows "Invited <date>" from it until the customer first signs in.
-- customers.portal_invited_by — the staff user who sent it.
--
-- The link itself reuses customers.reset_token / reset_token_expires (7 days
-- for an invitation, 1 hour for "forgot password").
--
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'customers' AND column_name = 'portal_invited_at');
SET @sql := IF(@col = 0, 'ALTER TABLE customers ADD COLUMN portal_invited_at DATETIME NULL DEFAULT NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'customers' AND column_name = 'portal_invited_by');
SET @sql := IF(@col = 0, 'ALTER TABLE customers ADD COLUMN portal_invited_by INT NULL DEFAULT NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
