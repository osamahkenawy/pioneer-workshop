-- Client feedback (16 Nov 2026), point 6: "After completion of physical
-- inspection, the job card should read as Inspection Job card." New main job
-- cards are created with that title (lib/workflow.js); this renames the ones
-- already open, so every screen and print reads the same. Safe to run twice.
UPDATE job_cards
   SET title = 'Inspection job card'
 WHERE parent_job_card_id IS NULL
   AND title = 'Main job card';
