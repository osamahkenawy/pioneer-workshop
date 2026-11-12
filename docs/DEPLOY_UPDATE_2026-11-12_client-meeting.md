# Pioneer Car Service Center — deploy the 3 Nov client-meeting changes

These are instructions for the assistant that runs the deployment. The machine
runs the **2 Nov feedback update** (`689d199`, "Client feedback (2 Nov, part
2)…") plus three fixes made on the server and never pushed (`90a6d95`,
`bbbbd64`, `d3e6d29` — scheduled reports, document-expiry cron, public
enquiry name, mechanic documents route). This update brings the 18 points from
the client meeting of 3 Nov 2026, plus a redesigned dashboard. On GitHub it is
**four commits**:

- `735dbd6` ("Client meeting (3 Nov), part 1 — NOT FOR DEPLOYMENT YET…") — a
  checkpoint that must **never be deployed on its own**;
- `91b3c9d` ("Production fixes (made on the server as 90a6d95, bbbbd64,
  d3e6d29), redone on the branch") — the server's three fixes, redone (their
  patches never reached the developer's machine);
- `b7c0e5a` ("Client meeting (3 Nov), part 2…") — completes the update;
- the latest commit, which starts with **"Dashboard redesign and smaller
  type (12 Nov)"** — frontend only: the Inter font, a smaller sidebar /
  topbar, and the new dashboard layout.

Deploy the latest commit only. The server's own three commits are replaced by
`91b3c9d` (step 2 keeps them on a backup branch). It has **six database migrations** and no new
packages or settings.

| | |
|---|---|
| Repository | https://github.com/osamahkenawy/pioneer-workshop (private) |
| Branch | `fix/job-card-leaks` — **not** `main` |
| New commit | the latest one on the branch; message starts with **"Dashboard redesign and smaller type (12 Nov)"**, directly on top of `b7c0e5a` ("Client meeting (3 Nov), part 2…") |
| Previous version (for a rollback) | the server's `d3e6d29`, kept as branch `server-fixes-backup` in step 2 |
| Database migrations | 6 — they add columns / tables, widen one list of values and change the menu modules of the roles; every one is safe to run twice |
| New packages / settings | none |
| Previous deploy guide (for reference) | `docs/DEPLOY_UPDATE_2026-11-02_feedback.md` |

---

## Rules for the assistant

1. Read this whole file first, tell the user the plan and **wait for their OK**.
2. **Back up first** (step 1) and show the user the backup file name. This
   update changes the database.
3. **Stop at the first error** and show it to the user — don't improvise fixes.
4. **Never print, copy or commit** `car-workshop-backend/.env` or any password.
   Let the user type the MySQL password at the prompt.
5. **Never run the QA test scripts** (`car-workshop-backend/scripts/qa/*.mjs`) on
   this machine — they create test users and **delete data**. Never create
   `qa_*` accounts here.
6. Don't use `deploy/deploy-server.sh` (outdated), and don't add
   `ESTIMATE_APPROVAL_REQUIRED` to the `.env`.
7. Commands below run from the clone folder `pioneer-workshop/`. Replace
   `<DB_USER>` and `<DB_NAME>` with the values in `car-workshop-backend/.env`
   (`DB_USER`, `DB_NAME`) — read only those two keys, never print the file.

---

## 0. Check the machine

```bash
git branch --show-current && git log --oneline -1
```

- It must be on `fix/job-card-leaks` at `d3e6d29` (the server's three local
  fixes on top of `689d199`), or at `689d199` itself. If it is at an older
  commit, stop and tell the user — the earlier guides have to be followed first.
- **If it is at `735dbd6`** ("…NOT FOR DEPLOYMENT YET…"), someone deployed the
  checkpoint: tell the user, then carry on from step 1 — this update completes
  it, and the migrations are safe to run again.
- `git status` must show no local changes. If it does, stop and ask the user.
- Note how the API runs (`pm2 list` → `car-workshop-backend`, or a terminal) and
  how the frontend is served (nginx serving the built files — usually
  `/var/www/car-workshop/frontend/` — or a Vite dev server).

## 1. Back up the database

```bash
mysqldump -u <DB_USER> -p --single-transaction --routines <DB_NAME> > backup_$(date +%F_%H%M).sql
```

Check the file exists and is not empty (`ls -lh backup_*.sql`), then show the
user its name and size.

## 2. Get the new code

The server's three local commits are not on GitHub, so a plain `git pull` would
try to merge them. Keep them on a backup branch, then move to GitHub's version
(`git status` was clean in step 0, so nothing uncommitted is lost):

```bash
git fetch origin
git branch -f server-fixes-backup HEAD
git checkout fix/job-card-leaks && git reset --hard origin/fix/job-card-leaks
```

```bash
git log --oneline -4
```

