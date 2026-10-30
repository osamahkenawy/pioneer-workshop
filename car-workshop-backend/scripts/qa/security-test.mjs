// Access-control regression for the security fixes. LOCAL ONLY; cleans up by id baseline.
import { createRequire } from 'module'; import fs from 'fs'; import crypto from 'crypto';
import { fileURLToPath } from 'url';
const BE = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const require = createRequire(BE + '/package.json');
const mysql = require('mysql2/promise'); const bcrypt = require('bcryptjs');
const env = Object.fromEntries(fs.readFileSync(BE + '/.env', 'utf8').split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
if (!['localhost', '127.0.0.1'].includes(env.DB_HOST)) throw new Error('local only');
const db = await mysql.createConnection({ host: '127.0.0.1', user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
const q = async (s, p = []) => (await db.query(s, p))[0];
const API = process.env.QA_API || 'http://localhost:4000/api'; // QA_API overrides the API base
const ORIGIN = API.replace(/\/api\/?$/, ''); // the same server, for the static '/uploads' and full '/api/…' paths
const out = [];
const expect = (what, ok, detail) => out.push(`${ok ? 'PASS' : 'FAIL'}  ${what}${detail ? '  — ' + detail : ''}`);
const call = async (method, path, token, body) => {
  // '/uploads/…' is the static file server; '/api/…' is a full API path (for /api/uploads, which would otherwise read as static).
  const r = await fetch((path.startsWith('/uploads') || path.startsWith('/api/') ? ORIGIN : API) + path, { method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, json: j };
};
const idTables = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema = DATABASE() AND column_name = 'id' AND extra LIKE '%auto_increment%'`)).map(r => r.t)
  .filter(t => t !== 'roles'); // never cleaned up by id: the seeded / demo roles live there
const baseline = {};
for (const t of idTables) baseline[t] = (await q(`SELECT COALESCE(MAX(id),0) AS m FROM \`${t}\``))[0].m;
const ownerBefore = (await q('SELECT id, role, password FROM users WHERE is_owner = 1 LIMIT 1'))[0];

try {
  const pw = 'Qa' + crypto.randomBytes(8).toString('hex') + '1';
  const mk = async (username, role, roleSlug) => {
    const [r] = roleSlug ? await q('SELECT id FROM roles WHERE slug = ?', [roleSlug]) : [null];
    await q(`INSERT INTO users (workshop_id, full_name, username, email, password, role, role_id, is_active) VALUES (1,?,?,?,?,?,?,1)`,
      [`QA ${role}`, username, `${username}@example.invalid`, await bcrypt.hash(pw, 10), role, r?.id || null]);
    return (await call('POST', '/auth/login', null, { username, password: pw })).json?.data?.token;
  };
  const mgr = await mk('qa_sec_manager', 'workshop_manager', 'workshop_manager');
  const disp = await mk('qa_sec_dispatcher', 'dispatcher');
  const mech = await mk('qa_sec_mechanic', 'mechanic');
  const advisor = await mk('qa_sec_advisor', 'service_advisor', 'service_advisor');
  const store = await mk('qa_sec_store', 'part_advisor', 'storekeeper');
  const [{ id: mechUserId }] = await q("SELECT id FROM users WHERE username = 'qa_sec_mechanic'");
  const { insertId: mechId } = await q(`INSERT INTO mechanics (workshop_id, user_id, full_name, phone, is_active, status) VALUES (1,?,'QA Sec Mechanic','+971500000333',1,'available')`, [mechUserId]);

  // 1. self-registered customer
  const reg = await call('POST', '/customer-auth/register', null, { full_name: 'QA Portal Customer', email: `qa-portal-${Date.now()}@example.invalid`, phone: '+971500000222', password: pw });
  const cust = reg.json?.data?.token || reg.json?.token;
  expect('customer can still self-register for the portal', reg.status === 201 && !!cust, `HTTP ${reg.status}`);
  for (const [m, p] of [['GET', '/customers'], ['GET', '/invoices'], ['PUT', '/settings'], ['GET', '/settings/users'], ['GET', '/work-orders']]) {
    const r = await call(m, p, cust, m === 'PUT' ? { workshop_name: 'x' } : undefined);
    expect(`customer token blocked from ${m} ${p}`, r.status === 403, `HTTP ${r.status}`);
  }

  // 2. mechanic
  const owner = ownerBefore;
  for (const [m, p, b] of [['GET', '/settings/users'], ['PUT', `/settings/users/${owner.id}`, { full_name: 'x', email: 'x@example.invalid', password: 'Hacked123' }], ['GET', '/customers'], ['GET', '/invoices'], ['DELETE', '/invoices/1']]) {
    const r = await call(m, p, mech, b);
    expect(`mechanic blocked from ${m} ${p.replace(/\d+$/, ':id')}`, r.status === 403, `HTTP ${r.status}`);
  }
  const myOrders = await call('GET', '/service-status/my-orders', mech);
  expect('mechanic can still load their own jobs', myOrders.status === 200, `HTTP ${myOrders.status}`);
  const mo = myOrders.json?.data || {};
  expect('…without takings or earnings', !('revenue' in (mo.stats || {})) && !('total_revenue' in (mo.allTimeStats || {})), JSON.stringify(mo.stats));

  // 2b. technician: the token tools, the courier API and GPS pings are closed.
  // Every probe is chosen so that a broken guard changes nothing: a closed
  // job cannot move, an unknown token texts nobody, an empty body saves nothing.
  const [closedWo] = await q("SELECT service_status_token AS t FROM work_orders WHERE workshop_id = 1 AND status = 'completed' AND service_status_token IS NOT NULL ORDER BY id DESC LIMIT 1");
  const [anyWo] = await q('SELECT id FROM work_orders WHERE workshop_id = 1 ORDER BY id DESC LIMIT 1'); // not assigned to the new QA mechanic
  for (const [m, p, b] of [
    ['PATCH', `/service-status/${closedWo.t}/status`, { status: 'cancelled' }],
    ['GET', `/service-status/${closedWo.t}/order`],
    ['POST', `/service-status/${closedWo.t}/scan`, { scan_type: 'checkin_scan' }],
    ['POST', '/service-status/qa-no-such-token/send-sms'],
    ['GET', '/service-status?work_order_number=WO-QA-NONE'],
    ['PATCH', `/mechanics/${mechId}/location`, { lat: 25.2, lng: 55.3 }],
  ]) {
    const r = await call(m, p, mech, b);
    expect(`technician blocked from ${m} ${p.replace(closedWo.t, ':token').replace(/\/\d+\//, '/:id/').replace(/\?.*$/, '')}`, r.status === 403, `HTTP ${r.status} ${r.json?.code || ''}`);
  }
  // The courier driver API is no longer mounted (server.js), and lib/access.js
  // refuses its prefix for every role should it come back: gone (404) or
  // refused (403), for the technician and for a manager alike.
  const courierApi = [await call('GET', '/mechanic-app/profile', mech), await call('GET', '/mechanic-app/profile', mgr)];
  expect('courier driver API (GET /mechanic-app/profile) is closed to the technician and to a manager',
    courierApi.every(r => [403, 404].includes(r.status) && !r.json?.data), courierApi.map(r => `HTTP ${r.status}`).join(' / '));
  const trip = await call('POST', '/service-status/start-trip', mech, {});
  expect('"start trip" (batch start, no time booked) is retired', trip.status === 410 && trip.json?.code === 'MOVED', `HTTP ${trip.status}`);
  const proof = await call('POST', `/api/uploads/work-orders/${anyWo.id}/proof`, mech, {});
  expect("technician cannot upload proof on someone else's job", proof.status === 404, `HTTP ${proof.status}`);
  // The physical inspection opens an external customer's job card (client,
  // 2026-10-29): a technician does not reach it, and opening the job card
  // without it is a manager's. A work order that does not exist: a broken
  // guard answers 404 and changes nothing.
  const techInsp = await call('POST', '/vehicle-inspections', mech, { work_order_id: 999999999, inspection_type: 'intake' });
  const storeOverride = await call('POST', '/workflow/work-orders/999999999/job-card', store, { override_reason: 'QA probe' });
  expect('technician cannot reach the physical inspection; Storekeeper cannot open a job card without it (403)', techInsp.status === 403 && storeOverride.status === 403,
    `HTTP ${techInsp.status} / ${storeOverride.status}`);

  // 2c. staff need the capability for the status they set through the QR/token tool
  const sa = await call('PATCH', `/service-status/${closedWo.t}/status`, advisor, { status: 'ready_for_pickup' });
  expect('Service Advisor cannot set Ready for collection through the token tool', sa.status === 403 && sa.json?.code === 'ROLE_NOT_ALLOWED', `HTTP ${sa.status} ${sa.json?.code || ''}`);
  for (const [m, p] of [['POST', '/mechanic-earnings'], ['POST', '/mechanic-earnings/bulk-pay']]) {
    const r = await call(m, p, store, {});
    expect(`Storekeeper blocked from ${m} ${p}`, r.status === 403, `HTTP ${r.status}`);
  }

  // 2d. the public status link shows no staff details
  const [liveWo] = await q(`SELECT wo.service_status_token AS t FROM work_orders wo
    WHERE wo.workshop_id = 1 AND wo.mechanic_id IS NOT NULL AND wo.status IN ('assigned','accepted','in_progress','ready_for_pickup')
      AND wo.service_status_token IS NOT NULL AND EXISTS (SELECT 1 FROM work_order_status_logs l WHERE l.work_order_id = wo.id)
    ORDER BY wo.id DESC LIMIT 1`);
  if (!liveWo) expect('public status link has no staff details', false, 'no open job with a technician and a status history to check');
  else {
    // The old work-order payload is retired: it answers 410 MOVED and returns nothing.
    const old = await call('GET', `/service-status/${encodeURIComponent(liveWo.t)}`, null);
    expect('old public GET /service-status/:token is retired (410 MOVED, no data)', old.status === 410 && old.json?.code === 'MOVED' && !old.json?.data, `HTTP ${old.status} ${old.json?.code || ''}`);
    // The customer's status page reads /public/service-status/:token: no field
    // anywhere in it may carry the technician, a phone other than the
    // workshop's, a note, coordinates or payment details.
    const pub = await call('GET', `/public/service-status/${encodeURIComponent(liveWo.t)}`, null);
    const keys = [];
    const walk = (o, path) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { const kp = Array.isArray(o) ? path : `${path}.${k}`; if (!Array.isArray(o)) keys.push(kp); walk(v, kp); } };
    walk(pub.json?.data, 'data');
    const leaked = [...new Set(keys.filter(k => /mechanic|technician|dropoff|payment_method|cash_amount|service_fee|password|reset_token|notes?$|lat$|lng$|status_logs/i.test(k)
      || (/phone/i.test(k) && k !== 'data.workshop.phone')))];
    expect('public status link: no technician phone, payment fields, staff notes or coordinates',
      pub.status === 200 && pub.json?.success && keys.length > 0 && !leaked.length, `HTTP ${pub.status} leaked [${leaked}]`);
  }

  // 3. dispatcher (staff, not a manager)
  const dGet = await call('GET', '/customers?limit=1', disp);
  expect('dispatcher can use the staff API', dGet.status === 200, `HTTP ${dGet.status}`);
  for (const [m, p, b] of [['PUT', '/settings', { workshop_name: 'x' }], ['POST', '/settings/users', { full_name: 'x', username: 'qa_sec_x', email: 'qa-sec-x@example.invalid', password: 'Abcdefg123', role: 'admin' }], ['POST', '/settings/roles', { name: 'x' }], ['DELETE', '/customers/1']]) {
    const r = await call(m, p, disp, b);
    expect(`dispatcher blocked from ${m} ${p}`, r.status === 403, `HTTP ${r.status}`);
  }

  // 4. workshop manager
  const created = await call('POST', '/settings/users', mgr, { full_name: 'QA New Advisor', username: 'qa_sec_newadvisor', email: 'qa-sec-new@example.invalid', password: 'Abcdefg123', role: 'service_advisor' });
  expect('manager can add a staff user (no phantom 5-seat limit)', created.status === 201 || created.status === 200, `HTTP ${created.status} ${created.json?.message || ''}`);
  const editOwner = await call('PUT', `/settings/users/${owner.id}`, mgr, { full_name: 'x', email: 'x@example.invalid', password: 'Hacked123' });
  expect("manager cannot change the owner's account", editOwner.status === 403, `HTTP ${editOwner.status}`);
  const [{ id: mgrId }] = await q("SELECT id FROM users WHERE username = 'qa_sec_manager'");
  const selfRole = await call('PUT', `/settings/users/${mgrId}`, mgr, { full_name: 'QA mgr', email: 'qa_sec_manager@example.invalid', role: 'admin' });
  expect('manager cannot change their own role', selfRole.status === 403, `HTTP ${selfRole.status}`);
  const [{ id: newId }] = await q("SELECT id FROM users WHERE username = 'qa_sec_newadvisor'");
  const toSuper = await call('PUT', `/settings/users/${newId}`, mgr, { full_name: 'x', email: 'qa-sec-new@example.invalid', role: 'super_admin' });
  expect('nobody can assign super_admin', toSuper.status === 403, `HTTP ${toSuper.status}`);
  const keepRole = await call('PUT', `/settings/users/${newId}`, mgr, { full_name: 'QA Renamed', email: 'qa-sec-new@example.invalid', phone: '+971500000111' });
  const [after] = await q('SELECT role FROM users WHERE id = ?', [newId]);
  expect('editing without a role keeps the role (was: demoted to dispatcher)', keepRole.status === 200 && after.role === 'service_advisor', `role ${after.role}`);

  // 5. public signup + careers admin + uploads + reset token
  for (const p of ['/workshops/register', '/public/start-trial', '/public/signup']) {
    const r = await call('POST', p, null, { company_name: 'x', email: 'x@example.invalid', password: 'Abcdefg123' });
    expect(`public tenant signup disabled: ${p}`, r.status === 404, `HTTP ${r.status}`);
  }
  const careers = await call('GET', '/admin/careers/vacancies', null);
  expect('careers admin needs a super-admin login', careers.status === 401 || careers.status === 403, `HTTP ${careers.status}`);
  const doc = await call('GET', '/uploads/mechanic-docs/anything.pdf', null);
  expect('mechanic documents need a login', doc.status === 401, `HTTP ${doc.status}`);
  const reset = await call('POST', '/auth/reset-password', null, { token: { password_reset_token: 1 }, password: 'Abcdefg123', newPassword: 'Abcdefg123' });
  expect('object as reset token matches nothing', reset.status >= 400 && reset.status < 500, `HTTP ${reset.status}`);

  const ownerAfter = (await q('SELECT id, role, password FROM users WHERE id = ?', [owner.id]))[0];
  expect('owner account untouched by all of the above', ownerAfter.role === owner.role && ownerAfter.password === owner.password, '');
} catch (e) {
  out.push('ERROR ' + e.stack);
} finally {
  await q('SET FOREIGN_KEY_CHECKS = 0');
  const removed = {};
  for (const t of idTables) { const r = await q(`DELETE FROM \`${t}\` WHERE id > ?`, [baseline[t]]); if (r.affectedRows) removed[t] = r.affectedRows; }
  await q('SET FOREIGN_KEY_CHECKS = 1');
  await db.end();
  console.log(out.join('\n'));
  console.log(`\n${out.filter(l => l.startsWith('PASS')).length} passed, ${out.filter(l => l.startsWith('FAIL')).length} failed  · cleanup ${JSON.stringify(removed)}`);
}
