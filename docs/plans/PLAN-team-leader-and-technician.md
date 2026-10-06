# Team Leader & Technician — 3-Day Plan

**Written:** 14 September 2026
**Covers:** the Team Leader role and board, technician accounts, and which pages each role gets.

Everything marked **Done** below is built and verified against the running app.
Everything marked **To do** is not started.

---

## Where this sits in the job card flow

```
Job card created
      ↓
Estimate sent to customer  ──→  customer approves / rejects each line
      ↓ (all lines approved)
Job card created automatically        ← DONE (estimates pipeline)
      ↓
Waiting for a technician              ← the Team Board queue
      ↓
Team Leader assigns technician + books start/end window   ← DONE
      ↓
Technician works the job (start / pause / complete)       ← TO DO (Day 3)
      ↓
Quality check → gate pass → invoice → close               ← TO DO (later phase)
```

---

## Day 1 — Accounts and team setup

Goal: a real Team Leader can log in, and their technicians are attached to them.

| # | Task | Status |
|---|------|--------|
| 1.1 | `team_leader` role in the roles table | **Done** |
| 1.2 | `mechanics.team_leader_id` column + index | **Done** |
| 1.3 | Create the Team Leader user accounts | **To do** |
| 1.4 | Attach technicians to their leader | **To do** |
| 1.5 | Log in as a Team Leader and confirm the nav is correct | **To do** |

### 1.3 — Creating a Team Leader account

Go to **Settings → Users → Add user**, and set the **Role** to *Team Leader*.

What matters, and why:

- The **Role** dropdown writes `users.role_id`, which is what drives the sidebar
  and the page access. This is the field that counts.
- `users.role` is a **separate, older column** — a fixed list that does **not**
  contain `team_leader` and cannot be extended without a schema change. Leave it
  at its default (`dispatcher`). It is only a legacy fallback and is ignored once
  `role_id` is set.
- Password rules are enforced: at least 8 characters, with an uppercase, a
  lowercase, and a digit.
- The account's credentials are emailed automatically if an email is given.

> **Watch for:** creating users is capped by the subscription's `max_users`.
> If the workshop is at its limit the request returns a 403 asking for an
> upgrade rather than creating the account.

### 1.4 — Attaching technicians to a leader

Two ways, both work:

1. **From the Team Board** — the leader opens **Manage team**, which lists every
   active technician not already on someone's team, and adds them in bulk.
2. **By hand**, if you want to set up several teams at once:

```sql
UPDATE mechanics
   SET team_leader_id = <the team leader's users.id>
 WHERE workshop_id = 1
   AND id IN (<technician ids>);
```

> **Note:** until technicians are attached, the Team Board shows **all teams**
> rather than nothing — a deliberate choice so a manager checking in sees the
> whole floor instead of a blank screen. A user with the `team_leader` role is
> always scoped to their own team and cannot widen it.

---

## Day 2 — The Team Board

Goal: the leader runs their bay from one screen.

| # | Task | Status |
|---|------|--------|
| 2.1 | `GET /api/team-leader/overview` — all four views in one call | **Done** |
| 2.2 | Team Board page + nav entry (all 12 languages) | **Done** |
| 2.3 | Assign a technician and book start/end date-time | **Done** |
| 2.4 | Double-booking detection | **Done** |
| 2.5 | Assign straight from the Work Orders page, not just the board | **To do** |
| 2.6 | Reassign / release a technician from a job card | **To do** |
| 2.7 | Filter the board by day (today / tomorrow / this week) | **To do** |

### What the board answers

| The question | Where it shows | How it is worked out |
|---|---|---|
| Who are my technicians? | *My technicians* | `mechanics.team_leader_id` = the leader |
| Which vehicles are on my team? | *Vehicles on my team* | live job cards joined to those technicians |
| What are their times? | *Technician times — today* | the booked window on each assignment |
| Who is working, who is free? | the top strip | **counted from real open job cards**, not the self-reported status field — a technician who forgets to set himself back to "available" would otherwise read as busy forever |

### Time booking

The booked window is **new** — `work_order_assignments` already recorded who
assigned whom and when they accepted (945 real rows), but only the moment the
assignment was made, which is not the shift the technician is booked for. Two
new nullable columns hold it: `scheduled_start_at` and `scheduled_end_at`. The
945 existing rows have no window; they are left blank rather than back-filled
with a guess.

Double-booking is **reported, not blocked**. A leader slotting a quick job
inside a longer one is a real thing; refusing it would push them to assign with
no window at all, which is worse. The clashing job card is named in the
confirmation so the decision is informed.

---

## Day 3 — Technician side

Goal: the technician can see and work the job they have been assigned.

| # | Task | Status |
|---|------|--------|
| 3.1 | Technician accounts exist and can log in | **Done** (already built) |
| 3.2 | Technician sees the booked window on their job | **To do** |
| 3.3 | Start / Pause / Complete on a job card | **To do** |
| 3.4 | Actual time captured against the booked window | **To do** |
| 3.5 | Team Board shows booked vs actual | **To do** |

### 3.1 — How technician accounts are created (already works)

Adding a technician in **Mechanics → Add** creates **two** records in one step:

- a `mechanics` row — the technician profile, and
- a `users` row with `role = 'mechanic'` — their login.

The account details are generated automatically:

| Field | How it is set |
|---|---|
| Username | name, lowercased and stripped to 15 characters, plus a random 4-digit suffix — e.g. `ahmedhassan4821` |
| Password | whatever the admin types, or auto-generated as `Mechanic@<suffix>` if left blank |
| Email | the technician's real email, so they can log in with it; falls back to `<username>@mechanic.local` if none is given |

Credentials are emailed to the technician if an address was provided, and are
also returned on screen once — so an admin can still hand them over for someone
with no email.

> **Watch for:** technicians count against the subscription's `max_users` limit,
> same as staff accounts.

### 3.3 — Start / Pause / Complete

Worth knowing before this is built: a **clock-in / clock-out API already
exists** in `routes/job-cards.js`, along with a QC checklist. It has never been
connected to any screen and both its tables hold **zero rows**. It also operates
on a separate `job_cards` table, not the `work_orders` table the rest of the app
treats as the job card.

**Decision needed before Day 3 starts:** wire the technician timer onto
`work_orders` / `work_order_assignments` where everything else already lives, or
adopt the parallel `job_cards` system. Recommendation is the former — the data,
the assignments and the booked windows are all already there.

---

## Which pages each role gets

Access is driven by the **role's module list** (`roles.modules`), which the
sidebar filters against. Adding a page to a role is a change to that list, not a
code change.

### Team Leader — the new role

| Page | Path | Why |
|---|---|---|
| Dashboard | `/dashboard` | general overview |
| **Team Board** | `/team-leader` | their main screen |
| Work Orders | `/work-orders` | the job cards they assign from |
| Job Assignment | `/job-assignment` | the existing assignment board |
| Mechanics | `/mechanics` | their technicians' records |
| Service Status | `/service-status` | live floor status |
| Notifications | `/notifications` | — |

**Deliberately not given:** invoices, pricing, cash, wallet, reports, performance,
technician KPI, settings, integrations, customer experience, complaints. A team
leader runs a bay, not the P&L.

### Technician (`mechanic`)

| Page | Path |
|---|---|
| Mechanic Home | `/mechanic/dashboard` |
| My Work Orders | `/mechanic/work-orders` |
| Scan | `/mechanic/scan` |

Technicians never see the staff sidebar. Their module list is fixed in code
(`routes/auth.js`) rather than coming from the roles table.

### The full picture

| Page | GM | Workshop Mgr | Supervisor | Service Advisor | **Team Leader** | Technician |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| Dashboard | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Enquiries | ✓ | ✓ | — | ✓ | — | — |
| Work Orders | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| **Team Board** | — | — | — | — | ✓ | — |
| Job Assignment | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Customers | ✓ | ✓ | ✓ | ✓ | — | — |
| Vehicles | ✓ | ✓ | ✓ | ✓ | — | — |
| Mechanics | ✓ | ✓ | — | — | ✓ | — |
| Service Bays | ✓ | ✓ | — | — | — | — |
| Parts / Inventory | ✓ | — | — | — | — | — |
| Invoices | ✓ | ✓ | — | ✓ | — | — |
| Reports | ✓ | ✓ | ✓ | — | — | — |
| Technician KPI | ✓ | ✓ | ✓ | — | — | — |
| Customer Experience | ✓ | ✓ | — | ✓ | — | — |
| Complaints | ✓ | ✓ | — | ✓ | — | — |
| Settings | ✓ | — | — | — | — | — |
| Mechanic Home / Scan | — | — | — | — | — | ✓ |

> **Team Board for managers:** the GM and Workshop Manager do not have
> `team-leader` in their module list yet, so the page is not in their sidebar.
> They can still reach it by URL and will see **all teams**. Say the word and it
> gets added to their sidebar properly.

> **Gotcha to remember:** if a workshop ever sets `allowed_modules` in its
> settings, the role's modules are **intersected** with it. `team-leader` would
> have to be in that list too or the page disappears for everyone. This workshop
> currently sets no restriction, so nothing to do today.

---

## Open decisions

1. **Team structure** — how many team leaders, and which technicians under each?
   There are 278 active technicians and none are attached to a leader yet.
2. **Day 3 timer** — build on `work_orders` (recommended) or adopt the unused
   `job_cards` system?
3. **Manager visibility** — should GM / Workshop Manager get the Team Board in
   their sidebar?
4. **Quality Coordinator** — mentioned in the meeting notes, not built. Same
   pattern as Team Leader when you want it.

---

## Still uncommitted

None of this is pushed yet. Currently sitting in the working tree:

**Backend** — `team-leader.js` (new), three migrations, plus the earlier
estimate-approval work (`estimates.js`, `customers.js`, `work-orders.js`,
`auth.js`, `server.js`).

**Frontend** — `TeamLeader.jsx` / `.css` (new), `NewEstimateModal.jsx`,
`EstimateApproval.jsx` / `.css`, plus edits to `App.jsx`, `Layout.jsx`,
`NewWorkOrderModal.jsx`, `WorkOrders.jsx` and all 12 locale files.
