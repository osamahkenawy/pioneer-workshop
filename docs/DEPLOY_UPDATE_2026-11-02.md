# Pioneer Car Service Center — deploy the 2 Nov 2026 update

These are instructions for the assistant that runs the deployment. The machine
already runs the **30 Oct 2026 version** (commit `c17aac4` on branch
`fix/job-card-leaks`). This update adds the client's review changes of 2 Nov.

| | |
|---|---|
| Repository | https://github.com/osamahkenawy/pioneer-workshop (private) |
| Branch | `fix/job-card-leaks` — **not** `main` |
| New commit | the latest one on the branch; its message starts with **"Client review (2 Nov)"** |
| Previous commit (for a rollback) | `c17aac4` |
| New database migrations | 2 (both only add columns / one table; safe to run twice) |
| New packages | none |
| New settings | none (see the note on `ESTIMATE_APPROVAL_REQUIRED` below) |
| Full guide (for reference) | `docs/DEPLOY_2026-10-14.md` in the repo |

---

## Rules for the assistant

1. **Back up first** (step 1) and show the user the backup file name before
   changing anything.
2. Read this whole file first, then tell the user the plan and **wait for their
   OK before any step that changes the database** (step 3).
3. **Stop at the first error** and show it to the user — don't improvise fixes on
   the database.
4. **Never print, copy or commit** `car-workshop-backend/.env` or any password.
   Let the user type the MySQL password at the prompt.
5. **Never run the QA test scripts** (`car-workshop-backend/scripts/qa/*.mjs`) on
   this machine — they create test users and **delete data**. Never create
   `qa_*` accounts here.
6. Don't use `deploy/deploy-server.sh` (outdated).
7. **Don't add `ESTIMATE_APPROVAL_REQUIRED`** to the `.env`. Leaving it out keeps
   the supervisor approval of external estimates switched off, as the client
   asked. (`ESTIMATE_APPROVAL_REQUIRED=true` would bring it back.)
8. Commands below run from the clone folder `pioneer-workshop/` unless a step
   says otherwise. Replace `<DB_USER>` and `<DB_NAME>` with the values in
   `car-workshop-backend/.env` (`DB_USER`, `DB_NAME`) — read only those two keys,
   never print the file.

---

## 0. Find out how the app runs on this machine

Before changing anything, check — and tell the user what you found:

- Where the clone is, and that it is on `fix/job-card-leaks` at `c17aac4`:

  ```bash
  git branch --show-current && git log --oneline -1
  ```

- How the API runs: `pm2 list` (look for `car-workshop-backend`), or a terminal
  running `npm run dev` / `node src/server.js`.
- How the frontend is served: nginx serving the built `dist/` folder (see the
  `root` in `deploy/car-workshop-nginx.conf` or the live nginx site config —
  usually `/var/www/car-workshop/frontend/`), or a Vite dev server
  (`npm run dev` in `car-workshop-frontend`).
- `git status` must show no local changes. If it does, stop and ask the user.

## 1. Back up the database

```bash
mysqldump -u <DB_USER> -p --single-transaction --routines <DB_NAME> > backup_$(date +%F_%H%M).sql
```

Check the file exists and is not empty (`ls -lh backup_*.sql`), then show the
user its name and size.

## 2. Get the new code

```bash
git fetch origin && git checkout fix/job-card-leaks && git pull
```

```bash
git log --oneline -1
```

The message must start with **"Client review (2 Nov)"**. If it doesn't, stop —
the update has not been pushed yet; ask the user.

No new packages in this update, so `npm ci` is not needed (running it does no
harm).

## 3. Run the two new migrations (ask the user first)

```bash
cd car-workshop-backend
mysql -u <DB_USER> -p <DB_NAME> < src/migrations/20261102_intake_fields.sql
mysql -u <DB_USER> -p <DB_NAME> < src/migrations/20261102_technical_report_part_numbers.sql
cd ..
```

| File | What it adds |
|---|---|
| `car-workshop-backend/src/migrations/20261102_intake_fields.sql` | `vehicles.vehicle_type`; `work_orders.parts_preference`, `enquiries.parts_preference` (Genuine / After-Market / Used asked at the enquiry); `work_orders.job_types` (Step 4 multi-select) |
| `car-workshop-backend/src/migrations/20261102_technical_report_part_numbers.sql` | table `technical_inspections` (the technical inspection / report); `estimate_lines.genuine_part_number`, `aftermarket_part_number`, `used_part_number` |

Both check `information_schema` before changing anything, so running them twice
is safe. If either fails, stop and show the error.

## 4. Check the database

Run in `mysql -u <DB_USER> -p <DB_NAME>`. **Every line must return 1.**

