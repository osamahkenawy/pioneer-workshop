// Customer status link + customer portal (WP-4), through the API with real logins.
//   - the public status payload: whitelist, the stage at each step, the reduced view for a short token
//   - "Give portal access" on the customer page → set password → sign in with the mobile number
//   - the portal: own jobs only, "Action needed" (sign the inspection, approve the estimate), one-time sign-off
//   - retired merchant endpoints, staff tokens refused, no customer secrets on the staff API
// LOCAL ONLY; every row created is removed by id baseline at the end. Never prints tokens or passwords.
import { createRequire } from 'module'; import fs from 'fs'; import crypto from 'crypto';
import { fileURLToPath } from 'url';
const BE = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const require = createRequire(BE + '/package.json');
const mysql = require('mysql2/promise'); const bcrypt = require('bcryptjs');
const env = Object.fromEntries(fs.readFileSync(BE + '/.env', 'utf8').split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
if (!['localhost', '127.0.0.1'].includes(env.DB_HOST)) throw new Error('local only');
const db = await mysql.createConnection({ host: '127.0.0.1', user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
const q = async (s, p = []) => (await db.query(s, p))[0];
const API = 'http://localhost:4000/api';
const out = []; let section = '';
const expect = (what, ok, detail) => out.push(`${ok ? 'PASS' : 'FAIL'}  [${section}] ${what}${detail !== undefined && detail !== '' ? '  — ' + detail : ''}`);
const raw = async (method, path, token, body) => fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
const call = async (method, path, token, body) => {
  const r = await raw(method, path, token, body);
  let j = null; try { j = await r.json(); } catch {} return { status: r.status, json: j, headers: r.headers };
};
const idTables = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema = DATABASE() AND column_name = 'id' AND extra LIKE '%auto_increment%'`)).map(r => r.t);
const baseline = {}; for (const t of idTables) baseline[t] = (await q(`SELECT COALESCE(MAX(id),0) AS m FROM \`${t}\``))[0].m;

// What must never be in the public payload.
const LEAKS = /mechanic|technician|customer_phone|"phone_alt"|"note"|"notes"|"lat"|"lng"|dropoff|payment_method|cash_amount|password|reset_token/i;
// A 1×1 PNG, as the signature pad would send.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const rnd7 = () => String(crypto.randomInt(0, 1e7)).padStart(7, '0');

try {
  const pw = 'Qa' + crypto.randomBytes(8).toString('hex') + '1';
  const users = {};
  const mk = async (key, role, slug) => {
    const [r] = slug ? await q('SELECT id FROM roles WHERE slug = ? AND workshop_id = 1', [slug]) : [null];
    const username = `qa_cs_${key}`;
    const ins = await q(`INSERT INTO users (workshop_id, full_name, username, email, password, role, role_id, is_active) VALUES (1,?,?,?,?,?,?,1)`,
      [`QA ${key}`, username, `${username}@example.invalid`, await bcrypt.hash(pw, 10), role, r?.id || null]);
    const tok = (await call('POST', '/auth/login', null, { username, password: pw })).json?.data?.token;
    users[key] = { id: ins.insertId, tok };
    return tok;
  };
  const advisor = await mk('advisor', 'service_advisor', 'service_advisor');
  const manager = await mk('manager', 'workshop_manager', 'workshop_manager');
  const store = await mk('store', 'part_advisor', 'storekeeper');

  // ── A customer, their car, a job ────────────────────────────────────
  section = 'setup';
  const phone = `+97158${rnd7()}`;
  const cust = (await call('POST', '/customers', advisor, { full_name: 'QA Status Customer', phone, email: `qa-cs-${Date.now()}@example.invalid`, customer_class: 'external', customer_subcategory: 'walkin' })).json?.data;
  const veh = (await call('POST', '/vehicles', advisor, { customer_id: cust?.id, make: 'Nissan', model: 'Patrol', year: 2023, plate_number: 'QACS01', vin: 'TSTCSA00000000001' })).json?.data;
  const created = await call('POST', '/work-orders', advisor, { customer_id: cust?.id, vehicle_id: veh?.id, customer_name: cust?.full_name, customer_phone: phone,
    description: 'Vibration at 100 km/h; check the front suspension', payment_method: 'cash', service_fee: 0, items: [] });
  const woId = created.json?.data?.id;
  const [wo] = await q('SELECT service_status_token FROM work_orders WHERE id = ?', [woId]);
  const token = wo?.service_status_token;
  expect('customer, car and job card created', !!cust?.id && !!veh?.id && created.status === 201 && token?.length >= 32, `wo ${woId}`);
  const status = async () => (await call('GET', `/public/service-status/${token}`)).json?.data;

  // ── Public status payload ───────────────────────────────────────────
  section = 'public';
  const pub = await call('GET', `/public/service-status/${token}`);
  const body = JSON.stringify(pub.json);
  expect('GET /public/service-status/:token answers', pub.status === 200 && pub.json?.success, `HTTP ${pub.status}`);
  expect('payload is the whitelist (no staff, phones, notes, coordinates, payment)', !LEAKS.test(body), (body.match(LEAKS) || [])[0]);
  expect('stage: Vehicle received', pub.json?.data?.stage?.key === 'received', pub.json?.data?.stage?.key);
  // The stage the job is at is 'current' (the page marks it "Now" and counts
  // "Stage 1 of 7"); only the last stage, Collected, is 'done' when reached.
  expect('seven stages: Vehicle received is current, with its time; the rest upcoming', pub.json?.data?.stages?.length === 7 && pub.json.data.stages[0].state === 'current' && !!pub.json.data.stages[0].at
    && pub.json.data.stages.slice(1).every(s => s.state === 'upcoming' && !s.at), (pub.json?.data?.stages || []).map(s => s.state).join(','));
  expect('vehicle, job card number and the reported issue are shown', pub.json?.data?.vehicle?.plate === 'QACS01' && /^JC-/.test(pub.json?.data?.job?.job_card_number || '') && /Vibration/.test(pub.json?.data?.job?.reported_issue || ''));
  expect('workshop contact and a map link', !!pub.json?.data?.workshop?.name && /^https:\/\/www\.google\.com\/maps\//.test(pub.json?.data?.workshop?.map_url || ''));
  expect('not cached', /no-store/.test(pub.headers.get('cache-control') || ''), pub.headers.get('cache-control'));
  const unknown = await call('GET', `/public/service-status/${'0'.repeat(32)}`);
  expect('unknown token → 404', unknown.status === 404, `HTTP ${unknown.status}`);
  const junk = await call('GET', `/public/service-status/${encodeURIComponent("x' OR 1=1 --")}`);
  expect('malformed token → 404', junk.status === 404, `HTTP ${junk.status}`);

  // A guessable pre-printed token gets the reduced view.
  await q('UPDATE work_orders SET service_status_token = ? WHERE id = ?', ['WO-QACS1234', woId]);
  const short = await call('GET', '/public/service-status/WO-QACS1234');
  await q('UPDATE work_orders SET service_status_token = ? WHERE id = ?', [token, woId]);
  expect('short token → reduced view: stage, make and model only', short.json?.data?.reduced === true && short.json.data.vehicle?.make === 'Nissan'
    && !short.json.data.vehicle?.plate && !short.json.data.job && !short.json.data.invoice && !short.json.data.estimate, JSON.stringify(short.json?.data?.vehicle));

  // ── Give portal access ──────────────────────────────────────────────
  section = 'portal access';
  let r = await call('GET', `/customers/${cust.id}/portal-access`, advisor);
  expect('status: no portal access', r.json?.data?.status === 'none' && r.json?.data?.can_send === true, JSON.stringify(r.json?.data));
  r = await call('POST', `/customers/${cust.id}/portal-access`, store, { channel: 'link' });
  expect('Storekeeper cannot give access', r.status === 403, `HTTP ${r.status}`);
  r = await call('POST', `/customers/${cust.id}/portal-access`, advisor, { channel: 'whatsapp' });
  expect('advisor gives access by WhatsApp (wa.me link, login created)', r.status === 200 && r.json?.created === true && /^https:\/\/wa\.me\/9715\d{8}\?text=/.test(r.json?.whatsapp_url || '')
    && /\/customer\/set-password\?token=[0-9a-f]{64}$/.test(r.json?.url || ''), `HTTP ${r.status} ${r.json?.url ? r.json.url.replace(/token=.*/, 'token=…') : ''}`);
  const firstLink = r.json?.url;
  r = await call('POST', `/customers/${cust.id}/portal-access`, advisor, { channel: 'link' });
  const link = r.json?.url;
  expect('"Send a new link" replaces the old one', r.status === 200 && r.json?.created === false && link && link !== firstLink && r.json?.data?.status === 'invited');
  const [c1] = await q('SELECT c.is_verified, c.user_id, c.password_hash, c.portal_invited_at, u.role, u.username FROM customers c JOIN users u ON u.id = c.user_id WHERE c.id = ?', [cust.id]);
  expect('a customer login, verified, no password yet', c1?.role === 'customer' && c1.username === `customer_${cust.id}` && c1.is_verified === 1 && !c1.password_hash && !!c1.portal_invited_at);
  const staffView = await call('GET', `/customers/${cust.id}`, advisor);
  expect('staff API never returns the password hash or reset token', staffView.status === 200 && !('password_hash' in staffView.json.data) && !('reset_token' in staffView.json.data));
  const tokenOf = u => new URL(u).searchParams.get('token');
  r = await call('POST', '/customer-auth/reset-password', null, { token: tokenOf(firstLink), new_password: pw });
  expect('the replaced link no longer works', r.status === 400, `HTTP ${r.status}`);
  r = await call('POST', '/customer-auth/login', null, { email: phone, password: pw });
  expect('cannot sign in before choosing a password', r.status === 401, `HTTP ${r.status}`);
  r = await call('POST', '/customer-auth/reset-password', null, { token: tokenOf(link), new_password: pw });
  expect('customer chooses a password from the link', r.status === 200, `HTTP ${r.status}`);
  const local = '0' + phone.slice(4);   // +9715XXXXXXXX → 05XXXXXXXX
  r = await call('POST', '/customer-auth/login', null, { email: local.replace(/(\d{3})(\d{3})(\d+)/, '$1 $2 $3'), password: pw });
  const cTok = r.json?.data?.token;
  expect('signs in with the mobile number, written locally', r.status === 200 && r.json?.data?.customer_id === cust.id, `HTTP ${r.status}`);
  expect('portal sign-in sets no shared auth cookie', !/auth_token=/.test(r.headers.get('set-cookie') || ''));
  r = await call('GET', `/customers/${cust.id}/portal-access`, advisor);
  expect('status: active with the last sign-in', r.json?.data?.status === 'active' && !!r.json?.data?.last_login_at);

  // A second portal customer, to prove the scoping.
  const other = (await call('POST', '/customers', advisor, { full_name: 'QA Status Other', phone: `+97158${rnd7()}`, email: `qa-cs-o-${Date.now()}@example.invalid`, customer_class: 'external', customer_subcategory: 'walkin' })).json?.data;
  const oLink = (await call('POST', `/customers/${other.id}/portal-access`, advisor, { channel: 'link' })).json?.url;
  const oSet = await call('POST', '/customer-auth/reset-password', null, { token: tokenOf(oLink), new_password: pw });
  const oLogin = await call('POST', '/customer-auth/login', null, { email: other.email, password: pw });
  const oTok = oLogin.json?.data?.token;
  expect('a second portal customer sets a password and signs in', oSet.status === 200 && !!oTok, `HTTP ${oSet.status}/${oLogin.status}`);

  // ── The portal ──────────────────────────────────────────────────────
  section = 'portal';
  r = await call('GET', '/customer-portal/service-status', cTok);
  expect('My job cards lists the job with its stages', r.status === 200 && r.json.data.some(j => j.work_order_id === woId && j.stages?.length === 7));
  r = await call('GET', '/customer-portal/service-status', oTok);
  expect("another customer's list does not have it", r.status === 200 && !r.json.data.some(j => j.work_order_id === woId));
  r = await call('GET', `/customer-portal/work-orders/${woId}`, oTok);
  expect("another customer cannot open the job card", r.status === 404, `HTTP ${r.status}`);
  r = await call('GET', '/customer-portal/home', advisor);
  expect('a staff login is refused by the portal', r.status === 403, `HTTP ${r.status}`);
  for (const [m, p] of [['POST', '/customer-portal/work-orders'], ['GET', '/customer-portal/wallet'], ['GET', '/customer-portal/cash-summary'], ['GET', '/customer-portal/saved-addresses'], ['DELETE', `/customer-portal/work-orders/${woId}`]]) {
    r = await call(m, p, cTok, m === 'POST' ? { description: 'x' } : undefined);
    expect(`retired: ${m} ${p.replace(/\d+$/, ':id')} → 410`, r.status === 410, `HTTP ${r.status}`);
  }
  r = await call('GET', '/customer-portal/profile', cTok);
  expect('profile has no secrets', r.status === 200 && !('password_hash' in r.json.data) && !('reset_token' in r.json.data));

  // ── Inspection: sign in the portal, once ────────────────────────────
  section = 'inspection';
  const insp = (await call('POST', '/vehicle-inspections', advisor, { work_order_id: woId, inspection_type: 'intake' })).json?.data;
  await call('PUT', `/vehicle-inspections/${insp.id}`, advisor, { marks: [{ id: 'm1', view: 'front', code: 'PC', x: 0.5, y: 0.4 }] });
  r = await call('PATCH', `/vehicle-inspections/${insp.id}/complete`, advisor, { customer_present: false });
  expect('intake inspection completed without the customer', r.status === 200, `HTTP ${r.status}`);
  expect('stage: Inspection & estimate', (await status())?.stage?.key === 'inspection_estimate');
  r = await call('GET', '/customer-portal/home', cTok);
  expect('Home: "Sign your vehicle inspection"', (r.json?.data?.actions?.sign || []).some(s => s.id === insp.id));
  r = await call('POST', `/customer-portal/inspections/${insp.id}/sign`, oTok, { name: 'Someone', confirmed: true, signature: PNG });
  expect("another customer cannot sign it", r.status === 404, `HTTP ${r.status}`);
  r = await call('POST', `/customer-portal/inspections/${insp.id}/sign`, cTok, { name: 'QA Status Customer', signature: PNG });
  expect('the confirmation is required', r.status === 400 && r.json?.code === 'CONFIRM_REQUIRED', `HTTP ${r.status}`);
  r = await call('POST', `/customer-portal/inspections/${insp.id}/sign`, cTok, { name: 'QA Status Customer', confirmed: true, signature: 'data:image/svg+xml;base64,PHN2Zz4=' });
  expect('an SVG is not a signature', r.status === 400, `HTTP ${r.status}`);
  r = await call('POST', `/customer-portal/inspections/${insp.id}/sign`, cTok, { name: 'QA Status Customer', confirmed: true, signature: PNG });
  expect('the customer signs in the portal', r.status === 200 && r.json?.signature?.signed && r.json.signature.signed_by_name === 'QA Status Customer', `HTTP ${r.status}`);
  r = await call('POST', `/customer-portal/inspections/${insp.id}/sign`, cTok, { name: 'Again', confirmed: true, signature: PNG });
  expect('a second signature is refused (409)', r.status === 409 && r.json?.code === 'ALREADY_SIGNED', `HTTP ${r.status}`);
  const [signed] = await q('SELECT signed_via, signed_by_name, signature_url FROM vehicle_inspections WHERE id = ?', [insp.id]);
  expect('stored once, as signed in the customer portal', signed.signed_via === 'portal' && signed.signed_by_name === 'QA Status Customer' && !!signed.signature_url, signed.signed_via);
  const [note] = await q("SELECT body FROM user_notifications WHERE id > ? AND title LIKE 'Inspection signed by the customer%' ORDER BY id DESC LIMIT 1", [baseline.user_notifications]);
  expect('the workshop is told', /customer portal/.test(note?.body || ''), note?.body);

  // ── Estimate: approve from the portal ───────────────────────────────
  section = 'estimate';
  const est = await call('POST', '/estimates', advisor, { intake_work_order_id: woId, lines: [{ line_type: 'labour', job_name: 'Suspension', description: 'Front suspension check', quantity: 1, unit_price: 200 }] });
  const estId = est.json?.estimateId || est.json?.data?.id;
  r = await call('GET', '/customer-portal/home', cTok);
  expect('a draft estimate is not shown to the customer', !(r.json?.data?.actions?.approve || []).some(e => e.id === estId));
  r = await call('POST', `/estimates/${estId}/send`, manager, { channel: 'whatsapp', format: 'genuine' });
  expect('estimate sent', r.status === 200, `HTTP ${r.status} ${r.json?.code || ''}`);
  let s = await status();
  expect('stage: Your approval, with the estimate number and total', s?.stage?.key === 'approval' && !!s.estimate?.number && s.estimate.total > 0, JSON.stringify(s?.estimate));
  r = await call('GET', '/customer-portal/home', cTok);
  const appr = (r.json?.data?.actions?.approve || []).find(e => e.id === estId);
  expect('Home: "Approve your estimate" with the approval page link', /^\/estimate-approval\/[0-9a-f]+$/.test(appr?.approval_path || ''));
  r = await call('GET', '/customer-portal/home', oTok);
  expect("another customer doesn't see it", !(r.json?.data?.actions?.approve || []).some(e => e.id === estId));
  const approvalToken = (appr?.approval_path || '').split('/').pop();
  const [line] = await q("SELECT id FROM estimate_lines WHERE estimate_id = ? AND line_type <> 'discount' LIMIT 1", [estId]);
  r = await call('POST', `/public/estimates/${approvalToken}/lines/${line.id}/decide`, null, { decision: 'approved', name: 'QA Status Customer' });
  expect('customer approves on the approval page', r.status === 200, `HTTP ${r.status}`);
  s = await status();
  expect('stage: repair (scheduled — approved, not started)', s?.stage?.key === 'repair' && s.stage.detail === 'scheduled', `${s?.stage?.key} ${s?.stage?.detail}`);
  r = await call('GET', '/customer-portal/home', cTok);
  expect('the approve action is gone', !(r.json?.data?.actions?.approve || []).some(e => e.id === estId));

  // ── Cancelled ───────────────────────────────────────────────────────
  section = 'cancelled';
  r = await call('PATCH', `/work-orders/${woId}/status`, manager, { status: 'cancelled', reason: 'QA customer status test', note: 'QA customer status test' });
  s = await status();
  expect('a cancelled job: special "cancelled", nothing current', r.status === 200 && s?.special === 'cancelled' && !s.stages.some(x => x.state === 'current'), `${s?.special} ${(s?.stages || []).map(x => x.state).join(',')}`);
  r = await call('GET', '/customer-portal/service-status', cTok);
  expect('it moves to the closed list', !r.json.data.some(j => j.work_order_id === woId) && (r.json.closed || []).some(j => j.work_order_id === woId && j.special === 'cancelled'));
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
