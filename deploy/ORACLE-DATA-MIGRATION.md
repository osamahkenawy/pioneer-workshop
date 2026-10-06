# Oracle → Car-Workshop Data Migration — Deployment Runbook

Migrates historical data from the running Oracle system into this
platform. Idempotent, rollback-able, and safe to run on production.

**Target workshop:** `Pioneer Car Service Center` (id = 1)
**Source data:** `car-workshop-backend/src/migrations/data/*.csv`

---

## 0 — What the pre-flight found (2026-09-04)

```
customers.csv        90 rows
vehicles.csv         5,694 rows
invoices.csv         17,816 rows   (== work orders + invoice refs)
workorder_items.csv  88,651 rows
invoice_items.csv    88,651 rows
```

Data-quality flags surfaced by `migrate.mjs check`:

| Finding | Handling |
|---|---|
| **38 party codes** referenced by vehicles/invoices are missing from `customers.csv` (A00115 has 1,223 vehicles, A00152 has 1,239, D00021 has 1,758 …) | Loader auto-provisions a `Fleet <code>` customer per missing code. You can rename them post-import with one UPDATE (see §5). |
| Only 1 party code (`C00002`) present in customers.csv | 65 individual customers keep that link. 25 corporates lack a party code and are keyed on name. |
| 30 customer rows have no usable phone or no name | Skipped by the loader; count is reported. |
| Work-order STATUS / SERVICE_CATEGORY | Already pre-mapped to valid target enum values ✓ |
| `'-`, `"1"`, `d`, `D` placeholder tokens | Converted to NULL by the loader. |
| Oracle date format `.000` tail | Trimmed to `YYYY-MM-DD HH:MM:SS`. |
| 3-letter make codes (TOY/NIS/MIT…) | Translated via a built-in `MAKE_MAP`. Unknown codes stay as-is — cosmetic only. |
| No customer_id on vehicles | Linkage falls back to `SOURCE_PARTY_CODE`. |

**Nothing in the CSVs will fail on insert.** Every row that can't land somewhere valid is skipped with a count.

---

## 1 — Prerequisites (server-side, one-time)

Requires MySQL 8+ (JSON_EXTRACT), Node 18+, and network access to the app DB.

```bash
# On the server, in the backend project root
node --version   # ≥ 18
mysql --version  # ≥ 8.0
cat .env         # confirm DB_HOST / DB_NAME / DB_USER / DB_PASSWORD
```

Confirm the schema has JSON support (all present as of 2026-09-04):

```bash
node -e "import('./src/lib/database.js').then(async ({query}) => {
  const t = await query(\"SHOW TABLES LIKE 'work_orders'\");
  const j = await query(\"SELECT JSON_VALID('{}') AS ok\");
  console.log('schema OK:', t.length && j[0].ok === 1); process.exit(0);
});"
```

---

## 2 — Upload the CSVs and the loader to the server

From your workstation (adjust the SSH target):

```bash
# From the repo root (Windows / PowerShell)
$SRV = "deploy@pioneer-app-01"       # e.g. deploy@1.2.3.4
$APP = "/opt/car-workshop-backend"

# Push the loader
scp -r car-workshop-backend/scripts/oracle-migration ${SRV}:${APP}/scripts/

# Push the CSVs
ssh $SRV "mkdir -p ${APP}/src/migrations/data"
scp car-workshop-backend/src/migrations/data/*.csv ${SRV}:${APP}/src/migrations/data/
```

macOS / Linux equivalent uses the same commands without the PowerShell `$` prefixes.

---

## 3 — Take a database backup (mandatory)

```bash
ssh $SRV
cd /opt/car-workshop-backend

# Full DB backup with a timestamp — do NOT skip this
BACKUP="/opt/backups/car_workshop_$(date +%Y%m%d_%H%M%S).sql.gz"
mysqldump -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" \
  --single-transaction --routines --triggers "$DB_NAME" \
  | gzip > "$BACKUP"
ls -lh "$BACKUP"
```

Keep this file. Every step below can also be rolled back via `migrate.mjs rollback`, but a full mysqldump is the only true safety net if something goes sideways.

---

## 4 — Run the migration

### 4a. Dry check first (reads only, no writes)

```bash
node scripts/oracle-migration/migrate.mjs check
```

Verify the counts match §0 above and no unexpected numbers appear.

### 4b. Run all stages in sequence (safest)

```bash
node scripts/oracle-migration/migrate.mjs all
```

This runs `customers → vehicles → work-orders → invoices → wo-items → inv-items → verify` in child processes. Expect ~1–3 minutes total on a modest server; the two 88k line-item files dominate.

### 4c. Or run one stage at a time (if you want to inspect between steps)

```bash
node scripts/oracle-migration/migrate.mjs customers
node scripts/oracle-migration/migrate.mjs vehicles
node scripts/oracle-migration/migrate.mjs work-orders
node scripts/oracle-migration/migrate.mjs invoices
node scripts/oracle-migration/migrate.mjs wo-items
node scripts/oracle-migration/migrate.mjs inv-items
node scripts/oracle-migration/migrate.mjs amounts        # roll invoice-item totals up to invoices + work_orders
node scripts/oracle-migration/migrate.mjs verify
```

Every stage is **idempotent** — re-running skips rows already inserted (matched by the `notes.src_id` tag).

### 4d. Verify totals

```bash
node scripts/oracle-migration/migrate.mjs verify
```

Sample expected output (verified against these CSVs on 2026-09-04):
```
  customers imported                            129
    of which auto-provisioned fleet             39
  vehicles imported                             5,694
  work orders imported                          17,816
  invoices imported                             16,454
  work_order_items rows                         88,651
  invoice_items rows                            88,651

Work-order status distribution (imported only):
  completed            16,859
  in_progress          810
  pending              147
  TOTAL                17,816   ← equals "work orders imported" above
```

