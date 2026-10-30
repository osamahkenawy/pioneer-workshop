-- ═══════════════════════════════════════════════════════════════════════
-- Parts categories: Genuine, After-Market and Used (client changes 2026-10-29, D4)
--
--  1. service_estimates.parts_preference — the customer's parts preference,
--     any combination of the three, chosen when the estimate is raised
--     (default Genuine + After-Market). Existing estimates take it from the
--     format they were sent in: Format 1 → Genuine, Format 2 → After-Market,
--     Format 3 or not sent yet → Genuine + After-Market.
--  2. estimate_lines.used_price / used_available — the third category,
--     priced by the Store like the other two (*_available 0 = not available).
--  3. estimate_lines.*_expected_date — expected delivery per category:
--     NULL on an available category = in stock.
--  4. estimate_lines.part_option accepts 'used'.
--  5. estimate_lines.alternative_option / alternative_for /
--     alternative_approved — a category the customer did NOT ask for, offered
--     by the Store because a requested one (alternative_for) is not
--     available. Its price, availability and expected date sit in that
--     category's own columns. It never replaces the requested category by
--     itself: alternative_approved is 1 only when the customer approved the
--     line with it (0 when they decided the line otherwise).
--
-- One confirmed quantity per line (estimate_lines.quantity): the Store may
-- correct it when pricing; it applies to every category.
--
-- Idempotent: every step guards on information_schema.
-- ═══════════════════════════════════════════════════════════════════════

-- 1. The customer's parts preference ──────────────────────────────────────
SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'service_estimates' AND column_name = 'parts_preference');
SET @sql := IF(@col = 0,
  "ALTER TABLE service_estimates ADD COLUMN parts_preference SET('genuine','after_market','used') NOT NULL DEFAULT 'genuine,after_market' AFTER estimate_format",
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
-- Backfilled only when the column was just added (@col is the count before).
SET @sql := IF(@col = 0,
  "UPDATE service_estimates SET parts_preference = CASE estimate_format WHEN 'genuine' THEN 'genuine' WHEN 'after_market' THEN 'after_market' ELSE 'genuine,after_market' END",
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 2. Used parts ───────────────────────────────────────────────────────────
SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'estimate_lines' AND column_name = 'used_price');
SET @sql := IF(@col = 0,
  'ALTER TABLE estimate_lines ADD COLUMN used_price DECIMAL(12,2) NULL AFTER aftermarket_available,
     ADD COLUMN used_available TINYINT(1) NULL AFTER used_price',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 3. Expected delivery per category (NULL = in stock) ─────────────────────
SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'estimate_lines' AND column_name = 'genuine_expected_date');
SET @sql := IF(@col = 0,
  'ALTER TABLE estimate_lines ADD COLUMN genuine_expected_date DATE NULL AFTER genuine_available,
     ADD COLUMN aftermarket_expected_date DATE NULL AFTER aftermarket_available,
     ADD COLUMN used_expected_date DATE NULL AFTER used_available',
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 4. The customer's choice can be Used (existing values kept) ─────────────
SET @typ := (SELECT column_type FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'estimate_lines' AND column_name = 'part_option');
SET @sql := IF(@typ IS NOT NULL AND @typ NOT LIKE '%''used''%',
  "ALTER TABLE estimate_lines MODIFY COLUMN part_option ENUM('genuine','after_market','used') NULL",
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

-- 5. Alternatives offered by the Store ────────────────────────────────────
SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'estimate_lines' AND column_name = 'alternative_option');
SET @sql := IF(@col = 0,
  "ALTER TABLE estimate_lines ADD COLUMN alternative_option ENUM('genuine','after_market','used') NULL AFTER part_option,
     ADD COLUMN alternative_for ENUM('genuine','after_market','used') NULL AFTER alternative_option,
     ADD COLUMN alternative_approved TINYINT(1) NULL AFTER alternative_for",
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
