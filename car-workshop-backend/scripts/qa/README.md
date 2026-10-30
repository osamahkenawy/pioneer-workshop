# QA suites (local only)

End-to-end checks that drive the running API with real role logins. Each
suite refuses to run unless `DB_HOST` in `.env` is `localhost`/`127.0.0.1`,
creates its own throwaway users and records, and on exit deletes every row
it created (per-table `MAX(id)` baseline) — except in the `roles` table,
which is never cleaned by id (the seeded and demo roles live there; a suite
that adds a role removes it by slug). The signature images, vehicle photos
and paper forms of the inspections a suite made are deleted with them. Never
point them at a shared or production database.

**Run one suite at a time, and not while anyone is entering data in the app.**
The clean-up deletes every row above the baseline in every table, so two
suites at once (or a person creating a job card during a run) lose each
other's rows. `technician-app-test` and `jobcard-regression` stop their
clean-up and list the rows when someone else wrote to their tables meanwhile.

**The API base.** Every suite calls the API at `QA_API`, default
`http://localhost:4000/api`. Set it to wherever this backend listens — on a
machine where port 4000 belongs to another app, start the backend on its own
port and pass that, e.g. `QA_API=http://localhost:4100/api`. The database is
always the one in `car-workshop-backend/.env`, so `QA_API` must be the
backend that uses it.

Start the backend (`npm run dev`), then from `car-workshop-backend/`:

```bash
export QA_API=http://localhost:4100/api   # or prefix each command; default http://localhost:4000/api
node scripts/qa/workflow-test.mjs         # Steps 1–7 end to end: the physical inspection signed at the car opens the job card (estimate 409 before), manager override with a reason, parts categories (preference, Used, expected delivery, an alternative only with the customer's choice, no fallback), customer messages, roles (85 checks)
node scripts/qa/intake-test.mjs           # New Job Card intake (Steps 1–3; odometer and VIN optional), acknowledgement from the link and on the paper form, an external job approved before its inspection (no assigning, no work), the technician's view, who may change a status, the fleet link (work order on submission, Book in reuses it) (61)
node scripts/qa/jobcard-regression.mjs    # job card billing / approvals; QC only through the QC endpoint; no job card, technician or work on an external job before the acknowledgement (46)
node scripts/qa/security-test.mjs         # role and access rules; technician token tools, start-trip, proof scope, retired courier API, Service Advisor status via token, Storekeeper earnings writes, old status link 410, public status whitelist, physical inspection / job card override (45)
node scripts/qa/technician-app-test.mjs   # technician app: access (S4), one clock (S11), pause reasons, scan lookup, finished jobs (45)
node scripts/qa/vehicle-board-test.mjs    # Vehicle Status Board: access, tiles, phase at every step (Reception through the physical inspection), search, imported-job cut-off (first job card), approved before the inspection, declined estimate (56)
node scripts/qa/customer-status-test.mjs  # customer status link + customer portal (/customer/*): whitelist, stages ("Vehicle received" until the acknowledgement), portal access, sign-in, own jobs only, inspection photos, inspection sign-off in the portal opens the job card, estimate (58)
node scripts/qa/api-v1-test.mjs           # integration API: work orders (job card rule), enquiries → work order (14)
node scripts/qa/crm-cycle-test.mjs        # CRM cycle: every enquiry gets its work order (staff, website, reminder reply), quote → the same work order, book → check-in on it, lost / rejected → cancelled, convert reuses it, "Vehicle received" for the customer until the acknowledgement, after → service due (38)
```

The job card rule the suites follow (client, 2026-10-29): an external
customer's main job card opens when they acknowledge the physical inspection
— signed at the car, from the link, in the portal, or the paper form — or
when a manager opens it with a reason; an internal customer's opens with the
work order. Each suite that needs a job card on an external job does the
physical inspection first.

Set-password, reset-password and verify-email links share one limiter per IP
(5 failed tries an hour; successful ones are not counted). Each full pass of
`security-test` and `customer-status-test` spends one failed try each, so more
than two full passes within an hour, without a backend restart, ends in 429.

The counts are the number of PASS/FAIL lines each suite prints. Each suite
ends with `N passed, M failed`: read that line, because the exit code is 0
either way.

What each newer suite needs on the server (`src/server.js`):

- `vehicle-board-test` — `/api/vehicle-board` mounted.
- `customer-status-test` — `/api/public/service-status` mounted **before**
  `/api/public`.
- `technician-app-test` — the `20261018_technician_pause_reason.sql` migration
  applied (pause reason and note columns).
- every suite — the 2026-10-29 migrations applied
  (`20261029_enquiry_work_order.sql`, `20261029_parts_categories.sql`,
  `20261029_physical_inspection.sql`).

Run them from `car-workshop-backend/` so the backend modules they import pick
up `.env`.
