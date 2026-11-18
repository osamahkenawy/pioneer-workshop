/**
 * schema-check.js — at startup, says which database migrations this code
 * needs are missing.
 *
 * Client feedback (18 Nov 2026), points 1 and 2: the 16 Nov code went live
 * before its migrations, so the customer list query (which reads
 * customer_entities) failed on every call. The work order form showed an
 * empty customer list and the entity names were missing, with nothing in
 * the logs. Now the API logs, at start, each missing table, column or
 * value with the migration file that adds it. It never changes anything.
 */
import { query } from './database.js';

/** What the code needs, newest last: [migration file, check]. */
const NEEDED = [
  ['20261112_enquiry_fields.sql', { column: ['enquiries', 'emirate'] }],
  ['20261112_enquiry_fields.sql', { column: ['enquiries', 'vehicle_make'] }],
  ['20261112_job_tasks_skills.sql', { table: 'job_card_tasks' }],
  ['20261112_job_tasks_skills.sql', { column: ['mechanics', 'skills'] }],
  ['20261112_job_tasks_skills.sql', { column: ['mechanics', 'badge_code'] }],
  ['20261112_staff_subcategory.sql', { enumValue: ['customers', 'customer_subcategory', 'staff'] }],
  ['20261112_supplementary_estimates.sql', { table: 'estimate_consents' }],
  ['20261112_supplementary_estimates.sql', { column: ['service_estimates', 'kind'] }],
  ['20261112_technical_report_share.sql', { column: ['technical_inspections', 'share_token'] }],
  ['20261116_customer_entities.sql', { table: 'customer_entities' }],
  ['20261116_customer_entities.sql', { column: ['customers', 'entity_id'] }],
  ['20261118_feedback.sql', { column: ['estimate_lines', 'is_fixed_fee'] }],
];

/** The missing items, as "file: what" lines (empty when the database is up to date). */
export async function missingMigrations() {
  const tables = new Set((await query(
    'SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE()')).map(r => r.t));
  const cols = new Map((await query(
    'SELECT table_name AS t, column_name AS c, column_type AS ty FROM information_schema.columns WHERE table_schema = DATABASE()'))
    .map(r => [`${r.t}.${r.c}`, String(r.ty || '')]));
  const out = [];
  for (const [file, need] of NEEDED) {
    if (need.table && !tables.has(need.table)) out.push(`${file}: table ${need.table}`);
    if (need.column && !cols.has(need.column.join('.'))) out.push(`${file}: column ${need.column.join('.')}`);
    if (need.enumValue) {
      const [t, c, v] = need.enumValue;
      const ty = cols.get(`${t}.${c}`);
      if (!ty || !ty.includes(`'${v}'`)) out.push(`${file}: value '${v}' in ${t}.${c}`);
    }
  }
  return [...new Set(out)];
}

/** Logs the result once; never throws. */
export async function logSchemaCheck() {
  try {
    const missing = await missingMigrations();
    if (!missing.length) { console.log('✅ Database schema up to date'); return; }
    console.error(`❌ DATABASE MIGRATIONS MISSING (${missing.length}) — run these files in src/migrations/ before using the app:`);
    for (const m of missing) console.error(`   - ${m}`);
  } catch (e) {
    console.error('Schema check failed:', e.message);
  }
}
