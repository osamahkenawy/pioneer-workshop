# Pioneer Car Service Center — deploy the 18 Nov feedback fixes

These are instructions for the assistant that runs the deployment. The machine
should run the **16 Nov update** (commit `6c3a6ea`, "Client feedback (16 Nov)…").
This update fixes the nine points the client raised on 18 Nov. It has **one new
migration**, and — important — it also **runs every migration since 12 Nov
again**, because the client's screenshots show the 12 Nov and 16 Nov
migrations were most likely never run on this server (the customer list in
New Work Order was empty and "Staff" / the entity names were missing: the
customer list query needs the `customer_entities` table). Every one of these
files is safe to run twice. No new packages or settings.

| | |
|---|---|
| Repository | https://github.com/osamahkenawy/pioneer-workshop (private) |
| Branch | `fix/job-card-leaks` — **not** `main` |
| New commit | the latest one on the branch; its message starts with **"Client feedback (18 Nov)"** |
| Previous commit (for a rollback) | `6c3a6ea` |
| Database migrations | 9 files, in order (8 from 12–16 Nov, re-run; 1 new) — all safe to run twice |
| New packages / settings | none (a new value in Settings → Estimates, set by a manager in the app) |
| Previous deploy guide | `docs/DEPLOY_UPDATE_2026-11-16_feedback.md` |

---

## Rules for the assistant

1. Read this whole file first, tell the user the plan and **wait for their OK**.
2. **Back up first** (step 1) and show the user the backup file name.
3. **Stop at the first error** and show it to the user — don't improvise fixes.
4. **Never print, copy or commit** `car-workshop-backend/.env` or any password.
   Let the user type the MySQL password at the prompt.
5. **Never run the QA test scripts** (`car-workshop-backend/scripts/qa/*.mjs`) on
   this machine — they create test users and **delete data**. Never create
   `qa_*` accounts here.
6. Don't use `deploy/deploy-server.sh` (outdated), and don't add
   `ESTIMATE_APPROVAL_REQUIRED` to the `.env`.
7. **Don't fix code on the server.** If something is broken, stop and tell the
   user — fixes are made on the developer's machine and pushed.
8. Commands below run from the clone folder `pioneer-workshop/`. Replace
   `<DB_USER>` and `<DB_NAME>` with the values in `car-workshop-backend/.env`
   (`DB_USER`, `DB_NAME`) — read only those two keys, never print the file.

---

## 0. Check the machine

```bash
git branch --show-current && git log --oneline -1 && git status --short
```

- It should be on `fix/job-card-leaks` at `6c3a6ea` ("Client feedback (16 Nov)…").
  If it is at an older commit (`825fd6a`, `b7c0e5a`…), tell the user which one —
  this update includes those changes, so it can go on top after their OK.
- `git status` must show no local changes (and `git log origin/fix/job-card-leaks..HEAD`
  no local commits). If it does, stop and ask the user.

## 1. Back up the database

```bash
mysqldump -u <DB_USER> -p --single-transaction --routines <DB_NAME> > backup_$(date +%F_%H%M).sql
```

Check the file exists and is not empty (`ls -lh backup_*.sql`), then show the
user its name and size.

## 2. See which migrations are missing (before changing anything)

Run in `mysql -u <DB_USER> -p <DB_NAME>` and **show the user the result** — it
tells them whether the earlier deployments skipped their migrations:

```sql
SELECT 'customer_entities table (16 Nov)' AS item, COUNT(*) AS present FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'customer_entities'
UNION ALL SELECT 'customers.entity_id (16 Nov)', COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'customers' AND column_name = 'entity_id'
UNION ALL SELECT 'Staff subcategory (12 Nov)', COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'customers' AND column_name = 'customer_subcategory' AND column_type LIKE '%''staff''%'
UNION ALL SELECT 'job_card_tasks table (12 Nov)', COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'job_card_tasks'
UNION ALL SELECT 'estimate_consents table (12 Nov)', COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'estimate_consents'
UNION ALL SELECT 'enquiries.emirate (12 Nov)', COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'enquiries' AND column_name = 'emirate';
```

A `0` means that migration never ran. Either way, step 4 runs them all.

## 3. Get the new code

```bash
git fetch origin && git checkout fix/job-card-leaks && git pull --ff-only
```

```bash
git log --oneline -2
```

The top line must start with **"Client feedback (18 Nov)"** and the next one
with "Client feedback (16 Nov)". If not, stop and tell the user.

## 4. Run the migrations, in this order (ask the user first)

```bash
cd car-workshop-backend/src/migrations
for f in 20261112_enquiry_fields.sql 20261112_job_cards_module.sql 20261112_job_tasks_skills.sql \
         20261112_staff_subcategory.sql 20261112_supplementary_estimates.sql 20261112_technical_report_share.sql \
         20261116_customer_entities.sql 20261116_inspection_job_card.sql 20261118_feedback.sql; do
  echo "== $f"; mysql -u <DB_USER> -p <DB_NAME> < "$f" || { echo "STOPPED at $f"; break; }
done
cd ../../..
```

(It asks for the password once per file. If one fails, stop and show the user.)

