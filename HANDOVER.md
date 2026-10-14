# Pioneer Car Service Center — Handover

**Written 5 October 2026.** Everything needed to pick this up on another machine.
If you are an assistant reading this cold: read this file top to bottom before
touching anything. Section 7 is the part people get wrong.

---

## 1. What this is

A multi-branch car workshop management platform for Pioneer Car Service Center
(Abu Dhabi, Sharjah, Dubai, Al Ain), built for Mwasalat.

- **Backend** — Node 18+ / Express (ES modules) / MySQL via `mysql2/promise`.
  No ORM; raw SQL through a connection pool. JWT auth, Socket.IO, Nodemailer.
- **Frontend** — React 18 + Vite, lazy routes, i18next across **12 locales**
  (en, ar, es, fr, hi, ja, pt, sw, tl, tr, ur, zh).
- **Staging** — `ubuntu@130.61.83.110`, served at `workshop.pioneeruae.com`.

The backend was **ported from a delivery-service SaaS**. That matters more than
it sounds — see section 7.

---

## 2. Folder layout

One repository holds everything — code, documents, deployment and a dump of the
working database.

```
pioneer-workshop/
├── HANDOVER.md                     ← you are here
├── START-HERE-MAC.md               ← macOS setup, step by step
├── car-workshop-backend/           ← Express + MySQL API
├── car-workshop-frontend/          ← React + Vite client
├── database/
│   └── car_workshop.sql.gz         ← full dump, 111 tables, real data
├── docs/
│   ├── roadmap/                    ← ROADMAP-EXEC.html (current), roadmap PDFs
│   ├── process/                    ← diagrams, the source work-order PDF
│   ├── plans/                      ← team leader plan, architecture, code review
│   ├── reports/                    ← KPI, CX survey, complaints workbooks
│   └── brand/                      ← logo
├── deploy/                         ← deployment scripts and nginx config
├── reference-data/                 ← CSV extracts from the legacy system, ~21 MB
└── .claude/launch.json             ← dev server definitions
```

Not in the repo: `node_modules/` and `dist/` (rebuild them), and the two files
holding real secrets — see section 4.

---

## 3. Running it

Two services. From this folder:

```bash
cd car-workshop-backend && npm install && npm run dev    # port 4000
cd car-workshop-frontend && npm install && npm run dev   # port 5173
```

Vite proxies `/api`, `/uploads` and `/socket.io` to `localhost:4000`
(`vite.config.js:11`), so the frontend needs no `VITE_API_URL` in development.

**Verifying the wiring:** `curl http://localhost:5173/api/customers` should
return **401**, not a connection error. 401 means the proxy reached the API and
the API correctly rejected an unauthenticated request. That is the healthy
answer.

### Database

MySQL, database `car_workshop`. First-time setup is in
`car-workshop-backend/README.md`. There is **no migration runner** — migrations
are applied by hand, in filename order:

```bash
mysql -u root -p car_workshop < src/migrations/<file>.sql
```

Every migration is written to be **idempotent**: each guards on
`information_schema` and uses `PREPARE`/`EXECUTE`/`DEALLOCATE`, so re-running
one is safe. Keep writing them that way.

Migrations that must be applied on a fresh machine (all added in the last
stretches of work). The step-by-step deploy guide is `docs/DEPLOY_2026-10-14.md`:

| File | What it does |
|---|---|
| `20260914_estimate_approval_token.sql` | Tokenised customer approve/reject link |
| `20260914_team_leader_and_time_booking.sql` | Team leader structure, time bookings |
| `20260914_work_order_status_rename_widen.sql` | Widens the status enum (expand half only — see 7) |
| `20260917_work_order_intake_redesign.sql` | Customer class, vehicle identity, odometer, fleet intake tables |
| `20261006_job_card_billing.sql` | `work_orders.billing_basis` (existing rows `service_fee`, new rows `itemised`), item type + estimate line on `work_order_items`, decimal quantities. **Not in the database dump — apply it.** |
| `20261008_job_card_approvals.sql` | Customer approval on job cards (`work_orders.customer_approved_*`), supervisor/manager sign-off on estimates (`service_estimates.internal_approved_*`), widens `work_order_status_logs.status`. **Not in the dump — apply after the one above.** |
| `20261011_invoice_number_unique.sql` | Unique `(workshop_id, invoice_number)` on `invoices`, so two invoices raised at the same moment can no longer get the same number. Check for existing duplicates first (`SELECT invoice_number, COUNT(*) FROM invoices GROUP BY workshop_id, invoice_number HAVING COUNT(*) > 1`) — the index will not build while any exist. **Not in the dump.** |
| `20261012_workshop_workflow.sql` | Workflow Steps 1–7: sub-job cards and job card technician (`job_cards.parent_job_card_id/title/mechanic_id`, one main job card per work order), `work_order_items.job_card_id`, time-booking Pause (`technician_time_logs.end_reason`), Store availability + expected date (`material_requisition_items.availability/expected_date/eta_alerted_at`), Genuine/After-Market pricing (`estimate_lines.job_name/genuine_*/aftermarket_*/part_option`), estimate ↔ visit (`service_estimates.intake_work_order_id/estimate_format`), pickup contact log (`work_order_contacts`), Storekeeper role. **Not in the dump.** |
| `20261013_roles_workflow.sql` | `roles.capabilities` (workflow responsibilities per role, NULL = process defaults); own menu keys for Estimates / Fleet Intake / Team Board / Store added to the roles that should see them (additive); clearer descriptions for the seeded roles. **Not in the dump.** |
| `20261014_crm_cycle.sql` | The customer cycle joined up: `service_estimates.enquiry_id` (a quote raised from an enquiry), `appointments.enquiry_id` / `estimate_id` (a booking made from either), `enquiries.contact_method` gains `reminder` and `referral`, and a Bookings menu key (`appointments`) for Service Advisor / Workshop Manager / General Manager. **Not in the dump.** |
| `20261015_intake_integrity.sql` | Step 1 classification kept on the job (`work_orders.intake_customer_class/subcategory`), backfilled from the customer. **Not in the dump.** |
| `20261016_inspection_documents.sql` | Intake inspection filled on screen **or** uploaded as the paper form (`vehicle_inspections.entry_mode`, `documents`). Files go to `private-uploads/inspections` (not in git — back it up). **Not in the dump.** |
| `20261017_inspection_share_sign.sql` | Customer sign-off + customer link on inspections (`share_token`, `shared_at/via`, `customer_present`, `signed_by_name`, `signed_at`, `signed_via`). **Not in the dump.** |
| `20261018_customer_portal_invite.sql` | "Give portal access" (`customers.portal_invited_at/by`). **Not in the dump.** |
| `20261018_pregenerated_barcode_width.sql` | `pregenerated_tokens.barcode_value` → VARCHAR(64) for the 128-bit status tokens. **Not in the dump.** |
| `20261018_technician_pause_reason.sql` | Technician app: pause reason + note on time logs, `technician_lookup` scan type. **Not in the dump.** |
| `20261019_inspection_signed_via_portal.sql` | `signed_via` gains `portal` (customer signed in the portal). **Not in the dump.** |
| `20261019_workshop_manager_settings.sql` | Workshop Manager role gets the Settings menu (Users / Roles). **Not in the dump.** |

---

## 4. GitHub

Everything lives in one private repository:

```bash
git clone https://github.com/osamahkenawy/pioneer-workshop.git
```

The code also exists in two older repos, `car-workshop-backend` and
`car-workshop-frontend`, which carry the full commit history up to this
handover. They are **archives** — this monorepo is where work continues. If you
ever need the history of a file, it is there.

> Because the code now exists in two places, pick one and stay with it. If
> staging still deploys from the old repos, either repoint it at this one or
> keep pushing to both deliberately.

### Secrets — read this before anything else

Two files hold live secrets and are **deliberately not in this repository**:

| File | Holds |
|---|---|
| `car-workshop-backend/.env` | `JWT_SECRET`, local DB password, integration keys |
| `deploy/backend.staging.env` | staging `JWT_SECRET` and DB password |

Get them from the transfer archive `pioneer-workshop-mac.tar.gz`, or rebuild
them from `.env.example` and `deploy/backend.staging.env.example`, which carry
every key name with no values. **Do not commit either file** — `.gitignore`
already excludes them, so keep it that way.

**Known issue:** live GitHub personal access tokens were found in plaintext git
remote URLs on the staging host. They have not been rotated. Do that before
anyone else gets access to that server.

**Also rotate:** the staging database password and JWT secret were committed in
`deploy/DEPLOY-RHEL-STEPS.txt`, `deploy/deploy*.sh` and a review document under
`docs/plans/`. Those files now carry placeholders, but the old values are still
in git history and on GitHub, so treat them as public: change the MySQL
password and `JWT_SECRET` on staging (changing `JWT_SECRET` logs everyone out).

### Switches that are off unless you turn them on

