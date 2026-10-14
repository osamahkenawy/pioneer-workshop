-- ═══════════════════════════════════════════════════════════════════════
-- Job card billing: bill what is on the job card, not one column.
--
-- createInvoiceFromWorkOrder used to bill `service_fee` and nothing else.
-- The 5-step wizard stores parts/services as work_order_items (mirrored into
-- cash_amount), items added during the job go to work_order_items, and an
-- estimate's approved lines never reached the job card at all — so every
-- one of those was silently left off the invoice. Measured on a local copy:
-- a wizard job worth 288.75 invoiced 80.00.
--
-- The fix bills service_fee + every work_order_item, which is only correct
-- for job cards created from now on. The 17,816 imported legacy rows use
-- work_order_items as the BREAKDOWN of a gross service_fee (see
-- scripts/oracle-migration/migrate.mjs), so summing them would double-bill.
-- Hence an explicit per-row flag instead of guessing from the data:
--
--   service_fee — legacy behaviour: the invoice is service_fee alone.
--                 Every row that exists when this migration runs.
--   itemised    — service_fee + items − discount, VAT on the lot.
--                 The column DEFAULT, so every new job card, by any path.
--
-- work_order_items also gains the line type and the estimate line it came
-- from (so an approved estimate can be carried onto the job card), and
-- quantity widens from INT so 1.5 hours of labour is not billed as 1.
-- invoice_items.quantity widens for the same reason.
--
-- Idempotent: every step guards on information_schema.
-- ═══════════════════════════════════════════════════════════════════════

-- work_orders.billing_basis — added with DEFAULT 'service_fee' so every
-- existing row keeps today's billing, then the default flips to 'itemised'.
SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'work_orders' AND column_name = 'billing_basis');
SET @sql := IF(@col = 0,
  "ALTER TABLE work_orders ADD COLUMN billing_basis ENUM('service_fee','itemised') NOT NULL DEFAULT 'service_fee' AFTER discount",
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @def := (SELECT column_default FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'work_orders' AND column_name = 'billing_basis');
SET @sql := IF(@def = 'service_fee',
  "ALTER TABLE work_orders ALTER COLUMN billing_basis SET DEFAULT 'itemised'",
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- work_order_items.item_type
SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'work_order_items' AND column_name = 'item_type');
SET @sql := IF(@col = 0,
  "ALTER TABLE work_order_items ADD COLUMN item_type ENUM('labour','parts','sublet','consumable') NULL AFTER name",
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- work_order_items.estimate_line_id — which approved estimate line this is
SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'work_order_items' AND column_name = 'estimate_line_id');
SET @sql := IF(@col = 0,
  'ALTER TABLE work_order_items ADD COLUMN estimate_line_id INT NULL AFTER item_type',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- work_order_items.quantity INT → DECIMAL(10,3) (widening; no data loss)
SET @typ := (SELECT data_type FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'work_order_items' AND column_name = 'quantity');
SET @sql := IF(@typ = 'int',
  'ALTER TABLE work_order_items MODIFY COLUMN quantity DECIMAL(10,3) DEFAULT 1',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- invoice_items.quantity INT → DECIMAL(10,3)
SET @typ := (SELECT data_type FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'invoice_items' AND column_name = 'quantity');
SET @sql := IF(@typ = 'int',
  'ALTER TABLE invoice_items MODIFY COLUMN quantity DECIMAL(10,3) DEFAULT 1',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