From the top, the lines must start with **"Dashboard redesign and smaller
type (12 Nov)"**, **"Client meeting (3 Nov), part 2"**, **"Production fixes
(made on the server…"** and "Client meeting (3 Nov), part 1…". If the top line
starts with "Client meeting (3 Nov), part 1 — NOT FOR DEPLOYMENT YET", **stop**:
the second part has not been pushed yet; tell the user (and go back with
`git reset --hard server-fixes-backup`). If the top line is part 2 itself, the
dashboard commit has not been pushed yet — that is fine to deploy; tell the
user.

Optional check that nothing of the server's fixes is missing — the differences
shown should only be the client-meeting changes, plus the mechanic documents
route being written slightly differently:

```bash
git diff server-fixes-backup HEAD -- car-workshop-backend/src/lib/scheduled-reports.js car-workshop-backend/src/lib/doc-expiry-cron.js car-workshop-backend/src/routes/mechanic-documents.js
```

## 3. Run the six migrations (ask the user first)

In this order — the last one changes the roles' menus, so it goes last:

```bash
cd car-workshop-backend
mysql -u <DB_USER> -p <DB_NAME> < src/migrations/20261112_enquiry_fields.sql
mysql -u <DB_USER> -p <DB_NAME> < src/migrations/20261112_technical_report_share.sql
mysql -u <DB_USER> -p <DB_NAME> < src/migrations/20261112_staff_subcategory.sql
mysql -u <DB_USER> -p <DB_NAME> < src/migrations/20261112_supplementary_estimates.sql
mysql -u <DB_USER> -p <DB_NAME> < src/migrations/20261112_job_tasks_skills.sql
mysql -u <DB_USER> -p <DB_NAME> < src/migrations/20261112_job_cards_module.sql
cd ..
```

| Migration | What it does |
|---|---|
| `20261112_enquiry_fields.sql` | `enquiries.emirate`, `vehicle_make`, `vehicle_model`, `vehicle_year` (points 2–3) |
| `20261112_technical_report_share.sql` | `technical_inspections.share_token`, `shared_at`, `shared_via` — the technical report link sent to the customer (point 8); gives completed reports a link |
| `20261112_staff_subcategory.sql` | adds **Staff** to the customer subcategory lists (`customers`, `work_orders`) (point 12) |
| `20261112_supplementary_estimates.sql` | `service_estimates.kind` (main / supplementary) and `parent_estimate_id`; table `estimate_consents`; `estimate_lines.consent_id` (point 10) |
| `20261112_job_tasks_skills.sql` | table `job_card_tasks` (one row per approved job, with its technician and barcode); `technician_time_logs.task_id`; `mechanics.skills`, `mechanics.badge_code` (points 14, 16, 17) |
| `20261112_job_cards_module.sql` | adds the new **Job Cards** menu module to every role that has Work Orders; the Workshop Foreman gets Job Cards **instead of** Work Orders (points 6, 15) |

### Check the results

Run in `mysql -u <DB_USER> -p <DB_NAME>`. **Every line must return 1.**

```sql
SELECT COUNT(*) = 4 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'enquiries' AND column_name IN ('emirate','vehicle_make','vehicle_model','vehicle_year');
SELECT COUNT(*) = 3 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'technical_inspections' AND column_name IN ('share_token','shared_at','shared_via');
SELECT column_type LIKE '%''staff''%' FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'customers' AND column_name = 'customer_subcategory';
SELECT COUNT(*) = 2 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'service_estimates' AND column_name IN ('kind','parent_estimate_id');
SELECT COUNT(*) = 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'estimate_consents';
SELECT COUNT(*) = 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'job_card_tasks';
SELECT COUNT(*) = 2 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'mechanics' AND column_name IN ('skills','badge_code');
SELECT COUNT(*) = 0 FROM roles WHERE JSON_CONTAINS(COALESCE(modules, JSON_ARRAY()), '"work-orders"') AND NOT JSON_CONTAINS(modules, '"job-cards"');
```

## 4. Build and publish the frontend

**If nginx serves the built files** (the usual setup):

```bash
cd car-workshop-frontend
npm run build
sudo cp -r dist/. /var/www/car-workshop/frontend/
cd ..
```

Use the nginx root found in step 0 if it is not `/var/www/car-workshop/frontend/`.
(A warning that a chunk is larger than 2000 kB is normal.)

**If the frontend runs with the Vite dev server** instead: restart that
`npm run dev` process.

## 5. Restart the API

**With pm2:**

```bash
pm2 restart car-workshop-backend
pm2 logs car-workshop-backend --lines 30
```

The log must show `listening on port …` and no errors.

**If the API runs in a terminal**: stop it (Ctrl-C) and start it again the same way.

## 6. Quick test (with the user's real staff logins — don't create test accounts)

**Everyone signs out and back in** — the menus changed (new Job Cards module;
the Workshop Foreman no longer has Work Orders). Then reload once
(Ctrl+Shift+R, or Cmd+Shift+R on a Mac).

1. **Look:** the sidebar and page titles are smaller and the text is in the
   Inter font. The Dashboard has no big navy banner: a header with the
   greeting and the This Week / This Month / All time switch, six figure tiles
   in a row, then Your tasks, the charts and lists.
2. **Menu:** Work Orders, **Job Cards** and **Scan station** are there for a
   manager. A Workshop Foreman sees Job Cards but not Work Orders.
3. **Customers:** the menu entry has two tabs, Enquiries and Customers. New
   Enquiry asks for the **Emirate** and the car's **make, model and year**; the
   "Not Converted" filter is gone. Internal customers can be **Staff**. Cancel
   without saving.
4. **Work Orders:** the cards on top read Total / Open / Completed / Cancelled.
   Open a work order whose physical inspection the customer has acknowledged:
   it reads **Completed — the job continues on job card JC-…**, with a link to
   the job card.
5. **Physical inspection:** no damage-type list — tap the car to mark, tap a mark
   to remove it. Customer and car details are read-only (they come from the
   work order).
6. **Technical inspection:** no Findings box; each service line needs a service
   type. Once completed it can be sent to the customer as a link that shows the
   jobs and parts **without** hours or quantities.
7. **Estimates:** New Estimate asks for the work order and refuses one whose
   technical inspection is not completed. Once the customer has decided the
   main estimate, the job card offers **Raise a supplementary estimate**
   (number `SEST-…`, fixed cost, the customer's consent). The estimates list
   can approve / reject several lines at once.
8. **Parts first:** on a job whose approved work has parts, assigning a
   technician says to request the parts (MRN) first.
9. **Technicians:** each technician has **Skills** tick boxes, **Print badge**
   and **Lost badge**. Scan station opens with a large input. On a job card,
   **Jobs** lists each approved job with its technician and a **Print job card
   with barcodes** button.

Don't change real records to test; look, then cancel. If a test job is needed,
use one the user names and cancel it afterwards.

## 7. Report back to the user

A short report: the backup file name, the commit deployed (`git log --oneline -1`),
the migration results (all eight checks = 1), how the frontend and API were
restarted, the quick-test results, and anything that failed.

---

## Before the workshop uses it (tell the user)

- **Record each technician's skills** (Technicians → the technician → Skills).
  A job with a service type can only be given, on its own, to a technician
  qualified for it; a technician with no skills recorded counts as not
  qualified (a manager can override with a reason). Assigning the whole job
  from the Team Board works as before.
- **Scan station:** a PC on the floor signed in as a Team Leader / Supervisor /
  Foreman, with a USB barcode scanner, on the Scan station page. Badges are
  optional; a manager can make them required on that page.
- **Process changes staff will notice:** the estimate is raised from the work
  order after the technical inspection is completed; the parts are requested
  from the Store (MRN) before a technician is assigned; the foreman works from
  Job Cards.

---

## If something goes wrong (rollback)

1. Code back to the previous version (the server's own, kept in step 2):

   ```bash
   git reset --hard server-fixes-backup
   cd car-workshop-frontend && npm run build && sudo cp -r dist/. /var/www/car-workshop/frontend/ && cd ..
   pm2 restart car-workshop-backend
   ```

2. Give the Workshop Foreman back the Work Orders menu (the old code does not
   know the Job Cards module, so the foreman would otherwise lose the work
   orders):

   ```sql
   UPDATE roles SET modules = JSON_ARRAY_APPEND(modules, '$', 'work-orders')
    WHERE slug = 'workshop_foreman' AND modules IS NOT NULL AND NOT JSON_CONTAINS(modules, '"work-orders"');
   ```

The other migrations only add columns and tables (and the Staff value), which
the previous version ignores — leave them. Restoring the backup is only needed
if the user asks for it, and it loses everything entered since the backup.

---

## What changed in this update (for the user)

The client meeting of 3 Nov 2026, point by point:

1. Enquiries: the "Not Converted" status is gone.
2. Enquiries ask for the **Emirate**.
3. The car's make / model / year are asked once, at the enquiry, and carried
   forward.
4. Physical inspection: no damage type — tap to mark, tap again to remove.
5. Details entered once are filled in at the later stages (inspection header
   read-only, from the work order).
6. **Two modules, one job:** the work order covers Steps 1–3 and reads
   Completed once the main job card opens at the physical inspection; the new
   **Job Cards** module covers Steps 4–7.
7. Technical inspection: Findings removed; a service type per job (the list is
   provisional until the client sends theirs).
8. The technical report goes to the customer as a link, without hours or
   quantities.
9. The estimate follows the completed technical inspection.
10. **Main and supplementary estimates:** a supplementary estimate (`SEST-…`)
    is linked to the main one, priced at a fixed cost, and approved with the
    customer's consent.
11. Approve / reject several estimate lines at once.
12. Enquiries and Customers in one module with two tabs; **Staff** subcategory.
13. Technician availability from the HR system — **not built yet** (waiting for
    the client's HR system details); availability is "active technician" for now.
14. A technician per job (each approved job on its own).
15. Foremen use Job Cards only.
16. Technician skills; jobs are offered to qualified technicians.
17. Printed job cards with a barcode per job; the **Scan station** starts and
    ends jobs (no phones on the floor).
18. The parts are requested from the Store (MRN) before a technician is assigned.

Also in this update (the user's feedback, 12 Nov): smaller text across the
app's frame (sidebar 13.5px, page titles 18px, base text 14px), the Inter font
loaded for everyone (Windows used to show Arial), and a redesigned Dashboard —
compact header and figure tiles, quieter task lists and charts.