| Env var | What it enables |
|---|---|
| `ALLOW_PUBLIC_SIGNUP=true` | Anonymous workshop signup (`/api/workshops/register`, `/api/public/start-trial`, `/api/public/signup`, licence activation). Each creates a new tenant plus an admin login; Pioneer is one workshop, so they return 404 by default. |
| `ENABLE_DATA_RETENTION=true` | Daily job that **deletes work orders older than the plan's retention period** (30 days on trial/starter). Leave off unless the client asks for it. |
| `ENABLE_ACCEPTANCE_TIMEOUT=true` | Every 5 minutes, un-assigns work orders left in `assigned` past `order_accept_timeout_minutes` (default 30) and returns them to pending. |
| `ENABLE_TRIAL_ENFORCER=true` | SaaS trial expiry: marks the workshop `trial_expired`, then suspends it 7 days later. |

Access rules live in `car-workshop-backend/src/lib/access.js`: customer-portal
and mechanic logins are limited to the routes their own screens use; user,
role and workshop-settings changes and deletes need a manager.

### Customer data is in this repo

`database/car_workshop.sql.gz` and `reference-data/` hold **real customer
records** — names, phone numbers, plates, invoices. That is a deliberate choice
so the project clones and runs in one step, and it is why the repository is
**private**. Keep it private, and think before adding collaborators.

---

## 5. What was built most recently

Six commits, three per repo, all pushed. In dependency order:

**Backend**
1. `2971497` — Work order intake redesign. Customer class (internal: fleet/asset,
   external: insurance/walk-in), vehicle identity fields (plate code, plate
   emirate, engine number, fleet code), and VIN + odometer + complaint made
   mandatory at intake.
2. `c6bc857` — **The estimate pricing fix.** Detail in section 6.
3. `e6eb53b` — Team leader board and fleet coordinator intake page.

**Frontend**
1. `c6769b4` — New job card form rebuilt as a five-step wizard.
2. `101f09b` — Estimate screens: build an estimate, customer approval page.
3. `83074a7` — Team leader board, fleet intake form and staff queue, 12 locales.

### The five-step wizard

`src/components/NewWorkOrderModal.jsx`. Steps: Customer → Vehicle → Complaint
and service → Estimate and charges → Assign and review. 1020px wide, two-column,
stacks below 900px.

Two things worth knowing before editing it:

- `customerMode` is **derived**, not stored: it is a function of customer class
  and the external option. Do not reintroduce it as state — that is exactly how
  the two got to disagree before.
- All borders are written **longhand** (`borderStyle`/`borderWidth`/`borderColor`).
  Mixing the `border` shorthand with `borderColor` on the same element makes
  React warn on every re-render. Keep longhand.

### Fleet coordinator intake

The vehicle information section of the work order, on its own page, opened from
a tokenised link with no login, so a fleet coordinator can fill it in before the
vehicle arrives. Staff review submissions in a queue that shows what the
coordinator entered against what the system already knows.

`POST /fleet-intake/:id/convert` contains **the first database transaction in
this codebase** (`pool.getConnection()` → `beginTransaction`). A half-converted
submission would leave an orphan vehicle with no work order, which is why.
If you add multi-table writes elsewhere, copy this pattern.

---

## 5a. Workshop workflow, Steps 1–7

Source: `Pioneer_Complete_Workshop_Workflow_Steps_1_to_7.pdf` (client). Every
job card screen now shows a 7-step panel (where the job stands, what is next
and whose job it is, and the actions for each step).

**Model.** The *work order* (WO-…) is the vehicle's visit. Work is done on
*job cards* (JC-…): one **main job card** per work order, opened automatically
when the work order is created (Step 3 — every intake path: advisor form,
fleet link, enquiry, customer portal, API), plus **sub-job cards** for part of
the approved work (Step 6). Time booking, parts requisitions, the quality
check and the gate pass hang off job cards. The `job_cards` family of tables
existed from the SOW but nothing created a row until now.

| Where | What |
|---|---|
| `backend/src/lib/workflow.js` | Role groups + notifications, `ensureMainJobCard`, `buildWorkflow` (the 7-step state), Genuine/After-Market totals |
| `backend/src/lib/workflow-sync.js` | Moves the work order with its job cards (work started → in_progress; all done → inspection; all QC passed → ready_for_pickup, shown as "Ready for collection", + "Ready for collection: WO…" to the Service Advisor; QC failed → back to in_progress) |
| `backend/src/routes/workflow.js` | `/api/workflow/*` — workflow view, sub-job cards, Store availability, pickup contacts, gate pass, close |
| `backend/src/routes/job-cards.js` | Technician side: `/time/start|pause|stop`, `/done`, `/qc`, `/requisitions`, `/mine` |
| `backend/src/routes/estimates.js` | Storekeeper pricing `PATCH /:id/lines/:lineId/pricing`, send with `format` + `channel` (email/whatsapp), approval lands on the visit's own work order |
| `backend/src/lib/parts-eta-alerts.js` | Hourly: alerts the floor 24 h before a part's expected date |
| `frontend/src/components/workflow/JobCardWorkflow.jsx` | The 7-step panel on the job card page |