```sql
SELECT COUNT(*) = 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'vehicles'       AND column_name = 'vehicle_type';
SELECT COUNT(*) = 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'work_orders'    AND column_name = 'parts_preference';
SELECT COUNT(*) = 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'enquiries'      AND column_name = 'parts_preference';
SELECT COUNT(*) = 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'work_orders'    AND column_name = 'job_types';
SELECT COUNT(*) = 1 FROM information_schema.tables  WHERE table_schema = DATABASE() AND table_name = 'technical_inspections';
SELECT COUNT(*) = 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'estimate_lines' AND column_name = 'used_part_number';
```

## 5. Build and publish the frontend

**If nginx serves the built files** (the usual setup):

```bash
cd car-workshop-frontend
npm run build
sudo cp -r dist/. /var/www/car-workshop/frontend/
cd ..
```

Use the nginx root you found in step 0 if it is not `/var/www/car-workshop/frontend/`.

**If the frontend runs with the Vite dev server** instead: no build is needed —
restart that `npm run dev` process so it picks up the new code.

## 6. Restart the API

**With pm2:**

```bash
pm2 restart car-workshop-backend
pm2 logs car-workshop-backend --lines 30
```

The log must show `listening on port …` and no errors.

**If the API runs in a terminal** (`npm run dev` / `node src/server.js`): stop it
(Ctrl-C) and start it again the same way.

## 7. In the app (tell the user)

- **Everyone signs out and signs in again.** The Supervisor and the Workshop
  Foreman get a new permission ("Technical inspection and report"), which is
  loaded at sign-in.
- If someone customised the **Supervisor** or **Workshop Foreman** role in
  Settings → Roles, tick **"Technical inspection and report"** for them.

## 8. Quick test (with the user's real staff logins — don't create test accounts)

1. Work Orders → New Work Order: it refuses to continue without an **odometer
   reading**, and refuses a reading **lower** than the car's last one — for
   everyone, managers included.
2. Adding a new car needs **plate number, emirate, year and VIN**; there is a
   **Vehicle type** list. The work order form has **Customer complaint**, **Parts
   the customer accepts** (Genuine / After-Market / Used) and **Note for
   workshop** — no Job type, no Service category. The button says **Create work
   order**.
3. The vehicle inspection page has a **Damage type** drop-down (no legend). The
   link sent to the customer says **"Work order WO-…"**, not "Job card".
4. After the customer signs the physical inspection, the job card opens; in
   **Step 4** the Supervisor / Foreman can **start the technical inspection** and
   print the **technical report**; the Service Advisor raises the estimate from it.
5. The Storekeeper (Store → Parts to price) sees a **Part no. for each part type**;
   saving says "All parts priced — the Service Advisor has been notified".
6. The Service Advisor can **send the estimate without any approval** (there is no
   "Needs approval" tab on Estimates any more).

Cancel any test work order you create (Work Orders → the job → Cancel), or use a
real job the user names.

## 9. Report back to the user

A short report: the backup file name, the commit deployed (`git log --oneline -1`),
the migration and check results (all six = 1), how the frontend and API were
restarted, the quick-test results, and anything that failed.

---

## If something goes wrong (rollback)

The two migrations only **add** columns and one table — the previous version
ignores them, so going back is a code-only step:

```bash
git checkout c17aac4
cd car-workshop-frontend && npm run build && sudo cp -r dist/. /var/www/car-workshop/frontend/ && cd ..
pm2 restart car-workshop-backend
```

(Or restart the dev servers the way they run on this machine.) Restore the
database backup from step 1 only if the user asks — it would also undo every
job saved since the backup.

---

## What changed in this update (for the user)

- The **odometer** reading is required and can't go below the car's previous
  reading (no override, managers included).
- **VIN, plate number, emirate and model year** are required on a car; new
  **vehicle type** field (Sedan, Crossover, SUV, Medium Bus, Large Bus, Medium
  Truck, Large Truck, Hydraulic equipment).
- Enquiry and work order forms: **Customer complaint** (multi-line); **parts the
  customer accepts** (any combination of Genuine / After-Market / Used) — the
  estimate then offers only those; no Job type / Enquiry type / Service category;
  **Note for workshop**; button **Create work order**.
- **Job types** are ticked (multi-select) at Step 4 — provisional list until the
  client sends theirs.
- Inspection: **damage-type drop-down** instead of the legend; customer pages say
  **Work order** instead of Job card.
- **Technical inspection & technical report** by the Supervisor / Workshop Foreman
  after the job card opens; the estimate is pre-filled from it.
- Storekeeper: a **part number per part type**; the estimate goes back to the
  Service Advisor with **no approval step** (the supervisor sign-off is removed).
- Still to come: the **three inventory tables imported from ORBITS** — waiting for
  the client's export file.