| Migration | What it does |
|---|---|
| `20261112_*` (6 files) | the 12 Nov client meeting: enquiry emirate and car fields, Job Cards module, jobs per technician + skills + scan codes, Staff subcategory, supplementary estimates + consent, technical report link |
| `20261116_customer_entities.sql` | the group's companies (Aman Public Transport, Aman Taxi, Autostrad International Vehicle Leasing, Pioneer Car Service Center) and `customers.entity_id` |
| `20261116_inspection_job_card.sql` | main job cards titled "Inspection job card" |
| `20261118_feedback.sql` (**new**) | `estimate_lines.is_fixed_fee` (the supplementary estimate's fixed cost line) and an index on `enquiries (customer_id, status)` |

### Check the results

Run the SQL of step 2 again — **every line must now be 1** — and these two:

```sql
SELECT COUNT(*) = 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'estimate_lines' AND column_name = 'is_fixed_fee';
SELECT COUNT(*) >= 4 FROM customer_entities;
```

## 5. Build and publish the frontend

```bash
cd car-workshop-frontend
npm run build
sudo cp -r dist/. /var/www/car-workshop/frontend/
cd ..
```

(Use the nginx root found earlier if it is not `/var/www/car-workshop/frontend/`.
A warning that a chunk is larger than 2000 kB is normal.)

## 6. Restart the API

```bash
pm2 restart car-workshop-backend
pm2 logs car-workshop-backend --lines 40
```

The log must show `listening on port …` and **`✅ Database schema up to date`**.
If it shows `❌ DATABASE MIGRATIONS MISSING`, it lists each missing file —
stop and show the user.

## 7. Quick test (with the user's real staff logins — don't create test accounts)

Everyone reloads once (Ctrl+Shift+R, or Cmd+Shift+R on a Mac). Look, then
cancel — don't change real records.

1. **Point 1:** Work Orders → New Work Order → External → Existing: the
   customer list shows customers straight away (no typing needed).
2. **Point 2:** the Customers menu opens one page (no Enquiries tab), with
   "Everyone / Open enquiries / Follow-ups due / No open enquiry" and a
   **Stage** column. New Customer has 5 steps; the last is **Enquiry**.
   New Work Order → Internal → a subcategory: **Staff** is there, and the
   **Entity** pills (Aman Taxi, …) appear. Close without saving.
3. **Points 3 / 7:** a work order's Step 3 reads "Physical inspection &
   Inspection job card"; Team Board → Request parts says "on job card JC-…".
4. **Point 4:** Settings → **Estimates** shows the fixed cost fields (empty
   until the workshop sets the amount — tell the user).
5. **Point 5:** a work order with no vehicle: Step 2 shows a vehicle picker and
   **Add a new vehicle** in place.
6. **Point 8:** Technicians → **Skills** opens a grid of technicians × service
   types. Close without saving.

## 8. Report back to the user

The backup file name, which migrations were missing in step 2, the commit
deployed (`git log --oneline -1`), the step 4 checks (all = 1), the
`Database schema up to date` line, and the quick-test results.

---

## Before the workshop uses it (tell the user)

- **Set the fixed cost:** Settings → Estimates → amount (before VAT) and its
  wording (e.g. "Technical inspection report"). Until then the supplementary
  estimate's tick box says it is not set up.
- **Record the skills once:** Technicians → Skills → tick each technician's
  service types (a whole column ticks with one click on its heading). Until a
  technician has the skill, assigning them records it (no comment needed).

## If something goes wrong (rollback)

```bash
git checkout 6c3a6ea
cd car-workshop-frontend && npm run build && sudo cp -r dist/. /var/www/car-workshop/frontend/ && cd ..
pm2 restart car-workshop-backend
```

The migrations only add columns, tables, an index and enum values that the
previous version ignores — leave them.

---

## What changed in this update (for the user)

The client's nine points of 18 Nov:

1. **Customer list in New Work Order:** most likely the missing 16 Nov
   migration (the list query failed on the server and showed nothing). Now the
   form says when the list cannot load (with Try again) instead of looking
   empty, the API logs the cause, and it checks at start-up that every
   migration it needs has run.
2. **Enquiries and Customers are one module:** one Customers page, one list
   with each customer's enquiry (status, channel, follow-up; overdue in red),
   filters for open enquiries and follow-ups due, enquiry insights on demand,
   and one New Customer form whose last step logs the enquiry. Enquiries are
   opened, booked and converted from the list and the customer panel; old
   `/enquiries` links land there. Staff and the entity names were already
   built (12 / 16 Nov) and appear once their migrations run; the work order
   form now also shows the entity names under Internal.
3. **Inspection job card:** the main job card is the "Inspection job card"
   from the physical inspection on (Step 3, job card, Job Cards list) — the
   translations still said "Main job card", now fixed in all 12 languages.
   Before the inspection the screens say "work order".
4. **Supplementary estimate fixed cost:** a tick box on the supplementary
   estimate adds the workshop's fixed cost (Settings → Estimates) as one line
   for the customer's approval with consent — e.g. when the main estimate is
   empty. It is priced by the server and never becomes a technician job.
5. **Add the vehicle from Step 2:** pick one of the customer's cars or add a
   new one in place, with the odometer and (if missing) the reported issue.
6. **Name filled in on the inspection sign form** — the customer's link, the
   customer portal, and the staff signature at the car.
7. **Request parts** says "job card", not "Inspection job card" (also the
   Team Board and the technician app: the repair stage).
8. **Skills:** Technicians → Skills is a one-screen grid. Assigning someone
   without the skill records it on them (no comment); a manager can still
   assign "just this once" with a reason.
9. **Odometer typed once:** a reading typed before "Add a new vehicle" (or
   before picking a car) is kept.
