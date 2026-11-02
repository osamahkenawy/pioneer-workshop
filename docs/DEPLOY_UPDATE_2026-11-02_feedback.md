# Pioneer Car Service Center — deploy the 2 Nov feedback fixes

These are instructions for the assistant that runs the deployment. The machine
already runs the **2 Nov 2026 update** (commit `2e1d62c` on branch
`fix/job-card-leaks`, message "Client review (2 Nov)…"). This follow-up fixes
the user's feedback on it. **Code only: no database migrations, no new
packages, no new settings.**

| | |
|---|---|
| Repository | https://github.com/osamahkenawy/pioneer-workshop (private) |
| Branch | `fix/job-card-leaks` — **not** `main` |
| New commit | the latest one on the branch; its message starts with **"Client feedback (2 Nov)"** |
| Previous commit (for a rollback) | `2e1d62c` |
| Database migrations | none |
| New packages / settings | none |
| Previous deploy guide (for reference) | `docs/DEPLOY_UPDATE_2026-11-02.md` |

---

## Rules for the assistant

1. Read this whole file first, tell the user the plan and **wait for their OK**.
2. **Back up first** (step 1) and show the user the backup file name. Nothing
   in this update changes the database, but it is the safe habit.
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

- It must be on `fix/job-card-leaks` at `2e1d62c` ("Client review (2 Nov)…").
- **If it is still at `c17aac4`** ("Client changes (29 Oct)…"), the 2 Nov update
  was never deployed: stop and tell the user. That update needs its two
  database migrations (`docs/DEPLOY_UPDATE_2026-11-02.md`, steps 3–4); with the
  user's OK, run them after step 2 below, then continue with step 3.
- `git status` must show no local changes. If it does, stop and ask the user.
- Note how the API runs (`pm2 list` → `car-workshop-backend`, or a terminal) and
  how the frontend is served (nginx serving the built files — usually
  `/var/www/car-workshop/frontend/` — or a Vite dev server). It is the same as
  for the 2 Nov deploy.

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

The message must start with **"Client feedback (2 Nov)"**. If it doesn't, stop —
the fixes have not been pushed yet; ask the user.

## 3. Build and publish the frontend

**If nginx serves the built files** (the usual setup):

```bash
cd car-workshop-frontend
npm run build
sudo cp -r dist/. /var/www/car-workshop/frontend/
cd ..
```

Use the nginx root found in step 0 if it is not `/var/www/car-workshop/frontend/`.

**If the frontend runs with the Vite dev server** instead: no build is needed —
restart that `npm run dev` process.

## 4. Restart the API

**With pm2:**

```bash
pm2 restart car-workshop-backend
pm2 logs car-workshop-backend --lines 30
```

The log must show `listening on port …` and no errors.

**If the API runs in a terminal** (`npm run dev` / `node src/server.js`): stop it
(Ctrl-C) and start it again the same way.

## 5. Quick test (with the user's real staff logins — don't create test accounts)

Everyone reloads the app once (Ctrl+Shift+R, or Cmd+Shift+R on a Mac) so the
browser picks up the new build. No sign-out is needed — no permissions changed.

1. Work Orders → **New Work Order** → External → pick a customer → click
   **Internal Customer**, then **External Customer** again: the customer and
   their details are still selected.
2. **Next** → pick a car that is missing its emirate, VIN, plate number or year:
   the Vehicle page shows **"Complete this vehicle's details"** with those
   fields. Opening **Edit** on a work order whose car lacks details shows the
   same box. Only enter real values — they are saved onto the car.
3. Type an odometer reading **lower** than the "Last recorded" one: it is
   refused ("The reading is lower than the car's previous reading…") — for a
   Workshop Manager too, with **no checkbox**.
4. Edit a work order and save: the message says **"Work order updated"**.

Cancel any test work order you create (Work Orders → the job → Cancel), or use a
real job the user names.

## 6. Report back to the user

A short report: the backup file name, the commit deployed (`git log --oneline -1`),
how the frontend and API were restarted, the quick-test results, and anything
that failed.

---

## If something goes wrong (rollback)

No database changes, so going back is a code-only step:

```bash
git checkout 2e1d62c
cd car-workshop-frontend && npm run build && sudo cp -r dist/. /var/www/car-workshop/frontend/ && cd ..
pm2 restart car-workshop-backend
```

(Or restart the dev servers the way they run on this machine.)

---

## What changed in this update (for the user)

- **Odometer:** a reading lower than the car's previous one is refused for
  everyone, managers included — the manager checkbox is gone (work order form
  and physical inspection).
- **Vehicle page of the work order:** one box to complete whatever the selected
  car is missing — plate number, emirate, year and VIN required (make and model
  too when the car has none); plate code, vehicle type, colour, engine number
  and unit code optional. It appears on new **and** edited work orders, and the
  details are saved onto the car, so each is asked for only once.
- **Customer page:** switching the customer type (or the Fleet / Insurance /
  Walk-in filter, or New / Existing) no longer loses the chosen customer;
  switching back brings them back, with the car and reading picked for them.
- **Wording:** the Fleet Intake button says **"Create work order"** (was "Create
  job card"); after an edit the message says "Work order updated".
