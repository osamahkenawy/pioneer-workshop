-- ═══════════════════════════════════════════════════════════════════════
-- Job Cards module (client meeting, 3 Nov 2026, points 6 and 15).
--
-- The work order covers Steps 1–3 and is completed when the physical
-- inspection opens its job card; the job carries on in a separate Job Cards
-- menu module ('job-cards', Steps 4–7). Every role that has Work Orders gets
-- Job Cards; the Workshop Foreman works on job cards only, without Work
-- Orders (their full access matrix is still to be agreed).
--
-- Idempotent.
-- ═══════════════════════════════════════════════════════════════════════

UPDATE roles
   SET modules = JSON_ARRAY_APPEND(modules, '$', 'job-cards')
 WHERE JSON_CONTAINS(COALESCE(modules, JSON_ARRAY()), '"work-orders"')
   AND NOT JSON_CONTAINS(modules, '"job-cards"');

-- The Foreman: Job Cards in place of Work Orders.
UPDATE roles
   SET modules = JSON_ARRAY_APPEND(modules, '$', 'job-cards')
 WHERE slug = 'workshop_foreman' AND modules IS NOT NULL
   AND NOT JSON_CONTAINS(modules, '"job-cards"');
UPDATE roles
   SET modules = JSON_REMOVE(modules, JSON_UNQUOTE(JSON_SEARCH(modules, 'one', 'work-orders')))
 WHERE slug = 'workshop_foreman' AND JSON_SEARCH(modules, 'one', 'work-orders') IS NOT NULL;
