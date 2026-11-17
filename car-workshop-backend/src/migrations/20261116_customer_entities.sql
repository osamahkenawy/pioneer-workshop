-- Client feedback (16 Nov 2026), point 2 / meeting of 3 Nov, point 12:
-- "include the entity names under Customer Type". An internal account belongs
-- to one of the group's own entities (Aman Taxi, Aman Public Transport, …).
--
-- customer_entities: the group's entities, per workshop (managers can add
-- more from the Customers screen). customers.entity_id: the entity an
-- internal account belongs to (NULL for external customers).
--
-- Seeded with the four entities whose accounts are already on file, and the
-- existing internal accounts are linked by name ("AMAN TAXI. LLC" → Aman
-- Taxi). Guarded: safe to run twice.

CREATE TABLE IF NOT EXISTS customer_entities (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  workshop_id INT NOT NULL,
  name        VARCHAR(150) NOT NULL,
  is_active   TINYINT(1) NOT NULL DEFAULT 1,
  created_by  INT NULL,
  created_at  TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_customer_entity_name (workshop_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @col := (SELECT COUNT(*) FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'customers' AND column_name = 'entity_id');
SET @sql := IF(@col = 0,
  "ALTER TABLE customers ADD COLUMN entity_id INT NULL COMMENT 'Internal account: the group entity it belongs to (customer_entities)' AFTER customer_subcategory",
  'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

SET @idx := (SELECT COUNT(*) FROM information_schema.statistics
             WHERE table_schema = DATABASE() AND table_name = 'customers' AND index_name = 'idx_customers_entity');
SET @sql := IF(@idx = 0, 'ALTER TABLE customers ADD KEY idx_customers_entity (entity_id)', 'SELECT 1');
PREPARE s FROM @sql; EXECUTE s; DEALLOCATE PREPARE s;

INSERT IGNORE INTO customer_entities (workshop_id, name)
SELECT w.id, n.name
  FROM workshops w
  JOIN (SELECT 'Aman Public Transport' AS name
        UNION ALL SELECT 'Aman Taxi'
        UNION ALL SELECT 'Autostrad International Vehicle Leasing'
        UNION ALL SELECT 'Pioneer Car Service Center') n;

-- Link the internal accounts already on file, by the start of their name.
-- The pattern's collation is pinned: customers and the new table may have
-- different default collations (utf8mb4_0900_ai_ci vs utf8mb4_unicode_ci).
UPDATE customers c
  JOIN customer_entities e ON e.workshop_id = c.workshop_id
   SET c.entity_id = e.id
 WHERE c.customer_class = 'internal'
   AND c.entity_id IS NULL
   AND (UPPER(COALESCE(c.company_name, '')) LIKE (CONCAT(UPPER(e.name), '%') COLLATE utf8mb4_unicode_ci)
        OR UPPER(COALESCE(c.full_name, '')) LIKE (CONCAT(UPPER(e.name), '%') COLLATE utf8mb4_unicode_ci));
