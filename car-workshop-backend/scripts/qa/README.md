# QA suites (local only)

End-to-end checks that drive the running API with real role logins. Each
suite refuses to run unless `DB_HOST` in `.env` is `localhost`/`127.0.0.1`,
creates its own throwaway users and records, and on exit deletes every row
it created (per-table `MAX(id)` baseline). Never point them at a shared or
production database.

**Run one suite at a time, and not while anyone is entering data in the app.**
The clean-up deletes every row above the baseline in every table, so two
suites at once (or a person creating a job card during a run) lose each
other's rows. `technician-app-test` stops its clean-up and lists the rows
when someone else wrote to its tables meanwhile.

Start the backend (`npm run dev`, port 4000), then from `car-workshop-backend/`:

```bash
node scripts/qa/workflow-test.mjs         # Steps 1–7 end to end; customer messages only at opened / ready for collection / closed / cancelled; estimate approved onto the visit already in (65 checks)
node scripts/qa/intake-test.mjs           # New Job Card intake (Steps 1–3; odometer and VIN optional), the technician's view through My Jobs, who may change a status (47)
node scripts/qa/jobcard-regression.mjs    # job card billing / approvals; QC only through the QC endpoint (43)
node scripts/qa/security-test.mjs         # role and access rules; technician token tools, start-trip, proof scope, retired courier API, Service Advisor status via token, Storekeeper earnings writes, old status link 410 and public status whitelist (44)
node scripts/qa/technician-app-test.mjs   # technician app: access (S4), one clock (S11), pause reasons, scan lookup, finished jobs (45)
node scripts/qa/vehicle-board-test.mjs    # Vehicle Status Board: access, tiles, phase at every step, search, imported-job cut-off (first job card), declined estimate (50)
node scripts/qa/customer-status-test.mjs  # customer status link + customer portal (/customer/*): whitelist, stages, portal access, sign-in, own jobs only, inspection sign-off (signed_via 'portal'), estimate (54)
node scripts/qa/api-v1-test.mjs           # integration API (12)
node scripts/qa/crm-cycle-test.mjs        # CRM cycle: lead → quote → book → visit → after → service due (28)
```

Set-password, reset-password and verify-email links share one limiter per IP
(5 failed tries an hour; successful ones are not counted). Each full pass of
`security-test` and `customer-status-test` spends one failed try each, so more
than two full passes within an hour, without a backend restart, ends in 429.

The counts are the number of PASS/FAIL lines each suite prints. Each suite
ends with `N passed, M failed`: read that line, because the exit code is 0
either way.

What each newer suite needs on the server (`src/server.js`):

- `vehicle-board-test` — `/api/vehicle-board` mounted. `QA_API` overrides the
  API base (default `http://localhost:4000/api`).
- `customer-status-test` — `/api/public/service-status` mounted **before**
  `/api/public`.
- `technician-app-test` — the `20261018_technician_pause_reason.sql` migration
  applied (pause reason and note columns).

Run them from `car-workshop-backend/` so the backend modules they import pick
up `.env`.
