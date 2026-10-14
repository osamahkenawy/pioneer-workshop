-- ═══════════════════════════════════════════════════════════════════════
-- Workshop Manager: the Settings menu.
--
-- The Workshop Manager decides who does what (Settings → Roles) and adds
-- users (Settings → Users) — the Workshop Manager manual sends them there,
-- and the API already allows it (managers hold every capability). The role's
-- menu modules never listed 'settings', so the page was hidden and, since
-- every page now checks its menu module, refused.
--
-- Idempotent: only appends when the module is missing.
-- ═══════════════════════════════════════════════════════════════════════

UPDATE roles
   SET modules = JSON_ARRAY_APPEND(modules, '$', 'settings')
 WHERE slug = 'workshop_manager'
   AND modules IS NOT NULL
   AND NOT JSON_CONTAINS(modules, '"settings"');
