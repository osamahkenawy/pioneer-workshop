// Client feedback of 18 Nov 2026, through the API with real role logins.
// LOCAL ONLY; every row created is removed by id baseline at the end, and the
// two Settings values it changes are put back.
//   point 2  — the customer list's stage filter and its enquiry fields
//   point 4  — the supplementary estimate's fixed cost (Settings, priced by the
//              server, never a technician's job)
//   point 6  — the inspection link sends the customer's name for the sign form
//   point 3/7— Step 3's title names the Inspection job card
import { createRequire } from 'module'; import fs from 'fs'; import crypto from 'crypto';
import { fileURLToPath } from 'url';
const BE = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const require = createRequire(BE + '/package.json');
const mysql = require('mysql2/promise'); const bcrypt = require('bcryptjs');
const env = Object.fromEntries(fs.readFileSync(BE + '/.env', 'utf8').split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
if (!['localhost', '127.0.0.1'].includes(env.DB_HOST)) throw new Error('local only');
const db = await mysql.createConnection({ host: '127.0.0.1', user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME });
const q = async (s, p = []) => (await db.query(s, p))[0];
const API = process.env.QA_API || 'http://localhost:4000/api';
const out = []; let section = '';
const expect = (what, ok, detail) => out.push(`${ok ? 'PASS' : 'FAIL'}  [${section}] ${what}${detail !== undefined && detail !== '' ? '  — ' + detail : ''}`);
const call = async (method, path, token, body) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {} return { status: r.status, json: j };
};
const n = v => Math.round(Number(v) * 100) / 100;
const idTables = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema = DATABASE() AND column_name = 'id' AND extra LIKE '%auto_increment%'`)).map(r => r.t)
  .filter(t => t !== 'roles');
const baseline = {}; for (const t of idTables) baseline[t] = (await q(`SELECT COALESCE(MAX(id),0) AS m FROM \`${t}\``))[0].m;
// The Settings rows this suite changes, as they were.
const FEE_KEYS = ['supplementary_fixed_cost', 'supplementary_fixed_cost_label'];
const savedSettings = await q('SELECT `key`, `value`, `type` FROM settings WHERE workshop_id = 1 AND `key` IN (?, ?)', FEE_KEYS);

