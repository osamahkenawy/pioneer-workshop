// New Job Card intake (Steps 1–3) and the job card server rules, through the
// API with real role logins: create (C5), edit (C6), workflow Steps 1–2 (C7),
// the technician's view (C8) and who may change a status (C9).
// LOCAL ONLY; every row created is removed by id baseline at the end (the
// roles table is left alone — the demo roles live there).
import { createRequire } from 'module'; import fs from 'fs'; import crypto from 'crypto';
import { fileURLToPath } from 'url';
const BE = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '');
const require = createRequire(BE + '/package.json');
const mysql = require('mysql2/promise'); const bcrypt = require('bcryptjs');
const env = Object.fromEntries(fs.readFileSync(BE + '/.env', 'utf8').split('\n').filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
if (!['localhost', '127.0.0.1'].includes(env.DB_HOST)) throw new Error('local only');
const db = await mysql.createConnection({ host: '127.0.0.1', user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, dateStrings: true });
const q = async (s, p = []) => (await db.query(s, p))[0];
const API = process.env.QA_API || 'http://localhost:4000/api'; // QA_API overrides the API base
const out = []; let section = '';
const expect = (what, ok, detail) => out.push(`${ok ? 'PASS' : 'FAIL'}  [${section}] ${what}${detail !== undefined && detail !== '' ? '  — ' + detail : ''}`);
const call = async (method, path, token, body) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {} return { status: r.status, json: j || {} };
};
const idTables = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema = DATABASE() AND column_name = 'id' AND extra LIKE '%auto_increment%'`))
  .map(r => r.t).filter(t => t !== 'roles');
const baseline = {}; for (const t of idTables) baseline[t] = (await q(`SELECT COALESCE(MAX(id),0) AS m FROM \`${t}\``))[0].m;
const wf = async (tok, id) => (await call('GET', `/workflow/work-orders/${id}`, tok)).json?.data;
const chk = (d, n, key) => d?.steps?.[n - 1]?.checks?.find(c => c.key === key);
const rnd = n => String(crypto.randomInt(0, 10 ** n)).padStart(n, '0');
const phone = () => `+971500${rnd(6)}`;
const vin = () => `ZZXNT${rnd(12)}`; // 17 characters, never I, O or Q
const mainOf = async woId => (await q('SELECT * FROM job_cards WHERE work_order_id = ? AND parent_job_card_id IS NULL', [woId]))[0];
// A 1×1 PNG: the signature pad's image, and a photo of the paper inspection form.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const upload = async (tok, path, name, dataUrl) => {
  const fd = new FormData();
  fd.append('files', new Blob([Buffer.from(dataUrl.split(',')[1], 'base64')], { type: 'image/png' }), name);
  const r = await fetch(API + path, { method: 'POST', headers: { Authorization: `Bearer ${tok}` }, body: fd });
  let j = null; try { j = await r.json(); } catch {} return { status: r.status, json: j || {} };
};

