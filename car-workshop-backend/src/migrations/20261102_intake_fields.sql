-- ═══════════════════════════════════════════════════════════════════════
-- Intake fields from the client's review (2026-11-02).
--
-- 1. vehicles.vehicle_type — Sedan, Crossover, SUV, Medium Bus, Large Bus,
--    Medium Truck, Large Truck, Hydraulic equipment (lib/vehicle-types.js
--    holds the keys). NULL = not recorded (cars on file before this).
-- 2. work_orders.parts_preference / enquiries.parts_preference — the parts
--    the customer accepts, asked at the enquiry / work order: any combination
--    of Genuine, After-Market and Used (as service_estimates.parts_preference,
--    20261029_parts_categories.sql). The estimate starts from it and offers
--    only those categories. NULL = not asked (the advisor picks on the estimate).
-- 3. work_orders.job_types — the job types the Service Advisor ticks at
--    Step 4 (multi-select), JSON array of keys. Replaces the single "Job type"
--    on the work order form; work_order_type keeps its default.
--
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'vehicles' AND column_name = 'vehicle_type');
SET @sql := IF(@col = 0, 'ALTER TABLE vehicles ADD COLUMN vehicle_type VARCHAR(30) NULL AFTER model', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'work_orders' AND column_name = 'parts_preference');
SET @sql := IF(@col = 0, 'ALTER TABLE work_orders ADD COLUMN parts_preference SET(''genuine'',''after_market'',''used'') NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'enquiries' AND column_name = 'parts_preference');
SET @sql := IF(@col = 0, 'ALTER TABLE enquiries ADD COLUMN parts_preference SET(''genuine'',''after_market'',''used'') NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'work_orders' AND column_name = 'job_types');
SET @sql := IF(@col = 0, 'ALTER TABLE work_orders ADD COLUMN job_types JSON NULL', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;