**Gates now enforced** (imported legacy work orders have no job cards and are
not affected): no work before the customer agrees; a technician books time
only on job cards assigned to them; "ready for pickup" needs every job card's
quality check passed; the gate pass needs the QC and the
payment (paid invoice — or, for internal / fleet / insurance / corporate
customers billed on account, an issued invoice); closing needs the gate pass.
Parts are priced only by the Storekeeper (or a manager), labour only by the
Service Advisor (or a manager); an estimate cannot be sent with unpriced lines.

**Quality check (client, 2026-10-12)** has exactly three points:
1. Vehicle issue has been repaired correctly (OK / Not OK, required),
2. Test drive (OK / Not OK, required),
3. Any other issues or comments (free text — required when the check fails,
   so the Team Leader knows what to rework).
The list lives in `QC_CHECKLIST` (`backend/src/lib/workflow.js`).

**Interpretations to confirm with the client** (the PDF leaves them open):
- *Format 1 / 2 / 3* are named but not defined. Implemented as Format 1 =
  Genuine only, Format 2 = After-Market only, Format 3 = both side by side,
  the customer choosing per part on the approval page.
- *WO vs JC* ("to confirm" in the PDF): WO = the visit, JC = the job card(s)
  for the work, as above.
- *Failed quality check*: the PDF only says notify the Team Leader /
  Supervisor. Implemented as: job card back to rework, the technician resumes
  time booking, marks it done again, QC again.
- *Customer collection*: the automatic "ready for collection" SMS/email still
  goes out, but the step completes only when staff log a call/WhatsApp/email
  to arrange collection.
- *Internal accounts*: QIC, AWNIC, Dubai Insurance and Aman Taxi SHJ are not
  in the customer list; create them and classify them (Step 1 on the job
  card, or the Customers screen). "AWNIC" is the PDF's best-effort reading.

**Roles — who does what** (`backend/src/lib/roles.js`, enforced by the API,
shown in Settings → Roles, and the job card screen only shows a person their
own actions; the dashboard has a "Your tasks" list per role):

| Step | Responsibility | Roles (managers can do everything) |
|---|---|---|
| 2 | Open job cards, record vehicle & issue | Service Advisor, Supervisor |
| 4 | Raise / send estimates, price labour | Service Advisor |
| 5 | Price parts — Genuine / After-Market / N/A | Storekeeper, Part Advisor |
| 5 | Approve estimates for external customers | Supervisor |
| 6 | Record the customer's decision | Service Advisor |
| 6 | Assign technicians, sub-job cards | Team Leader, Supervisor, Foreman |
| 6 | Time booking, mark job done | Technician (own job cards), Team Leader, Supervisor, Foreman |
| 6 | Material requisitions | Technician, Team Leader, Supervisor, Foreman, Service Advisor |
| 6 | Check the shelf, issue parts, expected dates | Storekeeper, Part Advisor |
| 7 | Quality check & test drive | Supervisor, Foreman, Team Leader |
| 7 | Collection call, payment, gate pass, close | Service Advisor |

A role's responsibilities can be changed (or a custom role such as "Cashier"
given some) in Settings → Roles → edit → *Workflow responsibilities*; "Reset to
the process defaults" goes back to this table. Accounts without an assigned
role keep working: legacy `dispatcher` acts as Service Advisor, `admin` /
owner as manager. Give users the right role in Settings → Users, or the
notifications have nobody to reach.

**Tests.** `car-workshop-backend/scripts/qa/` (see its README for every suite
and its check count): `workflow-test` walks a job through all 7 steps with
real role logins, including the PDF's own numbers (AC Compressor: Genuine 600 /
After-Market 400); intake, job card, security, technician app, Vehicle Status
Board, customer status/portal, integration API and CRM cycle suites sit next
to it. Run them one at a time.

## 5b. The customer cycle (CRM)

The cycle the client drew — **Acquire** (lead arrives → know the car → follow
up), **Convert** (quote → book), **Deliver** (visit = the job card, §5a),
**Retain** (after the visit → service due), repeating for the life of the car —
is joined up end to end. `lib/crm-cycle.js` holds the hand-offs.