try {
  const pw = 'Qa' + crypto.randomBytes(8).toString('hex') + '1';
  const users = {};
  const mk = async (key, role, slug) => {
    const [r] = slug ? await q('SELECT id FROM roles WHERE slug = ? AND workshop_id = 1', [slug]) : [null];
    const username = `qa_in_${key}_${rnd(4)}`;
    const ins = await q(`INSERT INTO users (workshop_id, full_name, username, email, password, role, role_id, is_active) VALUES (1,?,?,?,?,?,?,1)`,
      [`QA intake ${key}`, username, `${username}@example.invalid`, await bcrypt.hash(pw, 10), role, r?.id || null]);
    const tok = (await call('POST', '/auth/login', null, { username, password: pw })).json?.data?.token;
    users[key] = { id: ins.insertId, tok };
    return tok;
  };
  const advisor = await mk('advisor', 'service_advisor', 'service_advisor');
  const supervisor = await mk('supervisor', 'supervisor', 'supervisor');
  const store = await mk('store', 'part_advisor', 'storekeeper');
  const leader = await mk('leader', 'dispatcher', 'team_leader');
  const manager = await mk('manager', 'workshop_manager', 'workshop_manager');
  const techTok = await mk('tech', 'mechanic');
  const mech = (await q(`INSERT INTO mechanics (workshop_id, user_id, full_name, phone, is_active, status) VALUES (1,?,'QA Intake Technician',?,1,'available')`, [users.tech.id, phone()])).insertId;

  const mkCust = async (tok, body) => (await call('POST', '/customers', tok, { email: `qa-intake-${rnd(6)}@example.invalid`, phone: phone(), ...body })).json?.data;
  const mkVeh = async (customerId, plate) => (await call('POST', '/vehicles', advisor, { customer_id: customerId, make: 'Toyota', model: 'Corolla', year: 2021, plate_number: plate, vin: vin(), mileage: 50000 })).json?.data;
  const walkA = await mkCust(advisor, { full_name: 'QA Intake Walk-in A', customer_class: 'external', customer_subcategory: 'walkin' });
  const walkB = await mkCust(advisor, { full_name: 'QA Intake Walk-in B', customer_class: 'external', customer_subcategory: 'walkin' });
  const extFleet = await mkCust(advisor, { full_name: 'QA Intake Outside Fleet', customer_class: 'external', customer_subcategory: 'fleet' });
  const extIns = await mkCust(advisor, { full_name: 'QA Intake Insurer', customer_class: 'external', customer_subcategory: 'insurance' });
  const internal = await mkCust(manager, { full_name: 'QA Intake Internal Fleet', customer_class: 'internal', customer_subcategory: 'fleet' });
  const inactive = await mkCust(advisor, { full_name: 'QA Intake Deactivated', customer_class: 'external', customer_subcategory: 'walkin' });
  await q('UPDATE customers SET is_active = 0 WHERE id = ?', [inactive.id]);
  const vA = await mkVeh(walkA.id, `QAIN${rnd(3)}A`), vA2 = await mkVeh(walkA.id, `QAIN${rnd(3)}C`), vB = await mkVeh(walkB.id, `QAIN${rnd(3)}B`);
  const vF = await mkVeh(extFleet.id, `QAIN${rnd(3)}F`), vN = await mkVeh(extIns.id, `QAIN${rnd(3)}N`), vI = await mkVeh(internal.id, `QAIN${rnd(3)}I`);
  const job = (extra = {}) => ({ customer_id: walkA.id, vehicle_id: vA.id, description: 'QA intake: brake noise', odometer_in: 61000, payment_method: 'cash', items: [], ...extra });
  const create = (tok, extra) => call('POST', '/work-orders', tok, job(extra));
  const woCount = async customerId => (await q('SELECT COUNT(*) n FROM work_orders WHERE customer_id = ?', [customerId]))[0].n;

  // ── C5 create ──────────────────────────────────────────────────────
  section = 'C5 create';
  let r = await create(advisor, { vehicle_id: vB.id });
  expect("a vehicle of another customer is refused (C5a)", r.status === 400 && r.json.code === 'VEHICLE_NOT_CUSTOMERS', `${r.status} ${r.json.code}`);
  r = await create(advisor, { customer_id: 999999999 });
  const r2 = await create(advisor, { vehicle_id: 999999999 });
  const r3 = await create(advisor, { customer_id: 'abc' });
  expect('unknown customer / vehicle ids are a 400, not a 500 (C5b)', r.status === 400 && r.json.code === 'CUSTOMER_NOT_FOUND' && r2.status === 400 && r2.json.code === 'VEHICLE_NOT_FOUND' && r3.status === 400,
    `${r.status}/${r2.status}/${r3.status}`);
  r = await create(advisor, { customer_id: inactive.id, vehicle_id: null });
  expect('a deactivated customer is refused (C5c)', r.status === 400 && r.json.code === 'CUSTOMER_INACTIVE', `${r.status} ${r.json.code}`);
  r = await create(advisor, { description: '', odometer_in: null, bypass_intake_required: true });
  expect('bypass_intake_required is ignored on the staff route (C5d)', r.status === 400 && r.json.code === 'COMPLAINT_REQUIRED', `${r.status} ${r.json.code}`);
  const odo = [];
  for (const v of ['12.5', '1e5', '-500', 12.9]) odo.push((await create(advisor, { odometer_in: v })).status);
  expect("odometer '12.5', '1e5', '-500', 12.9 refused, not truncated (D8)", odo.every(s => s === 400), odo.join('/'));
  const bad = [];
  for (const extra of [
    { items: [{ name: 'X', quantity: 0, unit_price: 10 }] }, { items: [{ name: 'X', quantity: 1, unit_price: -1 }] },
    { items: [{ name: '', quantity: 1, unit_price: 10 }] }, { service_fee: -5 }, { service_fee: 10, discount: 20 },
    { items: [{ name: 'X', quantity: 99999999, unit_price: 1 }] },
  ]) bad.push((await create(manager, extra)).status);
  expect('qty 0, negative price, unnamed priced line, negative fee, discount > subtotal, absurd qty → 400 (C5e)', bad.every(s => s === 400), bad.join('/'));
  expect('…and none of them left a work order behind (C5f)', await woCount(walkA.id) === 0, `${await woCount(walkA.id)} work orders`);
  r = await create(advisor, { items: [{ name: 'Oil', quantity: 1, unit_price: 50 }] });
  const rf = await create(advisor, { service_fee: 80 });
  expect('advisor: counter lines / fee on a new EXTERNAL job → PRICE_ON_ESTIMATE (C5k)', r.status === 400 && r.json.code === 'PRICE_ON_ESTIMATE' && rf.json.code === 'PRICE_ON_ESTIMATE', `${r.status} ${r.json.code} / ${rf.json.code}`);
  r = await create(advisor, { customer_approval_channel: 'in_person' });
  expect('customer approval with nothing priced is refused (C5l)', r.status === 400 && r.json.code === 'NOTHING_TO_APPROVE', `${r.status} ${r.json.code}`);
  r = await create(supervisor, { customer_id: internal.id, vehicle_id: vI.id, items: [{ name: 'Oil', quantity: 1, unit_price: 50 }], customer_approval_channel: 'phone' });
  expect('approval from a role without customer.approval → 403 (C5l)', r.status === 403 && r.json.code === 'ROLE_NOT_ALLOWED', `${r.status} ${r.json.code}`);
  r = await create(advisor, { intake_channel: 'fleet_link' });
  expect("intake_channel 'fleet_link' is not the advisor's to set (C5h)", r.status === 400 && r.json.code === 'INVALID_INTAKE_CHANNEL', `${r.status} ${r.json.code}`);

  r = await create(advisor, { intake_channel: 'whatsapp', odometer_in: '61,500', customer_name: 'Someone Else', customer_phone: '+971500000000', mechanic_id: mech, service_category: 'bodywork', notes: 'QA intake note', dropoff_address: 'QA intake drop-off' });
  const w1 = r.json.data;
  expect('walk-in job card created', r.status === 201 && !!w1?.id, `${r.status} ${r.json.message || ''}`);
  expect("channel 'whatsapp' recorded (C5h); '61,500' read as 61500", w1?.intake_channel === 'whatsapp' && w1?.odometer_in === 61500, `${w1?.intake_channel} ${w1?.odometer_in}`);
  expect('name / phone snapshot from the customer record, not the body (C5n)', w1?.customer_name === walkA.full_name && w1?.customer_phone === walkA.phone, `${w1?.customer_name} ${w1?.customer_phone}`);
  expect('classification snapshot external / walk-in, payer self_pay (C5i, C5j)', w1?.intake_customer_class === 'external' && w1?.intake_customer_subcategory === 'walkin' && w1?.payer_type === 'self_pay',
    `${w1?.intake_customer_class}/${w1?.intake_customer_subcategory}/${w1?.payer_type}`);
  expect('mechanic_id ignored at create (C5m)', w1?.mechanic_id == null && w1?.status === 'pending', `${w1?.mechanic_id} ${w1?.status}`);
  // External walk-in: the main job card waits for the customer's acknowledgement
  // of the physical inspection (client, 2026-10-29). Here the customer is not at
  // the car and signs from the link.
  expect('external walk-in: no main job card at create — it waits for the physical inspection', !(await mainOf(w1.id)), '');
  const i1 = (await call('POST', '/vehicle-inspections', advisor, { work_order_id: w1.id, inspection_type: 'intake' })).json?.data;
  const c1 = await call('PATCH', `/vehicle-inspections/${i1?.id}/complete`, advisor, { customer_present: false });
  const sh1 = await call('POST', `/vehicle-inspections/${i1?.id}/share`, advisor, { channel: 'link' });
  const linkToken = String(sh1.json?.url || '').split('/').pop();
  let d1 = await wf(advisor, w1.id);
  expect('completed without the customer: still no job card; Step 3 waits for the signature (next await_acknowledgement)',
    c1.status === 200 && c1.json?.job_card?.waiting_for_signature === true && !(await mainOf(w1.id)) && sh1.status === 200 && d1.current_step === 3 && d1.next?.key === 'await_acknowledgement',
    `${c1.status} ${JSON.stringify(c1.json?.job_card)} share ${sh1.status} step ${d1.current_step} next ${d1.next?.key}`);
  const noName = await call('POST', `/public/inspections/${linkToken}/sign`, null, { signature: PNG });
  const s1 = await call('POST', `/public/inspections/${linkToken}/sign`, null, { name: 'QA Intake Walk-in A', signature: PNG });
  const jc1 = await mainOf(w1.id);
  const [log1] = await q("SELECT note FROM work_order_status_logs WHERE work_order_id = ? AND note LIKE 'Main job card%opened%'", [w1.id]);
  expect('the customer signs from the link (name required) → the main job card opens, logged as signed from the link',
    noName.status === 400 && s1.status === 200 && !!jc1 && /signed by the customer from the link/.test(log1?.note || ''), `${noName.status}/${s1.status} ${log1?.note}`);
  expect('…department from the category (bodywork → body_paint), with the plate', jc1?.department === 'body_paint' && jc1?.vehicle_plate === vA.plate_number, JSON.stringify(jc1 && { department: jc1.department, plate: jc1.vehicle_plate }));
  r = await create(advisor, { odometer_in: 40000 });
  const w2 = r.json.data;
  const codes = (r.json.warnings || []).map(w => w.code);
  expect('second job on the same car: OPEN_JOB_CARD and ODOMETER_BELOW_LAST warnings', r.status === 201 && codes.includes('OPEN_JOB_CARD') && codes.includes('ODOMETER_BELOW_LAST'), codes.join(','));
  const pf = (await create(advisor, { customer_id: extFleet.id, vehicle_id: vF.id })).json.data;
  const pn = (await create(advisor, { customer_id: extIns.id, vehicle_id: vN.id })).json.data;
  expect('payer from the classification: outside fleet → fleet, insurer → insurance (C5j)', pf?.payer_type === 'fleet' && pn?.payer_type === 'insurance', `${pf?.payer_type} ${pn?.payer_type}`);
  r = await create(advisor, { customer_id: internal.id, vehicle_id: vI.id, items: [{ name: 'Engine oil', quantity: 2, unit_price: 55 }], service_fee: 100, customer_approval_channel: 'phone', customer_approval_note: 'QA ok' });
  const w4 = r.json.data;
  expect('internal job: counter lines + approval by the advisor; approved total = job total', r.status === 201 && !!w4?.customer_approved_at && Number(w4.customer_approved_total) === Number(w4.total_amount) && w4.payer_type === 'fleet',
    `${r.status} ${w4?.customer_approved_total}/${w4?.total_amount} ${w4?.payer_type}`);
  const logs = await q('SELECT note FROM work_order_status_logs WHERE work_order_id = ? ORDER BY id', [w4.id]);
  expect("history reads 'created' then 'approval recorded'", /created/.test(logs[0]?.note) && /approval/i.test(logs[1]?.note || ''), logs.map(l => l.note).join(' | '));
  const approvedNote = (await q("SELECT COUNT(*) n FROM user_notifications WHERE user_id = ? AND work_order_id = ? AND title LIKE 'Approved:%'", [users.leader.id, w4.id]))[0].n;
  expect('the floor is told the work is approved (not "inspection is next")', approvedNote === 1, `${approvedNote}`);
  r = await create(manager, { items: [{ name: 'Wiper blades', quantity: 1, unit_price: 40 }] });
  const w5 = r.json.data;
  expect('a manager may price an external job at the counter', r.status === 201, `${r.status} ${r.json.code || ''}`);
  // An internal customer's job card opens with the job, so this races the job card numbers too.
  const burst = await Promise.all(Array.from({ length: 12 }, (_, i) => create(advisor, { customer_id: internal.id, vehicle_id: vI.id, odometer_in: 70000 + i })));
  const burstCards = await q('SELECT DISTINCT job_card_number FROM job_cards WHERE parent_job_card_id IS NULL AND work_order_id IN (?)', [burst.map(b => b.json.data?.id || 0)]);
  expect('12 creates at once (internal customer: job card with the job) all get a work order and a distinct job card number (no duplicate-number failures, C5g)',
    burst.every(b => b.status === 201) && burstCards.length === 12,
    `${burstCards.length} job cards; ${burst.map(b => b.status === 201 ? b.status : `${b.status} ${b.json.code || b.json.message || ''}`).join(',')}`);

  // ── C6 edit ────────────────────────────────────────────────────────
  section = 'C6 edit';
  const get = async id => (await call('GET', `/work-orders/${id}`, advisor)).json.data;
  const put = (id, body, tok = advisor) => call('PUT', `/work-orders/${id}`, tok, body);
  let cur = await get(w1.id);
  r = await put(w1.id, { description: 'changed', expected_updated_at: '2000-01-01 00:00:00' });
  expect('a save from an out-of-date copy → 409 STALE_EDIT', r.status === 409 && r.json.code === 'STALE_EDIT', `${r.status} ${r.json.code}`);
  r = await put(w1.id, { description: '  ', expected_updated_at: cur.updated_at });
  expect('the complaint cannot be blanked', r.status === 400 && r.json.code === 'COMPLAINT_REQUIRED', `${r.status} ${r.json.code}`);
  r = await put(w1.id, { odometer_in: 71000, expected_updated_at: cur.updated_at });
  const e1 = r.json.data;
  expect('odometer saved; notes, drop-off, vehicle and channel kept when not sent', r.status === 200 && e1.odometer_in === 71000 && e1.notes === 'QA intake note' && e1.dropoff_address === 'QA intake drop-off'
    && e1.vehicle_id === vA.id && e1.intake_channel === 'whatsapp', `${r.status} ${e1?.odometer_in} ${e1?.notes} ${e1?.vehicle_id}`);
  // w1's customer has signed the walk-around of this car: car and customer are fixed.
  r = await put(w1.id, { vehicle_id: vA2.id, odometer_in: 52000, expected_updated_at: e1.updated_at });
  const rc1 = await put(w1.id, { customer_id: walkB.id, vehicle_id: vB.id, expected_updated_at: e1.updated_at });
  expect('after the customer signed the inspection, vehicle and customer are locked (409, says why)',
    r.status === 409 && r.json.code === 'LOCKED_AFTER_ESTIMATE' && /signed the vehicle inspection/.test(r.json.message || '') && rc1.status === 409,
    `${r.status} ${r.json.code} ${r.json.message || ''} / ${rc1.status}`);
  // Before that, they can change: an internal job (its job card opens with the job) …
  const vI2 = await mkVeh(internal.id, `QAIN${rnd(3)}J`);
  const wI = (await create(advisor, { customer_id: internal.id, vehicle_id: vI.id })).json.data;
  cur = await get(wI.id);
  r = await put(wI.id, { vehicle_id: vI2.id, odometer_in: 52000, expected_updated_at: cur.updated_at });
  const [jcV] = await q('SELECT vehicle_id, vehicle_plate FROM job_cards WHERE work_order_id = ? AND parent_job_card_id IS NULL', [wI.id]);
  expect('vehicle change at intake: the job card follows (plate too)', r.status === 200 && jcV?.vehicle_id === vI2.id && jcV.vehicle_plate === vI2.plate_number, `${r.status} ${JSON.stringify(jcV)}`);
  cur = await get(wI.id);
  r = await put(wI.id, { customer_id: walkB.id, expected_updated_at: cur.updated_at });
  expect("customer change keeping the old customer's car → 400", r.status === 400 && r.json.code === 'VEHICLE_NOT_CUSTOMERS', `${r.status} ${r.json.code}`);
  r = await put(wI.id, { customer_id: walkB.id, vehicle_id: vB.id, odometer_in: 72000, expected_updated_at: cur.updated_at });
  const [jcC] = await q('SELECT customer_id, vehicle_id FROM job_cards WHERE work_order_id = ? AND parent_job_card_id IS NULL', [wI.id]);
  expect('customer change at intake: customer_id, name / phone snapshot and job card all follow', r.status === 200 && r.json.data.customer_id === walkB.id && r.json.data.customer_name === walkB.full_name && jcC?.customer_id === walkB.id && jcC.vehicle_id === vB.id,
    `${r.status} ${r.json.data?.customer_id} ${r.json.data?.customer_name} ${JSON.stringify(jcC)}`);
  // … and an external job whose walk-around is still a draft: the draft follows.
  const vF2 = await mkVeh(extFleet.id, `QAIN${rnd(3)}G`);
  const wX = (await create(advisor, { customer_id: extFleet.id, vehicle_id: vF.id })).json.data;
  const iX = (await call('POST', '/vehicle-inspections', advisor, { work_order_id: wX.id, inspection_type: 'intake' })).json?.data;
  cur = await get(wX.id);
  r = await put(wX.id, { vehicle_id: vF2.id, expected_updated_at: cur.updated_at });
  const [insX] = await q('SELECT vehicle_id, plate_number, vin FROM vehicle_inspections WHERE id = ?', [iX?.id || 0]);
  expect('vehicle change with a draft inspection: the draft follows (car, plate, VIN)',
    r.status === 200 && insX?.vehicle_id === vF2.id && insX.plate_number === vF2.plate_number && insX.vin === vF2.vin, `${r.status} ${JSON.stringify(insX)}`);
  // Who records the inspection: the roles that open job cards (Service Advisor,
  // Supervisor, managers). The Storekeeper and Team Leader may read one.
  const viewS = await call('POST', '/vehicle-inspections', store, { work_order_id: w1.id, inspection_type: 'intake' });
  const putS = await call('PUT', `/vehicle-inspections/${iX?.id}`, store, { notes: 'QA store edit' });
  const photoS = await upload(store, `/vehicle-inspections/${iX?.id}/photos`, 'car.png', PNG);
  const sigL = await call('PATCH', `/vehicle-inspections/${iX?.id}/signature`, leader, { signature: PNG, name: 'QA Leader' });
  const doneL = await call('PATCH', `/vehicle-inspections/${iX?.id}/complete`, leader, { customer_present: false });
  const newL = await call('POST', '/vehicle-inspections', leader, { work_order_id: w2.id, inspection_type: 'joint' });
  const putV = await call('PUT', `/vehicle-inspections/${iX?.id}`, supervisor, { notes: 'QA supervisor note' });
  expect('Storekeeper / Team Leader: read an inspection, but not edit, add photos, sign, complete or start one (403); the Supervisor may',
    viewS.status === 200 && viewS.json.reused === true && [putS, photoS, sigL, doneL, newL].every(x => x.status === 403) && newL.json.code === 'NOT_STARTED' && putV.status === 200,
    `${viewS.status} ${[putS, photoS, sigL, doneL, newL].map(x => x.status).join('/')} ${newL.json.code} sup ${putV.status}`);
  const estLines = [{ job_name: 'Brakes', line_type: 'labour', description: 'Brake labour', quantity: 1, unit_price: 100 }];
  const early = await call('POST', '/estimates', advisor, { intake_work_order_id: w2.id, lines: estLines });
  expect('an external job\'s estimate waits for the acknowledgement (409 PHYSICAL_INSPECTION_REQUIRED)', early.status === 409 && early.json.code === 'PHYSICAL_INSPECTION_REQUIRED', `${early.status} ${early.json.code}`);
  // Paper mode: the walk-around on the paper form, which carries the signature.
  const i2 = (await call('POST', '/vehicle-inspections', advisor, { work_order_id: w2.id, inspection_type: 'intake' })).json?.data;
  const empty = await call('PATCH', `/vehicle-inspections/${i2?.id}/complete`, advisor, {});
  await call('PUT', `/vehicle-inspections/${i2?.id}`, advisor, { entry_mode: 'document' });
  const noDoc = await call('PATCH', `/vehicle-inspections/${i2?.id}/complete`, advisor, {});
  const up = await upload(advisor, `/vehicle-inspections/${i2?.id}/documents`, 'paper-form.png', PNG);
  const c2 = await call('PATCH', `/vehicle-inspections/${i2?.id}/complete`, advisor, {});
  const [log2] = await q("SELECT note FROM work_order_status_logs WHERE work_order_id = ? AND note LIKE 'Main job card%opened%'", [w2.id]);
  expect('paper form: not without the upload (DOCUMENT_REQUIRED); uploaded and completed → the main job card opens, logged as the paper form',
    empty.json.code === 'SIGNATURE_REQUIRED' && noDoc.status === 400 && noDoc.json.code === 'DOCUMENT_REQUIRED' && up.status === 201 && c2.status === 200 && c2.json.job_card?.opened_now === true
    && !!(await mainOf(w2.id)) && /paper form uploaded/.test(log2?.note || ''), `${empty.json.code} ${noDoc.status} ${noDoc.json.code} upload ${up.status} complete ${c2.status} ${log2?.note}`);
  const est = await call('POST', '/estimates', advisor, { intake_work_order_id: w2.id, lines: estLines });
  cur = await get(w2.id);
  r = await put(w2.id, { vehicle_id: vA2.id, odometer_in: 52000, expected_updated_at: cur.updated_at });
  expect('after an estimate the vehicle is locked (409 LOCKED_AFTER_ESTIMATE)', est.status === 201 && r.status === 409 && r.json.code === 'LOCKED_AFTER_ESTIMATE', `${est.status} ${r.status} ${r.json.code}`);
  const items = (await call('GET', `/work-orders/${w4.id}/items`, advisor)).json.data;
  const [mainJc4] = await q('SELECT id FROM job_cards WHERE work_order_id = ? AND parent_job_card_id IS NULL', [w4.id]);
  await q('UPDATE work_order_items SET job_card_id = ? WHERE id = ?', [mainJc4.id, items[0].id]);
  const back = items.map(i => ({ id: i.id, name: i.name, quantity: i.quantity, unit_price: i.unit_price, notes: i.notes }));
  cur = await get(w4.id);
  r = await call('PUT', `/work-orders/${w4.id}/items`, advisor, { items: back, expected_updated_at: '2000-01-01 00:00:00' });
  expect('saving unchanged lines changes nothing (no false STALE_EDIT)', r.status === 200 && r.json.unchanged === true, `${r.status} ${r.json.code || ''}`);
  r = await call('PUT', `/work-orders/${w4.id}/items`, advisor, { items: [{ ...back[0], quantity: 3 }, { name: 'Filter', quantity: 1, unit_price: 20 }], expected_updated_at: cur.updated_at });
  const [kept] = await q('SELECT quantity, job_card_id FROM work_order_items WHERE id = ?', [items[0].id]);
  expect('a changed line keeps its id and job card link; a new line is added', r.status === 200 && Number(kept.quantity) === 3 && kept.job_card_id === mainJc4.id && r.json.data.length === 2,
    `${r.status} ${JSON.stringify(kept)} ${r.json.data?.length}`);
  await call('PATCH', `/work-orders/${w5.id}/status`, manager, { status: 'cancelled', note: 'QA intake' });
  r = await put(w5.id, { description: 'edit a cancelled job' }, manager);
  const ri = await call('PUT', `/work-orders/${w5.id}/items`, manager, { items: [] });
  expect('cancelled job: PUT and PUT /items → 409', r.status === 409 && r.json.code === 'JOB_CLOSED' && ri.status === 409, `${r.status}/${ri.status}`);

  // ── C7 workflow ────────────────────────────────────────────────────
  section = 'C7 workflow';
  let d = await wf(advisor, pf.id);
  expect('new external job: Steps 1–2 done; Step 3 "Physical inspection & job card" current, the acknowledgement open',
    d.steps.slice(0, 2).every(s => s.state === 'done') && d.current_step === 3 && d.steps[2].title === 'Physical inspection & job card' && chk(d, 3, 'physical_ack')?.done === false
    && d.steps[3].title === 'Technical inspection & pricing' && d.next?.key === 'physical_inspection', `${d.steps.map(s => `${s.n}:${s.state}`).join(' ')} next ${d.next?.key}`);
  d = await wf(advisor, w2.id);
  expect('acknowledged on paper: Steps 1–3 done (snapshot, complaint + odometer + VIN, "Paper form uploaded")',
    d.steps.slice(0, 3).every(s => s.state === 'done') && chk(d, 2, 'vin')?.done && chk(d, 3, 'physical_ack')?.detail === 'Paper form uploaded', `${d.steps.map(s => `${s.n}:${s.state}`).join(' ')} ${chk(d, 3, 'physical_ack')?.detail}`);
  r = await call('PUT', `/customers/${walkA.id}`, manager, { customer_class: 'external', customer_subcategory: 'fleet' });
  d = await wf(advisor, w2.id);
  expect('reclassifying the customer does not rewrite the job\'s Step 1', r.status === 200 && d.work_order.customer_subcategory === 'walkin', `${r.status} ${d.work_order.customer_subcategory}`);
  // Step 2 is the vehicle and the reported issue (the process document). The
  // odometer is optional (the client, 13 Oct) and the VIN is recorded when
  // known: both show as open checks without holding the step.
  await q('UPDATE work_orders SET odometer_in = NULL WHERE id = ?', [w2.id]);
  d = await wf(advisor, w2.id);
  expect('no odometer: the odometer check reads "Not recorded" and does not hold Step 2', d.steps[1].state === 'done' && chk(d, 2, 'odometer')?.done === false
    && chk(d, 2, 'odometer')?.detail === 'Not recorded' && !/odometer/i.test(d.next?.text || ''), `${d.steps[1].state} ${chk(d, 2, 'odometer')?.detail} / next: ${d.next?.text}`);
  await q('UPDATE vehicles SET vin = NULL WHERE id = ?', [vA.id]);
  d = await wf(advisor, w2.id);
  expect('no VIN: the VIN check is open ("No VIN on file") and does not hold Step 2', d.steps[1].state === 'done' && chk(d, 2, 'vin')?.done === false
    && chk(d, 2, 'vin')?.detail === 'No VIN on file' && !/VIN/.test(d.next?.text || ''), `${d.steps[1].state} ${chk(d, 2, 'vin')?.detail} / next: ${d.next?.text}`);
  d = await wf(advisor, w5.id);
  expect('external job priced by the Workshop Manager: Supervisor / WM approval ticked', chk(d, 5, 'manager_approval')?.done, chk(d, 5, 'manager_approval')?.detail);
  await q("UPDATE work_order_status_logs SET changed_by = ? WHERE work_order_id = ? AND note = 'Work order created'", [users.advisor.id, w5.id]);
  d = await wf(advisor, w5.id);
  expect('external job priced at the counter by an advisor (legacy): approval, inspection and Storekeeper pricing NOT ticked',
    !chk(d, 5, 'manager_approval').done && !chk(d, 4, 'technical_inspection').done && !chk(d, 4, 'parts_priced').done, '');

  // ── C8 technician ──────────────────────────────────────────────────
  section = 'C8 technician';
  r = await call('PATCH', `/work-orders/${w4.id}/assign-mechanic`, leader, { mechanic_id: mech });
  const note = (await q("SELECT body FROM user_notifications WHERE work_order_id = ? AND body LIKE '%assigned to work order%' ORDER BY id DESC LIMIT 1", [w4.id]))[0]?.body || '';
  expect('Team Leader assigns; the notice names the work order (not "undefined")', r.status === 200 && !/undefined/.test(note), note);
  // The technician works from the technician app (My Jobs: /job-cards/mine),
  // not from the staff work order API.
  const mine = await call('GET', '/job-cards/mine', techTok);
  const mineWos = [...new Set((mine.json.jobCards || []).map(c => c.work_order_id))];
  expect('My Jobs lists only their own job', mine.status === 200 && mineWos.length === 1 && mineWos[0] === w4.id, `${mine.status} work orders [${mineWos}]`);
  const [jc2] = await q('SELECT id FROM job_cards WHERE work_order_id = ? AND parent_job_card_id IS NULL', [w2.id]);
  const [jc4] = await q('SELECT id FROM job_cards WHERE work_order_id = ? AND parent_job_card_id IS NULL', [w4.id]);
  const other = await call('GET', `/job-cards/mine/${jc2.id}`, techTok);
  const own = await call('GET', `/job-cards/mine/${jc4.id}`, techTok);
  expect("someone else's job card → 404, their own → 200", other.status === 404 && own.status === 200, `${other.status}/${own.status}`);
  const staff = await Promise.all(['/work-orders?limit=200', `/work-orders/${w4.id}`, `/work-orders/${w2.id}`, '/work-orders/stats'].map(p => call('GET', p, techTok)));
  expect('the staff work order list, any work order (their own too) and workshop stats → 403', staff.every(x => x.status === 403), staff.map(x => x.status).join('/'));

  // ── C9 status roles ────────────────────────────────────────────────
  section = 'C9 status';
  const st = async (tok, id, status) => (await call('PATCH', `/work-orders/${id}/status`, tok, { status, note: 'QA intake' })).status;
  const storeCancel = await st(store, pf.id, 'cancelled');
  const storeStart = await st(store, pf.id, 'in_progress');
  const leaderConfirm = await st(leader, pf.id, 'confirmed');
  const techCancel = await st(techTok, pf.id, 'cancelled');
  expect('Storekeeper cannot cancel or start; Team Leader cannot confirm; technician cannot cancel', [storeCancel, storeStart, leaderConfirm, techCancel].every(s => s === 403),
    [storeCancel, storeStart, leaderConfirm, techCancel].join('/'));
  const advCancel = await st(advisor, pf.id, 'cancelled');
  const advReopen = await st(advisor, pf.id, 'pending');
  expect('Service Advisor can cancel and reopen (job.open)', advCancel === 200 && advReopen === 200, `${advCancel}/${advReopen}`);
  r = await call('PATCH', `/work-orders/${pn.id}/customer-approval`, advisor, { channel: 'in_person' });
  expect('approval on a job with nothing priced → 409 NOTHING_TO_APPROVE', r.status === 409 && r.json.code === 'NOTHING_TO_APPROVE', `${r.status} ${r.json.code}`);

  // ── C10 approved before the physical inspection ────────────────────
  // An external job priced and agreed at the counter (a manager) before the
  // walk-around: approved, but no job card — nothing for the floor yet.
  section = 'C10 inspection first';
  r = await create(manager, { customer_id: extIns.id, vehicle_id: vN.id, items: [{ name: 'Wiper blades', quantity: 1, unit_price: 40 }], customer_approval_channel: 'in_person' });
  const w6 = r.json.data;
  const flag = (await call('GET', `/work-orders/${w6?.id}`, advisor)).json.data;
  const listed = (await call('GET', `/work-orders?search=${encodeURIComponent(w6?.work_order_number || '')}`, advisor)).json.data?.find(x => x.id === w6?.id);
  expect('approved at the counter, no job card: marked awaiting_physical_inspection on the job and in the list ("Approved — physical inspection first")',
    r.status === 201 && !!w6.customer_approved_at && !(await mainOf(w6.id)) && Number(flag?.awaiting_physical_inspection) === 1 && Number(listed?.awaiting_physical_inspection) === 1
    && Number((await call('GET', `/work-orders/${w4.id}`, advisor)).json.data?.awaiting_physical_inspection) === 0,
    `${r.status} ${r.json.code || ''} flag ${flag?.awaiting_physical_inspection}/${listed?.awaiting_physical_inspection}`);
  const [floorNote] = await q("SELECT body FROM user_notifications WHERE user_id = ? AND work_order_id = ? AND title LIKE 'Approved:%'", [users.leader.id, w6.id]);
  expect('the floor is told the job card opens after the acknowledgement (not "ready to assign")', /opens once the customer has acknowledged the physical inspection/.test(floorNote?.body || '') && !/Ready for the Team Leader/.test(floorNote?.body || ''), floorNote?.body);
  const asg1 = await call('PATCH', `/work-orders/${w6.id}/assign-mechanic`, leader, { mechanic_id: mech });
  const asg2 = await call('POST', '/team-leader/assign', leader, { work_order_id: w6.id, mechanic_id: mech });
  const asg3 = await call('POST', '/job-assignment/assign', manager, { work_order_id: w6.id, mechanic_id: mech });
  const conf = await call('PATCH', `/work-orders/${w6.id}/status`, manager, { status: 'confirmed', note: 'QA intake' });
  const start = await call('PATCH', `/work-orders/${w6.id}/status`, manager, { status: 'in_progress', note: 'QA intake' });
  const [w6row] = await q('SELECT status, mechanic_id FROM work_orders WHERE id = ?', [w6.id]);
  expect('no technician can be assigned (job card, Team Board, Job Assignment) and work cannot start: 409 PHYSICAL_INSPECTION_REQUIRED; nothing changed',
    [asg1, asg2, asg3, start].every(x => x.status === 409 && x.json.code === 'PHYSICAL_INSPECTION_REQUIRED') && conf.status === 200 && w6row.mechanic_id == null && w6row.status === 'confirmed',
    `${[asg1, asg2, asg3, start].map(x => `${x.status} ${x.json.code || ''}`).join(' / ')} · ${w6row.status} ${w6row.mechanic_id}`);
  const leaderTasks = (await call('GET', '/workflow/my-tasks', leader)).json.data;
  const advTasks = (await call('GET', '/workflow/my-tasks', advisor)).json.data;
  expect('"Your tasks": not in the Team Leader\'s "Assign a technician"; in the Service Advisor\'s "Physical inspection"',
    !(leaderTasks?.groups.find(g => g.kind === 'assign')?.items || []).some(i => i.id === w6.id)
    && (advTasks?.groups.find(g => g.kind === 'physical_inspection')?.items || []).some(i => i.id === w6.id), '');
  const i6 = (await call('POST', '/vehicle-inspections', advisor, { work_order_id: w6.id, inspection_type: 'intake' })).json?.data;
  await call('PATCH', `/vehicle-inspections/${i6?.id}/signature`, advisor, { signature: PNG, name: 'QA Intake Insurer' });
  const c6 = await call('PATCH', `/vehicle-inspections/${i6?.id}/complete`, advisor, {});
  const asg4 = await call('PATCH', `/work-orders/${w6.id}/assign-mechanic`, leader, { mechanic_id: mech });
  const jc6 = await mainOf(w6.id);
  expect('acknowledged at the car → the job card opens; now the technician can be assigned, and the job card follows', c6.json.job_card?.opened_now === true && asg4.status === 200 && jc6?.mechanic_id === mech,
    `${c6.status} ${JSON.stringify(c6.json.job_card)} assign ${asg4.status} ${asg4.json.code || asg4.json.message || ''}`);

  // ── C11 the fleet coordinator link ─────────────────────────────────
  // The work order opens when the coordinator submits (Received via the fleet
  // link); "Book in" works on that one. An internal fleet skips the physical inspection.
  section = 'C11 fleet link';
  const fleetJob = async (customer, plate) => {
    const v = await mkVeh(customer.id, plate);
    const link = await call('POST', '/fleet-intake/links', advisor, { customer_id: customer.id, label: 'QA intake fleet link' });
    const sub = await call('POST', `/public/fleet-intake/${link.json.data?.token}`, null, { plate_number: v.plate_number, vin: v.vin, odometer: 81000, complaint: 'QA fleet: brakes grinding' });
    const [req] = await q('SELECT id, work_order_id FROM fleet_intake_requests WHERE id = ?', [sub.json.data?.id || 0]);
    const [w] = await q('SELECT id, intake_channel, status, customer_id, vehicle_id FROM work_orders WHERE id = ?', [req?.work_order_id || 0]);
    return { v, link, sub, req, w };
  };
  const ef = await fleetJob(extFleet, `QAIN${rnd(3)}G`);
  expect('external fleet: the submission opens its work order (Received via the fleet link, on the fleet\'s car); no job card yet',
    ef.link.status === 201 && ef.sub.status === 201 && ef.w?.intake_channel === 'fleet_link' && ef.w.status === 'pending' && ef.w.customer_id === extFleet.id && ef.w.vehicle_id === ef.v.id && !(await mainOf(ef.w.id)),
    `link ${ef.link.status} submit ${ef.sub.status} ${ef.sub.json.message || ''} · ${ef.w?.intake_channel} ${ef.w?.status}`);
  await call('POST', `/fleet-intake/${ef.req.id}/review`, advisor, { decision: 'accepted' });
  const bookIn = await call('POST', `/fleet-intake/${ef.req.id}/convert`, advisor, {});
  const [{ n: efWos }] = await q('SELECT COUNT(*) n FROM work_orders WHERE vehicle_id = ?', [ef.v.id]);
  expect('"Book in" reuses that work order (200 reused) — no second one; the physical inspection is next',
    bookIn.status === 200 && bookIn.json.reused === true && bookIn.json.data?.work_order_id === ef.w.id && Number(efWos) === 1 && (await wf(advisor, ef.w.id))?.next?.key === 'physical_inspection',
    `HTTP ${bookIn.status} reused ${bookIn.json.reused} · ${efWos} work order(s)`);
  const inf = await fleetJob(internal, `QAIN${rnd(3)}H`);
  expect('internal fleet: the submission\'s work order has its main job card at once (no physical inspection)', inf.sub.status === 201 && inf.w?.intake_channel === 'fleet_link' && !!(await mainOf(inf.w?.id)),
    `submit ${inf.sub.status} ${inf.sub.json.message || ''} · ${inf.w?.intake_channel}`);
} catch (e) { out.push('ERROR ' + e.stack); }
finally {
  // Files of the inspections made here: signature images and the uploaded paper form.
  for (const row of await q('SELECT signature_url, documents, photos FROM vehicle_inspections WHERE id > ?', [baseline.vehicle_inspections])) {
    if (/^\/uploads\/signatures\/sig_insp\d+_[\w-]+\.png$/.test(row.signature_url || '')) fs.rmSync(BE + row.signature_url, { force: true });
    for (const f of [row.documents, row.photos].flatMap(j => { try { return (typeof j === 'string' ? JSON.parse(j) : j) || []; } catch { return []; } })) {
      if (/^[\w.-]+$/.test(f?.file || '')) fs.rmSync(`${BE}/private-uploads/inspections/${f.file}`, { force: true });
    }
  }
  await q('SET FOREIGN_KEY_CHECKS = 0'); const removed = {};
  for (const t of idTables) { const r = await q(`DELETE FROM \`${t}\` WHERE id > ?`, [baseline[t]]); if (r.affectedRows) removed[t] = r.affectedRows; }
  await q('SET FOREIGN_KEY_CHECKS = 1'); await db.end();
  console.log(out.join('\n'));
  console.log(`\n${out.filter(l => l.startsWith('PASS')).length} passed, ${out.filter(l => l.startsWith('FAIL')).length} failed · cleanup ${Object.keys(removed).length} tables`);
  process.exit(0);
}
