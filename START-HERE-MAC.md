# Start here — setting this up on the Mac

Everything needed to run Pioneer Car Service Center is in this folder, including
a dump of the working database. No GitHub access required to get running.

Read `HANDOVER.md` next — it covers what the project is, what was built, and the
traps. This file is only about getting it running on macOS.

> **This folder contains live secrets.** `car-workshop-backend/.env` and
> `deploy/backend.staging.env` hold real JWT secrets and database passwords, and
> `reference-data/` holds real customer data. Move it by AirDrop, cable or an
> encrypted drive. Do not put it in a shared cloud folder, and do not commit
> those files — the `.gitignore` files already exclude them.

---

## 1. Prerequisites

```bash
# Homebrew, if you don't have it
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

brew install node@22 mysql@8.4
brew services start mysql@8.4
```

Node **22** is what the frontend pins (`.nvmrc`). If you use nvm instead:

```bash
nvm install 22 && nvm use 22
```

---

## 2. Restore the database

The dump is MySQL 8.4, 111 tables, with the real working data — 18,730 work
orders, 5,944 vehicles, 3,472 customers, 17,096 invoices.

```bash
cd pioneer-workshop-mac
mysql -u root -p -e "CREATE DATABASE IF NOT EXISTS car_workshop CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
gunzip -c database/car_workshop.sql.gz | mysql -u root -p car_workshop
```

Check it landed:

```bash
mysql -u root -p car_workshop -e "SELECT COUNT(*) FROM work_orders"   # expect 18730
```

Every migration up to `20260917_work_order_intake_redesign.sql` is **already
applied** in this dump. You do not need to run any of them. They are kept in
`car-workshop-backend/src/migrations/` for reference and for deploying to
staging.

---

## 3. Point the backend at your local MySQL

`car-workshop-backend/.env` came across as-is, so everything is configured
except the database password, which is whatever you set on the Mac:

```bash
cd car-workshop-backend
# edit .env and set DB_PASSWORD to your local MySQL root password
```

`DB_HOST=localhost`, `DB_PORT=3306`, `DB_USER=root`, `DB_NAME=car_workshop` are
already right. Unconfigured integrations (SMTP, Twilio, S3, Stripe, Firebase)
degrade gracefully — email logs to the console instead of sending, uploads fall
back to local disk. You do not need to fill those in to develop.

---

## 4. Install and run

Two terminals:

```bash
cd car-workshop-backend && npm install && npm run dev     # port 4000
```

```bash
cd car-workshop-frontend && npm install && npm run dev    # port 5173
```

`node_modules` was deliberately left out of this folder — it is platform-specific
and would not have worked on macOS anyway. `npm install` rebuilds it.

Open http://localhost:5173.

### Confirming it is wired up

```bash
curl -i http://localhost:5173/api/customers
```

**401 is the correct answer.** It means Vite's proxy reached the API on port
4000 and the API properly rejected an unauthenticated request. A connection
error means the backend is not running; a 404 means the proxy is misconfigured.

---

## 5. Git

This folder is one git repository containing everything:

```bash
git clone https://github.com/osamahkenawy/pioneer-workshop.git
```

You will need to authenticate once on the Mac — the simplest route:

```bash
brew install gh && gh auth login
```

Two older repos, `car-workshop-backend` and `car-workshop-frontend`, hold the
commit history up to this handover. They are archives; work continues in this
monorepo. Pick one and stay with it rather than letting the two drift.

### Line endings

Source files are **LF on disk** already, so nothing needs converting. The
Windows machine had `core.autocrlf=true`; on the Mac leave it unset or `input`:

```bash
git config --global core.autocrlf input
```

---

## 6. What is in this folder

```
pioneer-workshop/
├── START-HERE-MAC.md        ← this file
├── HANDOVER.md              ← read this second: the project, the state, the traps
├── car-workshop-backend/    ← Express + MySQL API
├── car-workshop-frontend/   ← React + Vite client
├── database/
│   └── car_workshop.sql.gz  ← full dump, 111 tables, real data
├── docs/
│   ├── roadmap/             ← ROADMAP-EXEC.html is the current one
│   ├── process/             ← diagrams, and the source work-order PDF
│   ├── plans/               ← team leader plan, architecture, code review
│   ├── reports/             ← KPI, CX survey, complaints
│   └── brand/
├── deploy/                  ← scripts, nginx, staging env example
└── reference-data/          ← legacy-system CSV extracts, ~21 MB
```

Deliberately **not** in the repository: `node_modules/` (reinstall), `dist/`
(rebuild), and the two secret files named in section 3.

---

## 7. First thing worth doing

From `HANDOVER.md` section 8, confirmed by reading the code: the estimate
pipeline's backend is complete and correct, but **has no staff screen**. Nothing
in the frontend calls `GET /estimates`, there is no Estimates page or nav item,
and `POST /:id/convert-to-work-order` is never called from the UI at all. Staff
cannot see an estimate's status or convert an approved one into a job card.

That screen is the highest-value next piece of work.