try {
  const pw = 'Qa' + crypto.randomBytes(8).toString('hex') + '1';
  const mk = async (key, role, slug) => {
    const [r] = slug ? await q('SELECT id FROM roles WHERE slug = ? AND workshop_id = 1', [slug]) : [null];
    const username = `qa_fb_${key}`;
    await q(`INSERT INTO users (workshop_id, full_name, username, email, password, role, role_id, is_active) VALUES (1,?,?,?,?,?,?,1)`,
      [`QA ${key}`, username, `${username}@example.invalid`, await bcrypt.hash(pw, 10), role, r?.id || null]);
    return (await call('POST', '/auth/login', null, { username, password: pw })).json?.data?.token;
  };
  const advisor = await mk('advisor', 'service_advisor', 'service_advisor');
  const supervisor = await mk('supervisor', 'supervisor', 'supervisor');
  const manager = await mk('manager', 'workshop_manager', 'workshop_manager');

  // ── Point 2: one list for customers and enquiries ─────────────────
  section = '2 stage';
  const all = await call('GET', '/customers?limit=1', advisor);
  const enq = await call('GET', '/customers?limit=5&stage=enquiry', advisor);
  const bad = await call('GET', '/customers?stage=nope', advisor);
  const stats = await call('GET', '/customers/stats', advisor);
  expect('GET /customers carries the enquiry fields; stage=enquiry lists only customers with an open enquiry; a bad stage is 400; stats count them',
    all.status === 200 && 'open_enquiries' in (all.json?.data?.[0] || {}) && enq.status === 200
    && (enq.json?.data || []).every(c => Number(c.open_enquiries) > 0 && ['new', 'quoted', 'nurture'].includes(c.enquiry_status))
    && bad.status === 400 && Number.isInteger(stats.json?.data?.open_enquiries) && Number(stats.json.data.open_enquiries) === Number(enq.json?.total),
    `all ${all.status} · enquiry ${enq.status} (${enq.json?.total}) · bad ${bad.status} · stats ${stats.json?.data?.open_enquiries}`);
  const walk = (await call('POST', '/customers', advisor, { full_name: 'QA FB Walk-in', phone: '+971500000771', email: 'qa-fb@example.invalid', customer_class: 'external', customer_subcategory: 'walkin', emirate: 'Dubai' })).json?.data;
  const newEnq = await call('POST', '/enquiries', advisor, { customer_id: walk.id, contact_name: walk.full_name, contact_phone: walk.phone, emirate: 'Dubai',
    source_channel: 'passing_local', contact_method: 'walk_in', parts_preference: ['genuine'], description: 'QA brakes', follow_up_at: '2020-01-01 10:00:00' });
  const due = await call('GET', `/customers?stage=due&search=${encodeURIComponent('QA FB Walk-in')}`, advisor);
  const row = due.json?.data?.[0];
  expect('an enquiry logged on a customer (customer_id) is theirs: the list shows it under "Follow-ups due" with its number and status',
    newEnq.status === 201 && Number(newEnq.json?.data?.customer_id) === walk.id && row?.id === walk.id && row.enquiry_number === newEnq.json.data.enquiry_number && row.enquiry_status === 'new',
    `enquiry ${newEnq.status} · due ${due.status} ${row?.enquiry_number || '—'}`);

  // ── Point 4: the supplementary estimate's fixed cost ──────────────
  section = '4 fixed cost';
  const setFee = await call('PUT', '/settings', manager, { settings: { supplementary_fixed_cost: 150, supplementary_fixed_cost_label: 'QA technical report' } });
  const fleet = (await call('POST', '/customers', manager, { full_name: 'QA FB Fleet', phone: '+971500000772', email: 'qa-fb-fleet@example.invalid', customer_class: 'internal', customer_subcategory: 'fleet' })).json?.data;
  const veh = (await call('POST', '/vehicles', advisor, { customer_id: fleet.id, make: 'Nissan', model: 'Sunny', year: 2020, plate_emirate: 'Dubai', plate_number: 'QAFB01', vin: 'TSTFBA00000000001' })).json?.data;
  const woId = (await call('POST', '/work-orders', advisor, { customer_id: fleet.id, vehicle_id: veh.id, customer_name: fleet.full_name, customer_phone: fleet.phone, description: 'Noise', odometer_in: 1000, payment_method: 'credit', items: [] })).json?.data?.id;
  const ti = (await call('POST', '/technical-inspections', supervisor, { work_order_id: woId })).json?.data;
  await call('PUT', `/technical-inspections/${ti?.id}`, supervisor, { service_lines: [{ job: 'QA check', service_type: 'repair', labour: 'As found', hours: 1, parts: [] }] });
  const tiDone = await call('PATCH', `/technical-inspections/${ti?.id}/complete`, supervisor, {});
  const rc = await call('GET', `/estimates/raise-check?work_order_id=${woId}&kind=supplementary`, advisor);
  expect('raise-check offers the fixed cost from Settings and says the main estimate is empty',
    setFee.status === 200 && tiDone.status === 200 && rc.json?.data?.ok === true && n(rc.json.data.fixed_fee?.amount) === 150
    && rc.json.data.fixed_fee?.label === 'QA technical report' && rc.json.data.main_empty === true,
    `settings ${setFee.status} · ti ${tiDone.status} · ${JSON.stringify({ ok: rc.json?.data?.ok, code: rc.json?.data?.code, fee: rc.json?.data?.fixed_fee, empty: rc.json?.data?.main_empty })}`);
  // The request's price, quantity and wording are ignored: the server's come from Settings.
  const sest = await call('POST', '/estimates', advisor, { intake_work_order_id: woId, kind: 'supplementary', parts_preference: 'genuine',
    lines: [{ is_fixed_fee: true, line_type: 'parts', description: 'tampered', job_name: 'x', quantity: 9, unit_price: 1 }] });
  const sestId = sest.json?.estimateId || sest.json?.data?.id;
  const [fl] = sestId ? await q('SELECT * FROM estimate_lines WHERE estimate_id = ?', [sestId]) : [];
  expect('a supplementary estimate with only the fixed cost: one labour line, AED 150 × 1, worded from Settings, marked is_fixed_fee',
    sest.status === 201 && !!fl && fl.line_type === 'labour' && n(fl.unit_price) === 150 && n(fl.quantity) === 1 && fl.description === 'QA technical report'
    && fl.job_name === 'QA technical report' && Number(fl.is_fixed_fee) === 1,
    `HTTP ${sest.status} ${sest.json?.message || ''} · ${fl ? `${fl.line_type} ${fl.quantity}×${fl.unit_price} "${fl.description}" fee=${fl.is_fixed_fee}` : 'no line'}`);
  const main = await call('POST', '/estimates', advisor, { intake_work_order_id: woId, kind: 'main',
    lines: [{ job_name: 'QA check', line_type: 'labour', description: 'Check', quantity: 1, unit_price: 100 }, { is_fixed_fee: true, line_type: 'labour', description: 'sneaky', quantity: 1, unit_price: 5 }] });
  const mainId = main.json?.estimateId || main.json?.data?.id;
  const mainLines = mainId ? await q('SELECT description, is_fixed_fee FROM estimate_lines WHERE estimate_id = ?', [mainId]) : [];
  expect('a main estimate never carries the fixed cost (the flagged line is dropped)',
    main.status === 201 && mainLines.length === 1 && mainLines[0].description === 'Check' && Number(mainLines[0].is_fixed_fee) === 0,
    `HTTP ${main.status} ${main.json?.message || ''} · ${mainLines.map(l => l.description).join(', ')}`);
  // The customer approves it with consent (157.50 incl. 5% VAT); it is a charge, not a job.
  const sent = await call('POST', `/estimates/${sestId}/send`, advisor, { format: 'genuine', channel: 'whatsapp' });
  const [{ approval_token: tok } = {}] = await q('SELECT approval_token FROM service_estimates WHERE id = ?', [sestId]);
  const ok = await call('POST', `/public/estimates/${tok}/decide-bulk`, null, { decision: 'approved', name: 'QA FB Fleet',
    consent: { agreed: true, name: 'QA FB Fleet', amount: 157.5 } });
  await new Promise(r => setTimeout(r, 300));
  await call('GET', `/job-tasks?work_order_id=${woId}`, manager); // reads (and syncs) the jobs
  const items = await q('SELECT name, item_type, unit_price FROM work_order_items WHERE work_order_id = ?', [woId]);
  const tasks = await q("SELECT job_name FROM job_card_tasks WHERE work_order_id = ? AND status <> 'cancelled'", [woId]);
  expect('approved with consent: the fixed cost is on the work order, and no technician job is made for it',
    sent.status === 200 && ok.status === 200 && items.some(i => /QA technical report/.test(i.name) && n(i.unit_price) === 150) && !tasks.some(x => /QA technical report/i.test(x.job_name)),
    `send ${sent.status} ${sent.json?.message || ''} · decide ${ok.status} ${ok.json?.message || ''} · items ${items.map(i => i.name).join(' | ')} · jobs ${tasks.map(x => x.job_name).join(' | ') || 'none'}`);

  // ── Point 6: the name on the inspection link ──────────────────────
  section = '6 inspection name';
  const veh2 = (await call('POST', '/vehicles', advisor, { customer_id: walk.id, make: 'Toyota', model: 'Corolla', year: 2021, plate_emirate: 'Dubai', plate_number: 'QAFB02', vin: 'TSTFBA00000000002' })).json?.data;
  const wo2 = (await call('POST', '/work-orders', advisor, { customer_id: walk.id, vehicle_id: veh2.id, customer_name: walk.full_name, customer_phone: walk.phone, description: 'Check', odometer_in: 500, payment_method: 'cash', items: [] })).json?.data?.id;
  const insp = (await call('POST', '/vehicle-inspections', advisor, { work_order_id: wo2, inspection_type: 'intake' })).json?.data;
  const token = crypto.randomBytes(24).toString('hex');
  await q('UPDATE vehicle_inspections SET share_token = ? WHERE id = ?', [token, insp?.id]);
  const pub = await call('GET', `/public/inspections/${token}`, null);
  expect('the customer\'s inspection link carries their name for the sign form',
    pub.status === 200 && pub.json?.inspection?.customer_name === 'QA FB Walk-in', `HTTP ${pub.status} · ${pub.json?.inspection?.customer_name}`);

  // ── Points 3 / 7: the Inspection job card ─────────────────────────
  section = '3 naming';
  const d = (await call('GET', `/workflow/work-orders/${wo2}`, advisor)).json?.data;
  expect('Step 3 reads "Physical inspection & Inspection job card"; Step 2 asks for things on the work order, not a job card',
    d?.steps?.[2]?.title === 'Physical inspection & Inspection job card', `${d?.steps?.[2]?.title}`);
} catch (e) { out.push('ERROR ' + e.stack); }
finally {
  await q('SET FOREIGN_KEY_CHECKS = 0'); const removed = {};
  for (const t of idTables) { const r = await q(`DELETE FROM \`${t}\` WHERE id > ?`, [baseline[t]]); if (r.affectedRows) removed[t] = r.affectedRows; }
  await q('SET FOREIGN_KEY_CHECKS = 1');
  // Settings back as they were (a row this suite added is gone with the baseline when it has an id; else by key).
  await q('DELETE FROM settings WHERE workshop_id = 1 AND `key` IN (?, ?)', FEE_KEYS);
  for (const s of savedSettings) await q('INSERT INTO settings (workshop_id, `key`, `value`, `type`) VALUES (1, ?, ?, ?)', [s.key, s.value, s.type]);
  await db.end();
  console.log(out.join('\n'));
  console.log(`\n${out.filter(l => l.startsWith('PASS')).length} passed, ${out.filter(l => l.startsWith('FAIL')).length} failed · cleanup ${Object.keys(removed).length} tables`);
  process.exit(0);
}
