-- ═══════════════════════════════════════════════════════════════════════
-- Pre-printed service-status tokens at full strength (S16).
--
-- POST /api/work-orders/pre-generate made its tokens as 'WO-' + 4 random
-- bytes (32 bits), few enough to guess, and the customer's status page opens
-- with the token and no login. They are now lib/tokens.js
-- serviceStatusToken(): 128 bits, 32 hex characters.
--
-- The same value is stored as the label's barcode, and
-- pregenerated_tokens.barcode_value is VARCHAR(20): a new token would not fit
-- (strict mode refuses it; otherwise it would be cut short). Widen it to
-- match service_status_token (VARCHAR(64), 20260825_widen_service_status_token.sql).
-- The unique key on the column is kept.
--
-- Idempotent: only alters while the column is still too narrow (and does
-- nothing when the table does not exist yet).
-- ═══════════════════════════════════════════════════════════════════════

SET @needs_widen := (
  SELECT COUNT(*) FROM information_schema.columns
   WHERE table_schema = DATABASE()
     AND table_name   = 'pregenerated_tokens'
     AND column_name  = 'barcode_value'
     AND CHARACTER_MAXIMUM_LENGTH < 64
);
SET @sql := IF(@needs_widen > 0,
  'ALTER TABLE pregenerated_tokens MODIFY barcode_value VARCHAR(64) NOT NULL',
  'SELECT "pregenerated_tokens.barcode_value already wide enough" AS note');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;