| Stage | Where | What happens automatically |
|---|---|---|
| Lead arrives | Enquiries (staff), website form (`POST /api/public/enquiries`), integration API | Channel recorded; a **call-back task** (due in 2 h) lands in Tasks & Follow-ups. Phone *or* e-mail is enough. |
| Know the car | Enquiry plate + vehicle fields | On Quote/Book the customer on file with the same phone/e-mail is reused (no duplicates) and the car is matched by plate or created. |
| Follow up | Tasks & Follow-ups | Call-back closes when quoted; "Not converted" with a re-offer date opens a **re-offer task** on that date; each task links back to its enquiry / estimate / job card. |
| Quote | Enquiries → **Quote** → estimate form pre-filled | Enquiry → *quoted* with the amount; after sending, a **48-hour chase task**; customer approves → job card (with the enquiry, phone and e-mail on it) and the enquiry → *converted*; rejects all → enquiry *lost* (price). |
| Book | **Bookings** page (`/appointments`), Book buttons on Enquiries and approved estimates | Free slots per bay; one live booking per enquiry/quote; **Check in** opens (or reuses) the job card and converts the enquiry. Service Advisor / Supervisor / managers book (`job.open`). |
| Visit | Job card workflow (§5a) | Opening a job card for a car marks its open service reminders *booked*. |
| After the visit | On close | Invoice, **48-hour follow-up call task**, satisfaction survey (if switched on), and a low score / unresolved job opens an **urgent complaint task**. |
| Service due | Service Reminders | Closing a job puts the car's **next service** on the list (from the category's interval and the gate-pass odometer); the daily engine also scans for due cars. |
| Loop | Service Reminders → **Replied → quote / book** | The reply becomes an enquiry (source: reminder) and goes straight to a quote or booking. |

The Enquiries page shows the funnel (enquiries → quoted → booked → job →
completed) next to conversion by channel; Customer 360's timeline now includes
estimates and bookings.

**Switched off / not wired yet — tell the client:**
- **Satisfaction survey** auto-send is off until turned on in Settings → Surveys,
  and it goes at closing (not after 48 h; the 48-hour call is the task).
- **SMS** needs a Twilio account. Without one a reminder is *not* marked sent —
  it stays due with the reason, so staff call or e-mail instead.
- **WhatsApp** reminders go out as SMS until a WhatsApp provider is connected;
  customers' replies are not read automatically (there is no inbound webhook),
  so staff press *Replied → quote*.
- The daily reminder engine runs only when `DISABLE_CRON_JOBS` is not `true`
  (it is `true` in the local `.env`).

Also fixed on the way: closing or readying a job from the QR status screen now
follows the job card rules (quality check, gate pass) instead of a bare status
write, and cancelling a job cancels its open job cards and stops running time.

---

## 5c. Delivery-app clean-up: the workshop words, Team Board, technician app, board and portal

The app started life as a courier product. Its courier screens, words and
links ("ready for pickup", deliveries, drivers, tracking, /merchant) were
replaced in October 2026 so every role sees Steps 1–7. This is what to know
when you work on it.

**Vocabulary (labels only — no database value changed).** One helper on each
side: `frontend/src/lib/statusLabels.js` (`woLabel`, `jcLabel`,
`timeStateLabel`, `WO_FILTERS`) and `backend/src/lib/status-labels.js`. Use
them; do not write status words in a page.

| Stored `work_orders.status` | Staff sees | Customer sees |
|---|---|---|
| pending | Checked in | Vehicle received |
| confirmed | Inspected | Inspection & estimate |
| pending/confirmed + customer approved | Approved — to assign | Work approved |
| assigned, accepted | Technician assigned | Repair scheduled |
| in_progress | Work in progress | Repair in progress |
| inspection | Quality check | Final quality check |
| ready_for_pickup | **Ready for collection** | Ready for collection |
| completed | Closed | Completed / Collected |
| cancelled | Cancelled | Cancelled — contact us |

Technicians never see "Ready for collection"; their card says **QC passed**.
Keep the internal keys (`ready_for_pickup`, template `order_ready_for_pickup`,
capability `delivery.handover`). Customers hear from the workshop at four
moments only: job opened, ready for collection, closed, cancelled
(`lib/notify.js`). New strings use `t('key', 'English default')`; only
`en.json` was touched (values that still said pickup/delivery/mechanic) —
**the other 11 language files are not translated for these screens yet.**

