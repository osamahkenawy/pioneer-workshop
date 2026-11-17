# Pioneer Car Service Center — deploy the 16 Nov feedback fixes

These are instructions for the assistant that runs the deployment. The machine
runs the **12 Nov update** (latest commit `825fd6a`, "Dashboard redesign and
smaller type (12 Nov)…", on top of `b7c0e5a` "Client meeting (3 Nov), part
2…"). This update fixes the seven points the client raised after testing it
on 16 Nov. It has **two database migrations** and no new packages or settings.

| | |
|---|---|
| Repository | https://github.com/osamahkenawy/pioneer-workshop (private) |
| Branch | `fix/job-card-leaks` — **not** `main` |
| New commit | the latest one on the branch; its message starts with **"Client feedback (16 Nov)"** |
| Previous commit (for a rollback) | `825fd6a` |
| Database migrations | 2 — one adds a table and a column, one renames a label; both safe to run twice |
| New packages / settings | none |
| Previous deploy guide (for reference) | `docs/DEPLOY_UPDATE_2026-11-12_client-meeting.md` |

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
   user — fixes are made on the developer's machine and pushed (fixes made on
   the server last time had to be redone by hand).
8. Commands below run from the clone folder `pioneer-workshop/`. Replace
   `<DB_USER>` and `<DB_NAME>` with the values in `car-workshop-backend/.env`
   (`DB_USER`, `DB_NAME`) — read only those two keys, never print the file.

---

## 0. Check the machine

```bash
git branch --show-current && git log --oneline -1 && git status --short
```