**Why "invoices imported" (16,454) is less than "work orders imported" (17,816):** the source has duplicate `SOURCE_INVOICE_NUMBER` values across different jobs, and `invoices.invoice_number` is UNIQUE in the target schema. The loader keeps only the first occurrence; the others are skipped without error. If you need every invoice, we'll need to disambiguate the numbers with a suffix.

Then open the app and hit each page:

- **/dashboard** — historical data shows up once you switch the period selector to "Year" or a custom range (the default "This Month" only counts jobs created in the current month)
- **/work-orders** — page header shows the total (~18,730 = existing seed + import); filter tabs and KPI cards respect the period filter
- **/vehicles** — Toyota / Nissan / Mitsubishi / Suzuki / etc. show up
- **/customers** — 90 real + 39 auto-fleet customers (`Fleet A00115` etc.)
- **/invoices** — 16.4k invoices with `II…` numbers

---

## 5 — Post-import polish (optional, no downtime)

### 5a. Rename the auto-provisioned fleet customers

The loader created placeholders like `Fleet A00115`. You'll almost certainly want them showing the real fleet name (AMAN TAXI, EMIRATES CAB, AUTOSTRAD…). Fill in the mapping and run:

```sql
-- one row per party code you know a name for
UPDATE customers SET full_name='AMAN TAXI', company_name='AMAN TAXI'
 WHERE workshop_id=1 AND JSON_EXTRACT(notes,'$.party_code')='"A00115"';

UPDATE customers SET full_name='AL SAFEER', company_name='AL SAFEER'
 WHERE workshop_id=1 AND JSON_EXTRACT(notes,'$.party_code')='"A00152"';

-- …repeat for the other 36 codes reported by the check command
```

You can generate a template of every code needing a name:

```sql
SELECT
  JSON_UNQUOTE(JSON_EXTRACT(notes,'$.party_code')) AS party_code,
  COUNT(*) AS auto_customers,
  full_name AS current_name
FROM customers
WHERE workshop_id=1 AND JSON_EXTRACT(notes,'$.kind')='auto_fleet'
GROUP BY party_code
ORDER BY auto_customers DESC;
```

### 5b. Add more make-code translations

Any 3-letter make code the loader didn't know shows up as the raw code in the Vehicles page (e.g. `RAB`). Add it to `MAKE_MAP` in [migrate.mjs](../car-workshop-backend/scripts/oracle-migration/migrate.mjs), or just SQL-patch:

```sql
UPDATE vehicles SET make='Renault Trucks'
 WHERE workshop_id=1 AND make='RAB';
```

---

## 6 — Rollback (if anything looks wrong)

Everything the loader wrote is tagged with `notes.src = 'oracle'`. Rolling back is one command:

```bash
# Wipe EVERYTHING this migration inserted (customers/vehicles/WOs/invoices/items).
# Uses FK CASCADE where possible; deletes children first where not.
node scripts/oracle-migration/migrate.mjs rollback

# Or rollback a single scope while keeping the rest
node scripts/oracle-migration/migrate.mjs rollback inv-items
node scripts/oracle-migration/migrate.mjs rollback wo-items
node scripts/oracle-migration/migrate.mjs rollback invoices
node scripts/oracle-migration/migrate.mjs rollback work-orders
node scripts/oracle-migration/migrate.mjs rollback vehicles
node scripts/oracle-migration/migrate.mjs rollback customers
```

Rollback scopes must run in the order above if you're doing them one at a time (child rows must be gone before their parents). `rollback all` handles ordering automatically.

If the loader itself is broken, restore from the mysqldump you took in §3:

```bash
gunzip < /opt/backups/car_workshop_YYYYMMDD_HHMMSS.sql.gz \
  | mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME"
```

---

## 7 — Known caveats

1. **`created_at` on historical work orders is set from the Oracle `JOB_DATE`.**
   All dashboards / reports scoped by "This Month" or "Last 30 Days" will therefore correctly attribute the imported data to the actual historical periods.
2. **`opening_mileage` from each job is stored inside `work_orders.notes` JSON** (`notes.opening_km`). The schema has no dedicated odometer column at the job level. If you want it surfaced in the UI later, a follow-up migration can extract it into a dedicated column with:
   ```sql
   ALTER TABLE work_orders ADD COLUMN opening_km INT NULL AFTER notes;
   UPDATE work_orders
     SET opening_km = JSON_EXTRACT(notes, '$.opening_km')
    WHERE notes IS NOT NULL AND JSON_VALID(notes) = 1
      AND JSON_EXTRACT(notes, '$.src') = 'oracle';
   ```
3. **No mechanic linkage yet.** Work orders come in with `mechanic_id = NULL`. Once you produce the mechanics extract, we'll do a one-shot UPDATE using `notes.operator` as the key.
4. **Every migrated invoice is created with `status = 'paid'`.** Oracle marks all `CLO` jobs as closed / invoiced. If your source has clearer payment info in `WSINVTRN`, we can refine this in a follow-up.
5. **The customers.csv had only 1 real party code (`C00002`).** The 38 fleet placeholders exist because the export SQL didn't emit rows for the corporate accounts. Fixing the export upstream and re-running is the ideal long-term move; the placeholders are safe to keep in the meantime.

---

## Command cheat-sheet

```bash
node scripts/oracle-migration/migrate.mjs check         # pre-flight, no writes
node scripts/oracle-migration/migrate.mjs all           # run everything
node scripts/oracle-migration/migrate.mjs verify        # counts after import
node scripts/oracle-migration/migrate.mjs rollback      # wipe all imports
node scripts/oracle-migration/migrate.mjs rollback vehicles   # per-scope
```