**Team Board** (`/team-leader`, Team Leader / Supervisor / managers). Four
queues — To assign (Step 6 main job cards), Sub-job cards, Quality check,
Rework — counted on the server from the shared SQL in
`backend/src/lib/floor-queues.js` (the dashboard's "Your tasks" uses the same
fragments). Assigning checks the customer's approval. The team panel shows
each technician's day and has time controls for technicians without a phone.
One clock per technician: starting a second card answers
`409 CLOCK_RUNNING_ELSEWHERE`, and the board offers "pause the other and
start". Pauses carry a reason ("Paused · Waiting for parts").

**Technician app** (`users.role = 'mechanic'`, badge "TECHNICIAN"). A
technician only sees `/mechanic` (My Jobs), `/mechanic/jobs/:id` (one job
card: Start, Pause with a reason, Resume, Stop, Request parts, Job done),
`/mechanic/scan` and `/mechanic/history` (Finished jobs), plus the vehicle
inspection page. Any other address sends them to My Jobs
(`components/Protected.jsx`); their notifications open the job card
(`notifyMechanic` in `lib/workflow.js`, and the bell rewrites older links). No
prices, no customer name or phone, no GPS. **Scan** reads the job sheet: the
QR (the customer status link) or the job card number's Code-128, through the
browser's `BarcodeDetector` or ZXing; plate, VIN, WO or JC number can be typed.
Camera scanning still needs a check on a real iPhone and Android phone. API:
`/api/job-cards/mine…` (`routes/job-cards.js`); suite `technician-app-test`.

**Vehicle Status Board** (`/vehicle-board`, menu module `service-status`;
`/service-tracking` redirects here). Where every car is and who it waits on:
Reception · Inspection & pricing · With customer · In work · Quality check ·
Ready for collection · Closed today. Read-only; the side panel opens the job
card or sends the customer their status link. One SQL statement
(`routes/vehicle-board.js`, rules in `lib/job-phase.js`). Open jobs with no
job card that were opened before the workshop's first job card are old imports
(`isLegacyJob`): hidden by default (about 1,030 locally) and shown with "Show
imported jobs" (`include_legacy=1`); a job opened since whose job card failed
to open still shows, badged "No job card". **Client decision pending:** the
late limits (`LATE_MINUTES`). Storekeeper and Part Advisor roles do not have
the module and see "Not available for your role".

**Customer status link** `/service-status/:token` (old `/track/:token` too):
the seven customer stages from `GET /api/public/service-status/:token`
(`lib/customer-status.js`), a whitelist with no staff names, phones, notes or
payment details. It is the QR on the job sheet.

**Customer portal — `/customer/*`.** Sign-in `/customer/login` (e-mail or
mobile), Home `/customer/dashboard`, My job cards `/customer/jobs`, My
vehicles, Invoices & payments, Settings; `register`, `reset-password`,
`set-password` and `verify-email` under `/customer/` too. Paths come from
`pages/CustomerPortal/portalPaths.js` (front end) and `lib/portal-access.js`
`portalUrl()` (links in e-mails). Old `/merchant/*` and `/portal/*` links
redirect with their query string. Not to be confused with the staff pages
`/customers`, `/customer-feedback`, `/customer-experience`. A Service Advisor
gives access from the customer page (Customer 360 → *Customer portal* card:
WhatsApp, e-mail or copy a set-password link, valid 7 days). In the portal
the customer signs the intake inspection and opens the estimate to approve
(`/estimate-approval/:token`). The portal session (`crm_token`) is separate
from the staff session (`auth_token`); both can be open in one browser, and
each sign-in page says when the other is open.

**Inspection signature and share link.** The customer signs the intake (and
handover) inspection at the car on the staff screen, or later from a link:
`POST /api/vehicle-inspections/:id/share` (`whatsapp` | `email` | `link`)
makes `/inspection/:token`, where the customer reads the report and signs
(`POST /api/public/inspections/:token/sign`). `signed_via` records where:
`on_site`, `link` or `portal`. "New link" (`/share/reset`) retires the old
link and clears a link signature; a portal signature stays. Damage marks are
stored relative to the car picture (`coord: 'img'`), so they sit on the same
spot at every width, in print and on the customer's page.

**Routes and roles in one place:** `frontend/src/App.jsx` (route table) and
`components/Protected.jsx` (who may open what; `/` and unknown addresses go
to the signed-in person's home: staff `/dashboard`, technician `/mechanic`,
customer `/customer/dashboard`, nobody `/login`).

---

## 6. The estimate pricing bug (found, fixed, verified)

Worth understanding because the shape of it recurs elsewhere in this codebase.