- It must be on `fix/job-card-leaks` at `825fd6a` ("Dashboard redesign and
  smaller type (12 Nov)…"). If it is at another commit, stop and tell the user.
- `git status` must show no local changes (and `git log origin/fix/job-card-leaks..HEAD`
  no local commits). If it does, stop and ask the user.

## 1. Back up the database

```bash
mysqldump -u <DB_USER> -p --single-transaction --routines <DB_NAME> > backup_$(date +%F_%H%M).sql
```

Check the file exists and is not empty (`ls -lh backup_*.sql`), then show the
user its name and size.

## 2. Get the new code

```bash
git fetch origin && git checkout fix/job-card-leaks && git pull --ff-only
```

```bash
git log --oneline -2
```

The top line must start with **"Client feedback (16 Nov)"** and the next one
with "Dashboard redesign and smaller type (12 Nov)". If not, stop and tell the
user.

## 3. Run the two migrations (ask the user first)

```bash
cd car-workshop-backend
mysql -u <DB_USER> -p <DB_NAME> < src/migrations/20261116_customer_entities.sql
mysql -u <DB_USER> -p <DB_NAME> < src/migrations/20261116_inspection_job_card.sql
cd ..
```

| Migration | What it does |
|---|---|
| `20261116_customer_entities.sql` | table `customer_entities` (the group's companies: Aman Public Transport, Aman Taxi, Autostrad International Vehicle Leasing, Pioneer Car Service Center) and `customers.entity_id`; links the existing internal accounts to their company by name |
| `20261116_inspection_job_card.sql` | renames the stored title of every main job card from "Main job card" to "Inspection job card" |

### Check the results

Run in `mysql -u <DB_USER> -p <DB_NAME>`. **Every line must return 1.**

```sql
SELECT COUNT(*) >= 4 FROM customer_entities;
SELECT COUNT(*) = 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'customers' AND column_name = 'entity_id';
SELECT COUNT(*) = 0 FROM job_cards WHERE parent_job_card_id IS NULL AND title = 'Main job card';
```

And show the user how many internal accounts were linked (for information):

```sql
SELECT e.name, COUNT(c.id) AS accounts FROM customer_entities e LEFT JOIN customers c ON c.entity_id = e.id GROUP BY e.id ORDER BY e.name;
```

## 4. Build and publish the frontend

```bash
cd car-workshop-frontend
npm run build
sudo cp -r dist/. /var/www/car-workshop/frontend/
cd ..
```

(Use the nginx root found earlier if it is not `/var/www/car-workshop/frontend/`.
A warning that a chunk is larger than 2000 kB is normal.)

## 5. Restart the API

```bash
pm2 restart car-workshop-backend
pm2 logs car-workshop-backend --lines 30
```

The log must show `listening on port …` and no errors.

## 6. Quick test (with the user's real staff logins — don't create test accounts)

Everyone reloads once (Ctrl+Shift+R, or Cmd+Shift+R on a Mac).

1. **Odometer (point 1):** open a work order with **Edit** → Vehicle page: the
   hint says "Before this visit: … km (WO-…)", the reading of the car's
   earlier visit, not this job's own. Close without saving.
2. **Entity names (point 2):** Customers → New Customer → Internal → the
   **Customer Type** section lists the group companies (Aman Taxi, …). Cancel.
   The customer list has an **All entities** filter.
3. **Name filled in (point 3):** open a sent estimate's customer link: "Your
   full name" already holds the customer's name.
4. **Technicians per job (point 4):** Team Board → "To assign" → **Assign** on
   a job: a panel lists each job of the work order with its own technician
   picker — searchable, each technician with their state (Available / Busy ·
   N open jobs / On break / Off), team and whether they are qualified for the
   job; "Same technician for all jobs" fills them in one go. Close without
   saving. The job card's "Jobs and technicians" uses the same picker.
5. **Request parts (point 5):** on the Team Board (and Job Assignment), a job
   whose approved work has parts shows **Parts to request**, a **Request parts**
   button, and Assign locked until the parts are requested. Request parts opens
   the approved parts (name, part number, quantity). Cancel — don't send it
   unless it is a real job the user wants to request.
6. **Inspection job card (point 6):** Job Cards → open one: the header says
   "Inspection job card · Work order WO-…".
7. **Supplementary estimate (point 7):** on a job whose technical inspection is
   completed, **Raise a supplementary estimate** is offered even before the
   main estimate is decided; its form lists the technical report's jobs with
   tick boxes (a job already on the main estimate is greyed out).

Don't change real records to test; look, then cancel.

## Before the workshop uses it (tell the user)

- **Record each technician's skills** (Technicians → the technician → Skills).
  A job with a service type can only be given on its own to a technician
  qualified for it; with no skills recorded, only a manager can assign it (with
  a reason). Assigning the whole work order from the Team Board works as before.

## 7. Report back to the user

The backup file name, the commit deployed (`git log --oneline -1`), the
migration checks (all = 1) and the entity counts, how the frontend and API were
restarted, the quick-test results, and anything that failed.

---

## If something goes wrong (rollback)

```bash
git checkout 825fd6a
cd car-workshop-frontend && npm run build && sudo cp -r dist/. /var/www/car-workshop/frontend/ && cd ..
pm2 restart car-workshop-backend
```

The migrations only add a table and a column (which the previous version
ignores) and rename a stored label — leave them.

---

## What changed in this update (for the user)

The client's seven points of 16 Nov:

1. **Odometer:** editing a work order compares the reading with the car's
   previous visit (it used to compare with this job's own reading, so a typo
   could not be corrected); a corrected reading also updates the physical
   inspection and the car's mileage.
2. **Entity names under Customer Type:** internal customers choose their group
   company (Aman Taxi, Aman Public Transport, Autostrad International Vehicle
   Leasing, Pioneer Car Service Center; managers can add more); the customer
   list shows and filters by it, and the work order form shows it.
3. **Name filled in automatically** on the customer's approval page and when
   staff record an in-person approval.
4. **Technicians per job** from the Team Board, with a technician picker that
   shows availability (also on the job card).
5. **Request parts** from the Team Board and Job Assignment screens.
6. The main job card reads **"Inspection job card"** everywhere.
7. **Supplementary estimate:** raised any time after the technical inspection
   (even if the main estimate is empty or not decided yet); its form lists the
   technical report's jobs with tick boxes, each added at the fixed cost for the
   customer's approval.