`convertEstimateToWorkOrder` copied the **estimate header totals** onto the new
work order. Those totals are computed at create/update time over *every* line
regardless of `customer_status`, and approving or rejecting an individual line
writes back only `service_estimates.status`. So a partially approved estimate
produced a job card priced at the **full quote, including the lines the customer
had just rejected**. `POST /:id/convert-to-work-order` admits
`partially_approved` explicitly, so this was reachable by design.

It reached the customer: `work_orders.service_fee` becomes the invoice subtotal
when the job card is confirmed (`invoices.js:413`).

Underneath it, a larger one: `service_fee` was carrying **labour only**.
`createInvoiceFromWorkOrder` reads nothing but `service_fee`, so parts and sublet
were dropped from the invoice of *every* converted estimate — not just the
partially approved ones.

**Fixed** in `estimates.js`: the job card is now priced from the approved lines,
and `service_fee` carries the whole approved subtotal.

**Verified live** against a 945 estimate (labour 100, parts 500, parts 300) with
the 300 line rejected → job card `service_fee` 600, total 630, auto-invoice
subtotal 600. Before the fix the same estimate invoiced 100. All test data was
removed afterwards; `work_orders` is back to 18,730 rows.

> **The underlying design issue is still there.** `invoices.js:413` reading a
> single `service_fee` column as the entire subtotal is fragile — any future
> charge type that is not folded into `service_fee` will silently never be
> billed. I did not restructure it; that is a bigger change than the bug warranted.

---

## 7. Traps — the things that have already cost time

**The platform was renamed from a delivery service.** Columns and tables still
carry delivery-era names. An "empty page" or a 500 is very often a column that
was renamed on one side only. Check the actual schema before believing the code.

**`users.role` is a fixed enum that predates the `roles` table.** Roles added
since — `team_leader`, `quality_coordinator` — do **not** appear in it and can
only ever be identified by `roles.slug`. `authMiddleware` now exposes this as
`user.role_slug`. Use that, never `user.role`, for any role added recently.

**The status enum rename is half done.** `20260914_work_order_status_rename_widen.sql`
is the *expand* half of an expand/contract migration: old and new vocabularies
both validate right now. Roughly **167 call sites** still read the old names.
The contract half has not been done. Do not remove the old values until they have
all been migrated.

**`req.userId` is wrong in about 6 other backend route files.** Not fixed; it was
out of scope each time it came up. Worth a sweep.

**Line endings.** `core.autocrlf=true` on this machine, but backend and frontend
files are **LF on disk**. `sed -i` is safe here. Git will warn about LF→CRLF on
almost every file; that warning is expected and harmless.

**`GROUP BY` + aggregates.** Use an `EXISTS` subquery, not a `JOIN`, when
filtering a query that already groups — a join multiplies rows and silently
inflates the aggregates.

**iconoir-react does not have** `Building2`, `Hash`, `Gauge` or `AlertCircle`.
The substitutes in use are `Building`, `Barcode`, `DashboardSpeed`, `WarningCircle`.

**Killing a stuck backend on Windows.** `pkill` does not work. Use:

```bash
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 4000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"
```

I once spent a while debugging a fix that "didn't work" because the responding
server was the pre-edit instance.

---

## 8. Known gaps — confirmed, not speculation

### ~~The estimate pipeline has no staff screen~~ — resolved

Resolved in October 2026: the Estimates page (`/estimates`), the job card
workflow (§5a) and the CRM cycle (§5b) now cover listing, pricing, approval,
sending, decisions and conversion. The original note is kept below for history.

Verified by reading the code during this handover:

- The frontend makes exactly **four** estimate API calls: `POST /estimates`,
  `POST /estimates/:id/send`, and two from the public customer approval page.
- Nothing ever calls `GET /estimates`. There is no `Estimates.jsx` page, no nav
  item, no list.
- `NewEstimateModal` is opened from `WorkOrders.jsx` and **creates and sends in
  one go**. No job card exists at that point, so the estimate does not appear in
  the work orders list either.
- `POST /:id/convert-to-work-order` — the route the pricing fix above lives in —
  **is never called from the UI at all.**

So: the backend estimate pipeline is complete and correct, and staff currently
have no way to see an estimate's status, see which lines the customer approved,
or convert an approved estimate into a job card. **A staff Estimates list screen
is the single highest-value next piece of work.**

### Data shape constraints that drove design decisions

Do not "fix" these by adding `NOT NULL` — the numbers are why:

- **5,694 of 5,944 vehicles have no VIN.**
- **18,506 of 18,730 work orders have no description.**

VIN, odometer and complaint are therefore enforced **at the form and the API**,
not in the schema. A schema constraint would lock the existing fleet out of the
system. Importers pass `allow_missing_vin` / `bypass_intake_required` to keep
bulk loads working. The wizard lets an advisor fix a missing VIN inline.

- **278 technicians have no team leader assigned.** The team leader board works;
  the data behind it is largely unpopulated.

### Classification left deliberately incomplete

The intake migration classified 7 internal accounts by name (5 fleet, 2 asset)
and assigned codes FLT-001…005, AST-001/002. **Insurance matched zero accounts**
and was left empty rather than guessed. COLEMONT is a broker, not an insurer, and
PERFECT INSURANCE MATERIAL FIXING is not an insurance company — both were left
alone on purpose. Do not bulk-classify these by string match.

---

## 9. Open questions for the client

These were asked and never answered. They block correct implementation.

1. **The N/A fallback arithmetic.** A job line prices Labour plus one of two part
   types (Genuine, After Market). When Genuine is N/A — say Labour 100, After
   Market 400 — is the Genuine column total **500** (labour plus the fallback
   part), or does the column stay N/A? And what happens when **both** part types
   are N/A? Asked twice, still open. The estimation diagram in
   `docs/process/Pioneer-Estimation-Logic.pdf` shows the rule but not this edge.

2. **External customer subcategories.** The whiteboard and the mockup contradict
   each other on what the External subcategories are. Flagged rather than
   silently picked; still unresolved.

---

## 10. Roadmap

Current version: **`docs/roadmap/ROADMAP-EXEC.html`** — three phases.

| Phase | Theme | Status | Estimate |
|---|---|---|---|
| 1 | Control the job, and put Pioneer on the phone | Largely built | 6–7 weeks |
| 2 | Close the loop | Awaiting a decision | 6–7 weeks |
| 3 | Connect outward | Blocked externally | 7–8 weeks |

Total 19–22 weeks, landing Q1 2027. The Phase 1 mobile app is **promotional
only** — send a complaint, book an appointment, contact the workshop, view your
profile and job card status. No actions.

**Known inconsistencies in the roadmap documents** (recovered from an audit that
was never completed — treat as unverified leads, not findings):

- The Phase 1 estimate row is labelled "including the promotional app" but may
  not leave any weeks for it; the total row may be mixing bases.
- **`docs/roadmap/ROADMAP.html` is stale** — it still describes **four waves**
  while every other document is on three phases. Either update it or delete it.
- The 96% / 99% figures quoted may be mis-sourced.
- "Rollout across four branches" may have no branch dimension in the schema to
  support it.

An audit workflow was run over these documents and **failed** — 202 of 240 agents
died on a session limit, and only one finding was ever confirmed. The remaining
77 are unverified and were deliberately not presented as results. If you want
them checked, do it **by hand in small batches**. Do not re-run that workflow.

### Blocked externally

WhatsApp provider, punch machine specification, ORBIT API, app store accounts.
None of these can move without the client.

---

## 11. Figma boards

The Figma MCP server **disconnected** and is no longer available in this session.
Board IDs, for reference:

| Board | ID |
|---|---|
| Roadmap, three phases (**current**) | `KVwylAAGxzOQ4hVuytCw4N` |
| Process steps 4–6 | `5YMRRkPUHMTVs7fYjr909C` |
| Estimation logic | `Vk9MukpiSN77pmnjLHA2hV` |
| Roadmap v1, v2 (superseded) | `kgh10zVS7EeJHgD7dxfJto`, `JCfqXYvjZEQyOsWShXq6Uj` |

Two things learned exporting these, in case anyone does it again:

- **Figma drops FigJam section titles on PDF export.** A subgraph name renders as
  a chip on canvas but is not a text node, so it vanishes. Every board lost its
  section names and they had to be drawn back on by locating the containers via
  their 0.902 grey fill.
- **The process flow cannot be made into one readable sheet.** It is
  920 × 7727 pt — a 1:8.4 ratio. Even A0 gives about 6.7 pt type. It needs a
  compact multi-column redraw, not a bigger sheet.

---

## 12. Suggested next steps

1. **Build the staff Estimates list screen** (section 8). The backend is done and
   correct; without this screen the whole estimate pipeline is unreachable.
2. **Rotate the staging GitHub tokens** (section 4).
3. Get answers to the two open questions in section 9.
4. Sweep the `req.userId` bug across the remaining ~6 route files.
5. Decide whether to finish the status enum contract migration or leave the
   widened enum in place.
6. Reconcile or delete `docs/roadmap/ROADMAP.html`.
