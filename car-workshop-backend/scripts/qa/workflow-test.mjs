// Workshop workflow Steps 1–7, end to end, through the API with real role logins.
// LOCAL ONLY; every row created is removed by id baseline at the end.
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
const out = []; let section = '';
const expect = (what, ok, detail) => out.push(`${ok ? 'PASS' : 'FAIL'}  [${section}] ${what}${detail !== undefined && detail !== '' ? '  — ' + detail : ''}`);
const call = async (method, path, token, body) => {
  const r = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch {} return { status: r.status, json: j };
};
const n = v => Math.round(Number(v) * 100) / 100;
const idTables = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema = DATABASE() AND column_name = 'id' AND extra LIKE '%auto_increment%'`)).map(r => r.t)
  .filter(t => t !== 'roles'); // never cleaned up by id: the seeded / demo roles live there
const baseline = {}; for (const t of idTables) baseline[t] = (await q(`SELECT COALESCE(MAX(id),0) AS m FROM \`${t}\``))[0].m;
const notesFor = async (userId, like) => (await q('SELECT title FROM user_notifications WHERE user_id = ? AND id > ? AND title LIKE ?', [userId, baseline.user_notifications, like])).length;
const wf = async (tok, id) => (await call('GET', `/workflow/work-orders/${id}`, tok)).json?.data;
// Customer messages are sent after the API answers (non-blocking): poll briefly.
const waitFor = async (fn, ms = 4000) => { const end = Date.now() + ms; let v; do { v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, 150)); } while (Date.now() < end); return v; };
const custMsgs = async (woId, type) => q('SELECT template_key, message, recipient_email FROM notifications WHERE work_order_id = ? AND type = ? AND id > ? ORDER BY id', [woId, type, baseline.notifications]);
const stepStates = d => d.steps.map(s => `${s.n}:${s.state}`).join(' ');
const chk = (d, n, key) => d?.steps?.[n - 1]?.checks?.find(c => c.key === key);
const mainOf = async woId => (await q('SELECT * FROM job_cards WHERE work_order_id = ? AND parent_job_card_id IS NULL', [woId]))[0];
// A 1×1 PNG, as the signature pad would send.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

try {
  const pw = 'Qa' + crypto.randomBytes(8).toString('hex') + '1';
  const users = {};
  const mk = async (key, role, slug) => {
    const [r] = slug ? await q('SELECT id FROM roles WHERE slug = ? AND workshop_id = 1', [slug]) : [null];
    const username = `qa_wf_${key}`;
    const ins = await q(`INSERT INTO users (workshop_id, full_name, username, email, password, role, role_id, is_active) VALUES (1,?,?,?,?,?,?,1)`,
      [`QA ${key}`, username, `${username}@example.invalid`, await bcrypt.hash(pw, 10), role, r?.id || null]);
    const tok = (await call('POST', '/auth/login', null, { username, password: pw })).json?.data?.token;
    users[key] = { id: ins.insertId, tok };
    return tok;
  };
  const advisor = await mk('advisor', 'service_advisor', 'service_advisor');
  const store = await mk('store', 'part_advisor', 'storekeeper');
  const supervisor = await mk('supervisor', 'supervisor', 'supervisor');
  const leader = await mk('leader', 'dispatcher', 'team_leader');
  const mechTok = await mk('tech', 'mechanic');
  const mech = (await q(`INSERT INTO mechanics (workshop_id, user_id, full_name, phone, is_active, status, team_leader_id) VALUES (1,?,'QA WF Technician','+971500000555',1,'available',?)`, [users.tech.id, users.leader.id])).insertId;
  const mech2 = (await q(`INSERT INTO mechanics (workshop_id, full_name, phone, is_active, status, team_leader_id) VALUES (1,'QA WF Body Tech','+971500000556',1,'available',?)`, [users.leader.id])).insertId;

  // ── Steps 1–3 ──────────────────────────────────────────────────────
  section = '1-3 intake';
  const cust = (await call('POST', '/customers', advisor, { full_name: 'QA WF Walk-in', phone: '+971500000551', email: 'qa-wf-walkin@example.invalid', customer_class: 'external', customer_subcategory: 'walkin' })).json?.data;
  const veh = (await call('POST', '/vehicles', advisor, { customer_id: cust.id, make: 'Toyota', model: 'Land Cruiser', year: 2021, plate_number: 'QAWF01', vin: 'TSTWFA00000000001' })).json?.data;
  const created = await call('POST', '/work-orders', advisor, { customer_id: cust.id, vehicle_id: veh.id, customer_name: cust.full_name, customer_phone: cust.phone,
    description: 'AC not cooling; brake noise', odometer_in: 64000, payment_method: 'cash', service_fee: 0, items: [] });
  const woId = created.json?.data?.id;
  // The client's change (2026-10-29): an EXTERNAL customer's main job card
  // opens when they acknowledge the physical inspection, not with the work order.
  expect('work order created; the external customer\'s main job card waits for the physical inspection (Step 3)', created.status === 201 && !(await mainOf(woId)), `HTTP ${created.status}`);
  expect('no "New request" for the floor before the job card opens', await notesFor(users.supervisor.id, 'New request%') === 0 && await notesFor(users.leader.id, 'New request%') === 0, '');
  let d = await wf(advisor, woId);
  expect('workflow: steps 1–2 done, step 3 current; next: the physical inspection with the customer',
    d.steps.slice(0, 2).every(s => s.state === 'done') && d.current_step === 3 && d.next?.key === 'physical_inspection' && chk(d, 3, 'physical_ack')?.done === false,
    `${stepStates(d)} · next ${d.next?.key}`);
  const LINES1 = [
    { job_name: 'AC Compressor', line_type: 'labour', description: 'AC compressor - labour', quantity: 1, unit_price: 100 },
    { job_name: 'AC Compressor', line_type: 'parts', description: 'AC compressor', quantity: 1, unit_price: 999 },
    { job_name: 'Brake pad', line_type: 'labour', description: 'Brake pad - labour', quantity: 1.5, unit_price: 80 },
    { job_name: 'Brake pad', line_type: 'parts', description: 'Brake pads', quantity: 1 },
  ];
  const gated = await call('POST', '/estimates', advisor, { intake_work_order_id: woId, lines: LINES1 });
  const advOpen = await call('POST', `/workflow/work-orders/${woId}/job-card`, advisor, { override_reason: 'Customer in a hurry' });
  expect('before the acknowledgement the estimate and the Service Advisor opening the job card are refused (409 PHYSICAL_INSPECTION_REQUIRED)',
    gated.status === 409 && gated.json?.code === 'PHYSICAL_INSPECTION_REQUIRED' && advOpen.status === 409 && advOpen.json?.code === 'PHYSICAL_INSPECTION_REQUIRED' && !(await mainOf(woId)),
    `estimate ${gated.status} ${gated.json?.code || ''} / job card ${advOpen.status} ${advOpen.json?.code || ''}`);
  const insp = (await call('POST', '/vehicle-inspections', advisor, { work_order_id: woId, inspection_type: 'intake' })).json?.data;
  const unsigned = await call('PATCH', `/vehicle-inspections/${insp?.id}/complete`, advisor, {});
  d = await wf(advisor, woId);
  expect('physical inspection in progress: with the customer at the car it cannot be completed unsigned; next: finish it',
    unsigned.status === 400 && unsigned.json?.code === 'SIGNATURE_REQUIRED' && d.next?.key === 'finish_physical_inspection', `${unsigned.status} ${unsigned.json?.code || ''} · next ${d.next?.key}`);
  const sig = await call('PATCH', `/vehicle-inspections/${insp?.id}/signature`, advisor, { signature: PNG, name: 'QA WF Walk-in' });
  expect('signed before completion: the walk-around may still change, so no job card yet', sig.status === 200 && !(await mainOf(woId)), `HTTP ${sig.status}`);
  const ack = await call('PATCH', `/vehicle-inspections/${insp?.id}/complete`, advisor, {});
  const mainJc = await mainOf(woId);
  expect('completed with the customer\'s signature → the main job card opens (Step 3)',
    ack.status === 200 && ack.json?.job_card?.opened_now === true && !!mainJc && ack.json.job_card.number === mainJc.job_card_number, `HTTP ${ack.status} ${JSON.stringify(ack.json?.job_card)}`);
  expect('Supervisor and Team Leader told a request was raised (Step 4) — once, on the acknowledgement', await notesFor(users.supervisor.id, 'New request%') === 1 && await notesFor(users.leader.id, 'New request%') === 1, '');
  const [ackLog] = await q("SELECT note FROM work_order_status_logs WHERE work_order_id = ? AND note LIKE 'Main job card%opened%'", [woId]);
  expect('history: "Main job card … opened — physical inspection acknowledged (signed by the customer at the car)"',
    !!mainJc && (ackLog?.note || '').includes(mainJc.job_card_number) && /physical inspection acknowledged \(signed by the customer at the car\)/.test(ackLog.note), ackLog?.note);
  d = await wf(advisor, woId);
  expect('workflow: steps 1–3 done, step 4 current; Step 3 reads "Signed at the car"',
    d.steps.slice(0, 3).every(s => s.state === 'done') && d.current_step === 4 && chk(d, 3, 'physical_ack')?.done === true && /^Signed at the car/.test(chk(d, 3, 'physical_ack')?.detail || ''),
    `${stepStates(d)} · ${chk(d, 3, 'physical_ack')?.detail}`);

  // ── Steps 4–5 ──────────────────────────────────────────────────────
  section = '4-5 pricing';
  const noPref = await call('POST', '/estimates', advisor, { intake_work_order_id: woId, parts_preference: [], lines: LINES1 });
  expect('the customer\'s parts preference cannot be empty (400 PARTS_PREFERENCE_REQUIRED)', noPref.status === 400 && noPref.json?.code === 'PARTS_PREFERENCE_REQUIRED', `HTTP ${noPref.status} ${noPref.json?.code || ''}`);
  const est = await call('POST', '/estimates', advisor, { intake_work_order_id: woId, lines: LINES1 });
  const estId = est.json?.estimateId;
  expect('advisor raises the estimate for this visit (default preference Genuine + After-Market); 2 part lines wait for the Store',
    est.status === 201 && est.json.parts_to_price === 2 && JSON.stringify(est.json.parts_preference) === '["genuine","after_market"]', `parts_to_price ${est.json?.parts_to_price} ${JSON.stringify(est.json?.parts_preference)}`);
  const [advPart] = await q("SELECT unit_price FROM estimate_lines WHERE estimate_id = ? AND description = 'AC compressor'", [estId]);
  expect("an advisor's price on a part line is not taken (Store prices parts)", n(advPart.unit_price) === 0, `unit_price ${advPart.unit_price}`);
  expect('Storekeeper notified to price the parts', await notesFor(users.store.id, 'Price parts%') === 1, '');
  const storeTasks = (await call('GET', '/workflow/my-tasks', store)).json?.data;
  const advTasks = (await call('GET', '/workflow/my-tasks', advisor)).json?.data;
  expect('"Your tasks": the Storekeeper sees the estimate to price; the advisor does not',
    !!storeTasks?.groups.find(g => g.kind === 'price_parts')?.items.some(i => i.id === estId) && !advTasks?.groups.some(g => g.kind === 'price_parts'),
    JSON.stringify(storeTasks?.groups.map(g => `${g.kind}:${g.total}`)));
  const early = await call('POST', `/estimates/${estId}/send`, advisor, { format: 'both' });
  expect('estimate cannot be sent before the parts are priced', early.status === 409 && early.json?.code === 'PARTS_NOT_PRICED', `HTTP ${early.status} ${early.json?.code || ''}`);
  const lines = await q('SELECT id, description FROM estimate_lines WHERE estimate_id = ? ORDER BY sort_order', [estId]);
  const L = Object.fromEntries(lines.map(l => [l.description, l.id]));
  const advPrice = await call('PATCH', `/estimates/${estId}/lines/${L['AC compressor']}/pricing`, advisor, { genuine_price: 1 });
  expect('the advisor cannot use the Store pricing', advPrice.status === 403, `HTTP ${advPrice.status}`);
  const usedOff = await call('PATCH', `/estimates/${estId}/lines/${L['AC compressor']}/pricing`, store, { used_price: 200 });
  expect('the Store is not asked for a category outside the preference (Used → 400)', usedOff.status === 400, `HTTP ${usedOff.status}`);
  await call('PATCH', `/estimates/${estId}/lines/${L['AC compressor']}/pricing`, store, { genuine_price: 500, aftermarket_price: 300 });
  const na = await call('PATCH', `/estimates/${estId}/lines/${L['Brake pads']}/pricing`, store, { genuine_available: false, aftermarket_price: 150 });
  expect('Store prices both types; Genuine brake pads marked not available', na.status === 200 && na.json.parts_left_to_price === 0, `left ${na.json?.parts_left_to_price}`);
  expect('advisor told the parts are priced', await notesFor(users.advisor.id, 'Parts priced%') === 1, '');
  d = await wf(advisor, woId);
  const ac = d.estimate.pricing.jobs.find(j => j.job === 'AC Compressor');
  const br = d.estimate.pricing.jobs.find(j => j.job === 'Brake pad');
  expect('per-job totals: AC Compressor Genuine 600 / After-Market 400 (the PDF example)', ac.total_genuine === 600 && ac.total_after_market === 400, `${ac.total_genuine} / ${ac.total_after_market}`);
  // No automatic fallback any more (client, 2026-10-29): Genuine brake pads
  // not available leaves the Genuine column without them, flagged.
  expect('no fallback: Brake pad is Genuine 120 (labour only, flagged not available) / After-Market 270',
    br.total_genuine === 120 && br.total_after_market === 270 && br.genuine_na === true && br.after_market_na === false, `${br.total_genuine} / ${br.total_after_market} na ${br.genuine_na}`);
  expect('workflow: step 4 done, step 5 current', d.steps[3].state === 'done' && d.current_step === 5, stepStates(d));
  const blocked = await call('POST', `/estimates/${estId}/send`, advisor, { format: 'both' });
  expect('external customer: advisor cannot send without Supervisor / Manager approval', blocked.status === 409 && blocked.json?.code === 'MANAGER_APPROVAL_REQUIRED', `HTTP ${blocked.status}`);
  const appr = await call('POST', `/estimates/${estId}/internal-approve`, supervisor);
  const sent = await call('POST', `/estimates/${estId}/send`, advisor, { format: 'both' });
  // With no SMTP (local), the send answers 502 EMAIL_FAILED with the live link
  // instead of claiming the e-mail went out; the estimate is sent either way.
  const sentOk = sent.status === 200 || (sent.status === 502 && sent.json?.code === 'EMAIL_FAILED' && !!sent.json?.approval_url);
  expect('after the Supervisor approves, it goes out as Format 3 (both types)', appr.status === 200 && sentOk && sent.json.format === 'both', `approve ${appr.status}, send ${sent.status} ${sent.json?.message || ''}`);
  const wa = await call('POST', `/estimates/${estId}/send`, advisor, { format: 'both', channel: 'whatsapp' });
  expect('WhatsApp send returns a wa.me link with the approval link', wa.status === 200 && /^https:\/\/wa\.me\/\d+\?text=/.test(wa.json?.whatsapp_url || ''), `HTTP ${wa.status}`);

  // ── Step 6 decision ────────────────────────────────────────────────
  section = '6 decision';
  const [{ approval_token: token }] = await q('SELECT approval_token FROM service_estimates WHERE id = ?', [estId]);
  const pub = await call('GET', `/public/estimates/${token}`);
  expect('customer page shows Genuine 720 and After-Market 670 (no fallback) in the customer\'s preference',
    pub.status === 200 && pub.json.estimate.estimate_format === 'both' && JSON.stringify(pub.json.estimate.parts_preference) === '["genuine","after_market"]'
    && pub.json.totals_by_type.genuine === 720 && pub.json.totals_by_type.after_market === 670, JSON.stringify(pub.json?.totals_by_type));
  const notOffered = await call('POST', `/public/estimates/${token}/lines/${L['Brake pads']}/decide`, null, { decision: 'approved', part_option: 'genuine' });
  expect('the customer cannot approve a part in a category that is not available (400 PART_OPTION_NOT_OFFERED)',
    notOffered.status === 400 && notOffered.json?.code === 'PART_OPTION_NOT_OFFERED', `HTTP ${notOffered.status} ${notOffered.json?.code || ''}`);
  let lastDecide = null;
  for (const [desc, opt] of [['AC compressor - labour'], ['AC compressor', 'after_market'], ['Brake pad - labour'], ['Brake pads', 'after_market']]) {
    lastDecide = await call('POST', `/public/estimates/${token}/lines/${L[desc]}/decide`, null, { decision: 'approved', part_option: opt });
  }
  // The car is already in: the work joins its job card, no new one is "created".
  expect('customer told the work was added to the job in the workshop (not "job card created")',
    lastDecide?.json?.added_to_job === true && lastDecide.json.work_order_created === false, JSON.stringify(lastDecide?.json));
  expect('advisor told the work was added to the job card (JC number), not that a new one was created',
    await notesFor(users.advisor.id, `%approved — work added to job card ${mainJc.job_card_number}%`) === 1
    && await notesFor(users.advisor.id, '%approved — job card%created%') === 0, '');
  const [wo6] = await q('SELECT id, total_amount, vat_amount, customer_approved_at, customer_approval_channel FROM work_orders WHERE id = ?', [woId]);
  const items6 = await q('SELECT name, unit_price FROM work_order_items WHERE work_order_id = ? ORDER BY id', [woId]);
  const [estAfter] = await q('SELECT status, work_order_id FROM service_estimates WHERE id = ?', [estId]);
  expect('approval lands on THIS visit (no second work order)', estAfter.status === 'converted' && estAfter.work_order_id === woId, `estimate ${estAfter.status} → WO ${estAfter.work_order_id}`);
  expect('approved lines with the chosen type: 100 + 300 + 120 + 150 = 670 + VAT 33.50 = 703.50', n(wo6.total_amount) === 703.5 && items6.some(i => i.name === 'AC compressor (After-Market)'), `total ${wo6.total_amount}; ${items6.map(i => i.name).join(', ')}`);
  expect('customer approval recorded from the estimate', !!wo6.customer_approved_at && wo6.customer_approval_channel === 'estimate', wo6.customer_approval_channel);
  expect('floor told the work is approved and ready to assign', await notesFor(users.leader.id, 'Approved:%') === 1, '');

  // ── Step 6 work ────────────────────────────────────────────────────
  section = '6 work';
  const notMine = await call('POST', `/job-cards/${mainJc.id}/time/start`, mechTok);
  expect('technician cannot book time on a job card not assigned to them', notMine.status === 403, `HTTP ${notMine.status}`);
  const tl = await call('POST', '/team-leader/assign', leader, { work_order_id: woId, mechanic_id: mech });
  const [jcAfterAssign] = await q('SELECT mechanic_id FROM job_cards WHERE id = ?', [mainJc.id]);
  expect('Team Leader assigns; the main job card follows and the technician is told', tl.status === 200 && jcAfterAssign.mechanic_id === mech && await notesFor(users.tech.id, 'Job assigned%') >= 1, `HTTP ${tl.status} ${tl.json?.message || ''}`);
  const techLinks = (await q('SELECT link, body FROM user_notifications WHERE user_id = ? AND id > ? AND title LIKE ?', [users.tech.id, baseline.user_notifications, 'Job assigned%']));
  expect('the technician\'s "Job assigned" notice opens their job card in the technician app (no staff page, no customer name)',
    techLinks.length >= 1 && techLinks.every(n => n.link === `/mechanic/jobs/${mainJc.id}`) && !techLinks.some(n => /QA WF Walk-in|undefined/.test(n.body)),
    techLinks.map(n => n.link).join(', '));
  const st1 = await call('POST', `/job-cards/${mainJc.id}/time/start`, mechTok);
  let [wos] = await q('SELECT status FROM work_orders WHERE id = ?', [woId]);
  expect('Start: time running, work order moves to in progress', st1.status === 201 && wos.status === 'in_progress', `HTTP ${st1.status}, WO ${wos.status} ${st1.json?.message || ''}`);
  const pa = await call('POST', `/job-cards/${mainJc.id}/time/pause`, mechTok);
  const st2 = await call('POST', `/job-cards/${mainJc.id}/time/start`, mechTok);
  const twice = await call('POST', `/job-cards/${mainJc.id}/time/start`, mechTok);
  expect('Pause and resume; cannot start twice', pa.status === 200 && st2.status === 201 && twice.status === 409, `${pa.status}/${st2.status}/${twice.status}`);
  const rq = await call('POST', `/job-cards/${mainJc.id}/requisitions`, mechTok, { items: [{ description: 'Compressor oil PAG46', quantity: 1 }] });
  expect('technician raises a material requisition; Store notified', rq.status === 201 && await notesFor(users.store.id, 'Material requisition%') === 1, `HTTP ${rq.status}`);
  const [ri] = await q('SELECT i.id FROM material_requisition_items i WHERE i.requisition_id = ?', [rq.json.requisitionId]);
  const tomorrow = new Date(Date.now() + 86400000); const tmr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  const mechNa = await call('PATCH', `/workflow/requisition-items/${ri.id}`, advisor, { availability: 'not_available', expected_date: tmr });
  const naRes = await call('PATCH', `/workflow/requisition-items/${ri.id}`, store, { availability: 'not_available', expected_date: tmr });
  expect('only the Store records availability; not on shelf → expected date', mechNa.status === 403 && naRes.status === 200, `${mechNa.status}/${naRes.status}`);
  const { runPartsEtaAlerts } = await import(BE + '/src/lib/parts-eta-alerts.js');
  const alerted = await runPartsEtaAlerts();
  const again = await runPartsEtaAlerts();
  expect('the floor is alerted 24 h before the expected date — once', alerted >= 1 && again === 0 && await notesFor(users.supervisor.id, 'Part arriving within 24 h%') === 1, `alerted ${alerted}, then ${again}`);
  const iss = await call('PATCH', `/workflow/requisition-items/${ri.id}`, store, { availability: 'available', unit_cost: 35 });
  const [riAfter] = await q('SELECT status, quantity_issued FROM material_requisition_items WHERE id = ?', [ri.id]);
  expect('Store re-checks: on the shelf → parts issued, technician told', iss.status === 200 && riAfter.status === 'issued' && await notesFor(users.tech.id, 'Parts issued%') === 1, `HTTP ${iss.status} ${riAfter.status}`);
  const sub = await call('POST', `/workflow/work-orders/${woId}/sub-job-cards`, advisor, { title: 'Bumper touch-up', department: 'body_paint', mechanic_id: mech2 });
  const subId = sub.json?.data?.id;
  expect('sub-job card for part of the work, floor notified', sub.status === 201 && await notesFor(users.leader.id, 'Sub-job card%') === 1, `HTTP ${sub.status} ${sub.json?.data?.job_card_number || sub.json?.message}`);
  const stop = await call('POST', `/job-cards/${mainJc.id}/time/stop`, mechTok);
  const done1 = await call('POST', `/job-cards/${mainJc.id}/done`, mechTok);
  [wos] = await q('SELECT status FROM work_orders WHERE id = ?', [woId]);
  expect('main job card done; work order stays in progress while the sub-job card is open', stop.status === 200 && done1.status === 200 && wos.status === 'in_progress', `WO ${wos.status}`);
  const notHisDone = await call('POST', `/job-cards/${subId}/done`, mechTok);
  const notHisParts = await call('POST', `/job-cards/${subId}/requisitions`, mechTok, { items: [{ description: 'x', quantity: 1 }] });
  expect("technician cannot mark done or order parts on someone else's job card", notHisDone.status === 403 && notHisParts.status === 403, `${notHisDone.status}/${notHisParts.status}`);
  const subNoTime = await call('POST', `/job-cards/${subId}/done`, leader);
  expect('a job card cannot be marked done with no time booked', subNoTime.status === 409, `HTTP ${subNoTime.status}`);
  const advBook = await call('POST', `/job-cards/${subId}/time/start`, advisor, { mechanic_id: mech2 });
  expect('roles: the Service Advisor does not book technicians\' time (the floor does)', advBook.status === 403, `HTTP ${advBook.status}`);
  await call('POST', `/job-cards/${subId}/time/start`, leader, { mechanic_id: mech2 });
  await call('POST', `/job-cards/${subId}/time/stop`, leader, { mechanic_id: mech2 });
  const done2 = await call('POST', `/job-cards/${subId}/done`, leader);
  [wos] = await q('SELECT status FROM work_orders WHERE id = ?', [woId]);
  expect('JOB DONE on every job card → work order to inspection; QC roles told', done2.status === 200 && wos.status === 'inspection' && await notesFor(users.supervisor.id, 'Ready for quality check%') >= 1, `WO ${wos.status}`);
  d = await wf(advisor, woId);
  expect('workflow: step 6 done, step 7 current', d.steps[5].state === 'done' && d.current_step === 7, stepStates(d));

  // ── Step 7 ─────────────────────────────────────────────────────────
  section = '7 closure';
  expect('quality check has the client\'s three points', d.qc_checklist.map(c => c.key).join(',') === 'issue_repaired,test_drive,other_issues', d.qc_checklist.map(c => c.key).join(','));
  const all = d.qc_checklist.map(c => c.type === 'comment' ? { key: c.key, item: c.label, passed: true, notes: 'Wiper blades worn — advise customer' } : { key: c.key, item: c.label, passed: true });
  const mechQc = await call('POST', `/job-cards/${mainJc.id}/qc`, mechTok, { checklist_items: all, overall_result: 'passed' });
  const noDrive = await call('POST', `/job-cards/${mainJc.id}/qc`, supervisor, { checklist_items: all.map(i => i.key === 'test_drive' ? { ...i, passed: false } : i), overall_result: 'passed' });
  const notFixed = await call('POST', `/job-cards/${mainJc.id}/qc`, supervisor, { checklist_items: all.map(i => i.key === 'issue_repaired' ? { ...i, passed: false } : i), overall_result: 'passed' });
  expect('technician cannot sign the QC; no pass without the test drive or with the repair not right', mechQc.status === 403 && noDrive.status === 400 && notFixed.status === 400, `${mechQc.status}/${noDrive.status}/${notFixed.status}`);
  const fail = await call('POST', `/job-cards/${subId}/qc`, supervisor, { checklist_items: all, overall_result: 'failed', inspector_notes: 'Paint overspray on the grille' });
  [wos] = await q('SELECT status FROM work_orders WHERE id = ?', [woId]);
  expect('QC failed → Team Leader / Supervisor told, job back in progress', fail.status === 200 && wos.status === 'in_progress' && await notesFor(users.leader.id, 'Quality check failed%') === 1, `WO ${wos.status}`);
  await call('POST', `/job-cards/${subId}/time/start`, leader, { mechanic_id: mech2 });
  await call('POST', `/job-cards/${subId}/done`, leader);
  const p1 = await call('POST', `/job-cards/${mainJc.id}/qc`, supervisor, { checklist_items: all, overall_result: 'passed' });
  const p2 = await call('POST', `/job-cards/${subId}/qc`, supervisor, { checklist_items: all, overall_result: 'passed' });
  const [qcRow] = await q('SELECT inspector_notes FROM qc_checklists WHERE job_card_id = ?', [subId]);
  expect('"other issues or comments" is kept with the quality check', qcRow?.inspector_notes === 'Wiper blades worn — advise customer', qcRow?.inspector_notes);
  [wos] = await q('SELECT status FROM work_orders WHERE id = ?', [woId]);
  expect('rework, then QC passed on both → ready for collection; Service Advisor told to call the customer',
    p1.status === 200 && p2.status === 200 && wos.status === 'ready_for_pickup' && await notesFor(users.advisor.id, 'Ready for collection:%') === 1, `WO ${wos.status}`);
  const readyEmail = await waitFor(async () => (await custMsgs(woId, 'email')).find(m => m.template_key === 'order_ready_for_pickup'));
  expect('the customer\'s ready email: "{plate} — Ready for collection ({WO})"', /^QAWF01 — Ready for collection \(WO-/.test(readyEmail?.message || ''), readyEmail?.message);
  const readySms = (await custMsgs(woId, 'sms')).find(m => m.template_key === 'order_ready_for_pickup');
  expect('the customer\'s ready SMS: ready for collection, the amount due and the status link',
    /is ready for collection\. Amount due: AED 703\.50\. Details: https?:\/\/\S+\/service-status\//.test(readySms?.message || '') && !/undefined|pickup/i.test(readySms?.message || ''), readySms?.message);
  const manualClose = await call('PATCH', `/work-orders/${woId}/status`, advisor, { status: 'completed' });
  expect('cannot close without the final gate pass', manualClose.status === 409 && manualClose.json?.code === 'GATE_PASS_REQUIRED', `HTTP ${manualClose.status} ${manualClose.json?.code || ''}`);
  const contact = await call('POST', `/workflow/work-orders/${woId}/contacts`, advisor, { channel: 'phone', outcome: 'reached', note: 'Collecting at 6pm' });
  expect('pickup call logged', contact.status === 201, `HTTP ${contact.status}`);
  const gp1 = await call('POST', `/workflow/work-orders/${woId}/gate-pass`, advisor, {});
  expect('gate pass refused while the invoice is unpaid (walk-in)', gp1.status === 409 && /payment/i.test(gp1.json?.message || ''), gp1.json?.message);
  const [inv] = await q("SELECT id, total_amount FROM invoices WHERE work_order_id = ? AND status NOT IN ('void','cancelled') ORDER BY id DESC LIMIT 1", [woId]);
  const pay = await call('POST', `/invoices/${inv.id}/record-payment`, advisor, { amount: Number(inv.total_amount), payment_method: 'card' });
  const gp2 = await call('POST', `/workflow/work-orders/${woId}/gate-pass`, advisor, { odometer_out: 64012 });
  expect('invoice 703.50 paid → final gate pass issued', n(inv.total_amount) === 703.5 && pay.status === 200 && gp2.status === 201 && gp2.json.data.status === 'released', `invoice ${inv.total_amount}, gate pass ${gp2.json?.data?.gate_pass_number}`);
  const close = await call('POST', `/workflow/work-orders/${woId}/close`, advisor);
  [wos] = await q('SELECT status, completed_at FROM work_orders WHERE id = ?', [woId]);
  const jcs = await q('SELECT status FROM job_cards WHERE work_order_id = ?', [woId]);
  expect('job closed: work order completed, job cards closed', close.status === 200 && wos.status === 'completed' && jcs.every(j => j.status === 'billed'), `WO ${wos.status}; JCs ${jcs.map(j => j.status).join(',')}`);
  d = await wf(advisor, woId);
  expect('workflow: all 7 steps done', d.steps.every(s => s.state === 'done'), stepStates(d));

  // ── Customer messages ──────────────────────────────────────────────
  section = 'customer messages';
  await waitFor(async () => (await custMsgs(woId, 'sms')).some(m => m.template_key === 'order_completed'));
  const sms = await custMsgs(woId, 'sms');
  const emails = await custMsgs(woId, 'email');
  const keys = [...new Set([...sms, ...emails].map(m => m.template_key))].sort();
  expect('the customer heard from us only when the job opened, was ready for collection and was closed',
    JSON.stringify(keys) === JSON.stringify(['order_completed', 'order_pending', 'order_ready_for_pickup']), keys.join(', '));
  const [{ n: internal }] = await q("SELECT COUNT(*) AS n FROM notifications WHERE work_order_id = ? AND template_key IN ('order_assigned','order_accepted','order_inspection','order_confirmed','order_in_progress','driver_assigned')", [woId]);
  expect('no customer message at internal steps (confirmed, assigned, in progress, quality check)', Number(internal) === 0, `${internal} row(s)`);
  expect('no customer message names the technician', ![...sms, ...emails].some(m => /QA WF (Body )?Tech/.test(m.message)), '');
  const opened = sms.find(m => m.template_key === 'order_pending')?.message || '';
  // Sent when the work order opens: an external customer's job card is not open yet, so it names the job (WO).
  expect('job opened SMS: vehicle, plate, the job (WO number) and the status link',
    opened.includes(`Toyota Land Cruiser (QAWF01), job ${created.json.data.work_order_number}.`) && /Follow your service: \S+\/service-status\//.test(opened), opened);
  const { customerMessageView, CUSTOMER_MILESTONES } = await import(BE + '/src/lib/notify.js');
  const { buildWorkOrderStatusEmail } = await import(BE + '/src/lib/email.js');
  const [woRow] = await q('SELECT * FROM work_orders WHERE id = ?', [woId]);
  const rendered = [];
  for (const st of CUSTOMER_MILESTONES) {
    const view = await customerMessageView(woRow, 1, st);
    rendered.push([st, buildWorkOrderStatusEmail({ status: st, view, branding: { name: 'Pioneer', isSystem: true } }) || '']);
  }
  const bad = rendered.filter(([, html]) => !html || /undefined|NaN|\bnull\b|recipient|Tracking ID|Service Address|Mechanic/i.test(html.replace(/<[^>]*>/g, ' ')));
  expect('the status email renders on real columns for all four moments (no "undefined", no courier rows)',
    !bad.length && rendered.every(([, h]) => h.includes('QAWF01') && h.includes('View your vehicle status')), bad.map(([s]) => s).join(', '));

  // ── Roles ──────────────────────────────────────────────────────────
  section = 'roles';
  const storeOpens = await call('POST', '/work-orders', store, { customer_id: cust.id, vehicle_id: veh.id, customer_name: 'x', customer_phone: '+971500000551', description: 'x', odometer_in: 1 });
  const leaderSends = await call('POST', `/estimates/${estId}/send`, leader, { format: 'genuine', channel: 'whatsapp' });
  const supPays = await call('POST', `/workflow/work-orders/${woId}/gate-pass`, supervisor, {});
  const advAssigns = await call('PATCH', `/work-orders/${woId}/assign-mechanic`, advisor, { mechanic_id: mech });
  const storeApproves = await call('PATCH', `/work-orders/${woId}/customer-approval`, store, { channel: 'phone' });
  expect('roles: Storekeeper cannot open a job card; Team Leader cannot send estimates; Supervisor cannot issue gate passes; Service Advisor cannot assign technicians; Storekeeper cannot record customer approval',
    [storeOpens, leaderSends, supPays, advAssigns, storeApproves].every(r => r.status === 403),
    [storeOpens, leaderSends, supPays, advAssigns, storeApproves].map(r => r.status).join('/'));
  const me = await call('GET', `/workflow/work-orders/${woId}`, store);
  expect('roles: the workflow tells each person what they can do', JSON.stringify(me.json?.data?.you?.capabilities) === JSON.stringify(['estimate.price_parts', 'store.issue']), JSON.stringify(me.json?.data?.you?.capabilities));

  // A custom role whose responsibilities are set in Settings → Roles
  const mgrTok = await mk('mgr', 'workshop_manager', 'workshop_manager');
  const roleRes = await call('POST', '/settings/roles', mgrTok, { name: 'QA Cashier', slug: 'qa_cashier', modules: ['dashboard', 'invoices'], capabilities: ['delivery.handover'] });
  const cashier = await mk('cashier', 'dispatcher', 'qa_cashier');
  const cashierContact = await call('POST', `/workflow/work-orders/${woId}/contacts`, cashier, { channel: 'phone', outcome: 'reached' });
  const cashierAssign = await call('PATCH', `/work-orders/${woId}/assign-mechanic`, cashier, { mechanic_id: mech });
  expect('roles: a custom "Cashier" role with only handover can log pickup calls but not assign technicians',
    roleRes.status === 201 && cashierContact.status === 201 && cashierAssign.status === 403, `${roleRes.status}/${cashierContact.status}/${cashierAssign.status}`);
  const advRole = (await q("SELECT id FROM roles WHERE slug = 'service_advisor' AND workshop_id = 1"))[0];
  const listed = (await call('GET', '/settings/roles', mgrTok)).json?.data?.find(r => r.id === advRole.id);
  expect('roles: Settings shows the Service Advisor\'s default responsibilities',
    JSON.stringify(listed?.capabilities) === JSON.stringify(['job.open', 'estimate.raise', 'customer.approval', 'parts.request', 'delivery.handover']) && listed?.capabilities_custom === false,
    JSON.stringify(listed?.capabilities));
  await q("DELETE FROM roles WHERE slug = 'qa_cashier'");

  // ── Reject all ─────────────────────────────────────────────────────
  section = '6 reject all';
  // A QA fleet account, not a real one: cancelling this job texts and emails the customer.
  const fleet = (await call('POST', '/customers', mgrTok, { full_name: 'QA WF Fleet', phone: '+971500000558', email: 'qa-wf-fleet@example.invalid', customer_class: 'internal', customer_subcategory: 'fleet' })).json?.data;
  const veh2 = (await call('POST', '/vehicles', advisor, { customer_id: fleet.id, make: 'Nissan', model: 'Sunny', year: 2020, plate_number: 'QAWF02', vin: 'TSTWFA00000000002' })).json?.data;
  const wo2 = (await call('POST', '/work-orders', advisor, { customer_id: fleet.id, vehicle_id: veh2.id, customer_name: fleet.full_name, customer_phone: fleet.phone || '+971500000552', description: 'Service', odometer_in: 120000, payment_method: 'credit', items: [] })).json?.data?.id;
  d = await wf(advisor, wo2);
  expect('internal customer: no physical inspection — the main job card opens with the work order',
    !!(await mainOf(wo2)) && d.steps[2].state === 'done' && chk(d, 3, 'physical_ack')?.done === true && chk(d, 3, 'physical_ack')?.detail === 'Not needed — internal customer',
    `${stepStates(d)} · ${chk(d, 3, 'physical_ack')?.detail}`);
  const e2 = (await call('POST', '/estimates', advisor, { intake_work_order_id: wo2, lines: [{ job_name: 'Service', line_type: 'labour', description: 'Full service', quantity: 1, unit_price: 250 }] })).json?.estimateId;
  const s2 = await call('POST', `/estimates/${e2}/send`, advisor, { format: 'genuine', channel: 'whatsapp' });
  expect('internal (fleet) customer: estimate goes straight out, no manager approval', s2.status === 200, `HTTP ${s2.status} ${s2.json?.message || ''}`);
  const [{ approval_token: t2 }] = await q('SELECT approval_token FROM service_estimates WHERE id = ?', [e2]);
  const [l2] = await q('SELECT id FROM estimate_lines WHERE estimate_id = ?', [e2]);
  await call('POST', `/public/estimates/${t2}/lines/${l2.id}/decide`, null, { decision: 'rejected', reason: 'Too expensive' });
  const [wo2row] = await q('SELECT status, cancellation_reason FROM work_orders WHERE id = ?', [wo2]);
  d = await wf(advisor, wo2);
  expect('customer rejects all → job closed, no work carried out; workflow stops at step 6', wo2row.status === 'cancelled' && /rejected/.test(wo2row.cancellation_reason || '') && d.steps[5].state === 'stopped', `WO ${wo2row.status}; ${stepStates(d)}`);
  const cancelSms = await waitFor(async () => (await custMsgs(wo2, 'sms')).find(m => m.template_key === 'order_cancelled'));
  expect('cancelled: the customer is told, with the workshop phone', /job WO-\S+ for QAWF02 has been cancelled\. Questions\? Call /.test(cancelSms?.message || ''), cancelSms?.message);

  // ── Step 3: a manager opens the job card without the acknowledgement ──
  section = '3 override';
  const veh3 = (await call('POST', '/vehicles', advisor, { customer_id: cust.id, make: 'Toyota', model: 'Corolla', year: 2019, plate_number: 'QAWF03', vin: 'TSTWFA00000000003' })).json?.data;
  const wo3 = (await call('POST', '/work-orders', advisor, { customer_id: cust.id, vehicle_id: veh3.id, customer_name: cust.full_name, customer_phone: cust.phone,
    description: 'Engine light on', odometer_in: 30000, payment_method: 'cash', service_fee: 0, items: [] })).json?.data?.id;
  const ovAdv = await call('POST', `/workflow/work-orders/${wo3}/job-card`, advisor, { override_reason: 'Customer left the keys' });
  const ovBlank = await call('POST', `/workflow/work-orders/${wo3}/job-card`, mgrTok, { override_reason: '   ' });
  expect('not acknowledged: the Service Advisor gets 409 PHYSICAL_INSPECTION_REQUIRED, a manager without a reason 400 REASON_REQUIRED; no job card',
    ovAdv.status === 409 && ovAdv.json?.code === 'PHYSICAL_INSPECTION_REQUIRED' && ovBlank.status === 400 && ovBlank.json?.code === 'REASON_REQUIRED' && !(await mainOf(wo3)),
    `${ovAdv.status} ${ovAdv.json?.code || ''} / ${ovBlank.status} ${ovBlank.json?.code || ''}`);
  const ov = await call('POST', `/workflow/work-orders/${wo3}/job-card`, mgrTok, { override_reason: 'Car left overnight, customer signs tomorrow' });
  const jc3 = await mainOf(wo3);
  const [ovRow] = await q('SELECT inspection_override_by, inspection_override_reason FROM work_orders WHERE id = ?', [wo3]);
  const [ovLog] = await q("SELECT note FROM work_order_status_logs WHERE work_order_id = ? AND note LIKE 'Main job card%opened%'", [wo3]);
  const [{ n: ovAudit }] = await q("SELECT COUNT(*) n FROM audit_logs WHERE action = 'JOB_CARD_OVERRIDE' AND entity_type = 'work_orders' AND entity_id = ? AND id > ?", [wo3, baseline.audit_logs]);
  expect('a manager opens it with a reason → 201 overridden; the reason is kept on the work order, in its history and in the audit log',
    ov.status === 201 && ov.json?.overridden === true && !!jc3 && ovRow.inspection_override_by === users.mgr.id && ovRow.inspection_override_reason === 'Car left overnight, customer signs tomorrow'
    && /physical inspection skipped \(opened by a manager without the acknowledgement: Car left overnight/.test(ovLog?.note || '') && Number(ovAudit) === 1,
    `HTTP ${ov.status} · ${ovLog?.note} · audit ${ovAudit}`);
  d = await wf(advisor, wo3);
  expect('workflow: Step 3 done, the acknowledgement check stays open and says who skipped it and why',
    d.steps[2].state === 'done' && chk(d, 3, 'physical_ack')?.done === false && /^Skipped — job card opened by QA mgr: Car left overnight/.test(chk(d, 3, 'physical_ack')?.detail || ''),
    `${stepStates(d)} · ${chk(d, 3, 'physical_ack')?.detail}`);

  // ── Step 5: parts categories — Used, expected delivery, an alternative ──
  section = '5 parts categories';
  const veh4 = (await call('POST', '/vehicles', advisor, { customer_id: fleet.id, make: 'Nissan', model: 'Patrol', year: 2018, plate_number: 'QAWF04', vin: 'TSTWFA00000000004' })).json?.data;
  const wo4 = (await call('POST', '/work-orders', advisor, { customer_id: fleet.id, vehicle_id: veh4.id, customer_name: fleet.full_name, customer_phone: fleet.phone || '+971500000552',
    description: 'Charging fault; mirror broken; wipers', odometer_in: 98000, payment_method: 'credit', items: [] })).json?.data?.id;
  const e4 = await call('POST', '/estimates', advisor, { intake_work_order_id: wo4, parts_preference: 'genuine,used', lines: [
    { job_name: 'Alternator', line_type: 'labour', description: 'Alternator - labour', quantity: 1, unit_price: 100 },
    { job_name: 'Alternator', line_type: 'parts', description: 'Alternator', quantity: 2 },
    { job_name: 'Mirror', line_type: 'parts', description: 'Door mirror', quantity: 1 },
    { job_name: 'Wipers', line_type: 'parts', description: 'Wiper blades', quantity: 1 },
  ] });
  const est4 = e4.json?.estimateId;
  expect("preference 'genuine,used' stored; 3 part lines for the Store", e4.status === 201 && JSON.stringify(e4.json.parts_preference) === '["genuine","used"]' && e4.json.parts_to_price === 3,
    `HTTP ${e4.status} ${JSON.stringify(e4.json?.parts_preference)} ${e4.json?.parts_to_price}`);
  const L4 = Object.fromEntries((await q('SELECT id, description FROM estimate_lines WHERE estimate_id = ?', [est4])).map(l => [l.description, l.id]));
  const tmr4 = ymd(new Date(Date.now() + 2 * 86400000));
  const amOff = await call('PATCH', `/estimates/${est4}/lines/${L4.Alternator}/pricing`, store, { aftermarket_price: 250 });
  const alt = await call('PATCH', `/estimates/${est4}/lines/${L4.Alternator}/pricing`, store, { genuine_price: 400, genuine_expected_date: tmr4, used_price: 150, used_available: true });
  const altInPref = await call('PATCH', `/estimates/${est4}/lines/${L4['Door mirror']}/pricing`, store, { genuine_available: false, used_available: false, alternative: { option: 'used', for: 'genuine', price: 60 } });
  const mirror = await call('PATCH', `/estimates/${est4}/lines/${L4['Door mirror']}/pricing`, store, { genuine_available: false, used_available: false, alternative: { option: 'after_market', for: 'genuine', price: 80, expected_date: tmr4 } });
  const wipers = await call('PATCH', `/estimates/${est4}/lines/${L4['Wiper blades']}/pricing`, store, { genuine_available: false, used_available: false });
  expect('Store: After-Market not asked for (400); an alternative must be outside the preference (400); Genuine with a delivery date, Used in stock, an After-Market alternative for the mirror',
    amOff.status === 400 && alt.status === 200 && altInPref.status === 400 && mirror.status === 200 && wipers.status === 200 && wipers.json.parts_left_to_price === 0,
    `${amOff.status}/${alt.status}/${altInPref.status}/${mirror.status}/${wipers.status} left ${wipers.json?.parts_left_to_price}`);
  d = await wf(advisor, wo4);
  const p4 = d.estimate?.pricing;
  expect('totals in the preference only: Genuine 900, Used 400 — the alternative listed apart, never added; no After-Market column',
    p4?.totals?.genuine === 900 && p4.totals.used === 400 && p4.total_after_market === null && p4.alternatives?.length === 1
    && p4.alternatives[0].option === 'after_market' && p4.alternatives[0].for === 'genuine' && p4.alternatives[0].amount === 80 && p4.alternatives[0].expected_date === tmr4,
    `${JSON.stringify(p4?.totals)} alt ${JSON.stringify(p4?.alternatives)}`);
  const s4 = await call('POST', `/estimates/${est4}/send`, advisor, { channel: 'whatsapp' });
  const [{ approval_token: t4 }] = await q('SELECT approval_token FROM service_estimates WHERE id = ?', [est4]);
  const pub4 = await call('GET', `/public/estimates/${t4}`);
  const altLine = (pub4.json?.lines || []).find(l => l.id === L4['Door mirror']);
  expect('customer page: Genuine and Used totals, the mirror\'s After-Market alternative offered for their approval',
    s4.status === 200 && JSON.stringify(pub4.json?.estimate?.parts_preference) === '["genuine","used"]' && pub4.json.totals_by_type.genuine === 900 && pub4.json.totals_by_type.used === 400
    && !('after_market' in pub4.json.totals_by_type) && pub4.json.alternatives?.[0]?.option === 'after_market' && !!altLine,
    `send ${s4.status}; ${JSON.stringify(pub4.json?.totals_by_type)}`);
  const decide4 = (id, body) => call('POST', `/public/estimates/${t4}/lines/${id}/decide`, null, body);
  const amPick = await decide4(L4.Alternator, { decision: 'approved', part_option: 'after_market' });
  const usedPick = await decide4(L4.Alternator, { decision: 'approved', part_option: 'used' });
  const altSilent = await decide4(L4['Door mirror'], { decision: 'approved' });
  const altPick = await decide4(L4['Door mirror'], { decision: 'approved', part_option: 'after_market' });
  const noneLeft = await decide4(L4['Wiper blades'], { decision: 'approved' });
  const wipersNo = await decide4(L4['Wiper blades'], { decision: 'rejected', reason: 'Not available' });
  const labour4 = await decide4(L4['Alternator - labour'], { decision: 'approved' });
  expect('customer: After-Market not offered for the alternator (400); Used chosen; the alternative needs an explicit choice (409 ALTERNATIVE_NEEDS_CHOICE), then approved; nothing on offer (409 PART_NOT_AVAILABLE)',
    amPick.status === 400 && amPick.json?.code === 'PART_OPTION_NOT_OFFERED' && usedPick.status === 200 && altSilent.status === 409 && altSilent.json?.code === 'ALTERNATIVE_NEEDS_CHOICE'
    && altPick.status === 200 && noneLeft.status === 409 && noneLeft.json?.code === 'PART_NOT_AVAILABLE' && wipersNo.status === 200 && labour4.status === 200 && labour4.json?.estimate_status === 'partially_approved',
    [amPick, usedPick, altSilent, altPick, noneLeft, wipersNo, labour4].map(r => `${r.status}${r.json?.code ? ' ' + r.json.code : ''}`).join(' / '));
  const conv4 = await call('POST', `/estimates/${est4}/convert-to-work-order`, advisor);
  const items4 = await q('SELECT name, quantity, unit_price FROM work_order_items WHERE work_order_id = ? ORDER BY id', [wo4]);
  const [mirrorLine] = await q('SELECT part_option, alternative_approved FROM estimate_lines WHERE id = ?', [L4['Door mirror']]);
  const [wo4row] = await q('SELECT total_amount FROM work_orders WHERE id = ?', [wo4]);
  expect('converted onto this visit with the chosen categories: Alternator (Used) 2 × 150, Door mirror (After-Market — alternative to Genuine) 80; 480 + VAT = 504',
    conv4.status === 200 && conv4.json.workOrderId === wo4 && items4.some(i => i.name === 'Alternator (Used)' && n(i.unit_price) === 150 && n(i.quantity) === 2)
    && items4.some(i => i.name === 'Door mirror (After-Market — alternative to Genuine)' && n(i.unit_price) === 80) && !items4.some(i => /Wiper/.test(i.name))
    && mirrorLine.part_option === 'after_market' && Number(mirrorLine.alternative_approved) === 1 && n(wo4row.total_amount) === 504,
    `HTTP ${conv4.status}; ${items4.map(i => `${i.name} ×${n(i.quantity)} @${i.unit_price}`).join(' | ')}; total ${wo4row?.total_amount}`);
} catch (e) { out.push('ERROR ' + e.stack); }
finally {
  await q("DELETE FROM roles WHERE slug = 'qa_cashier'"); // the roles table is not cleaned by id
  // Signature images of the inspections signed here.
  for (const { u } of await q("SELECT signature_url u FROM vehicle_inspections WHERE id > ? AND signature_url LIKE '/uploads/signatures/sig_insp%'", [baseline.vehicle_inspections])) {
    if (/^\/uploads\/signatures\/sig_insp\d+_[\w-]+\.png$/.test(u)) fs.rmSync(BE + u, { force: true });
  }
  await q('SET FOREIGN_KEY_CHECKS = 0'); const removed = {};
  for (const t of idTables) { const r = await q(`DELETE FROM \`${t}\` WHERE id > ?`, [baseline[t]]); if (r.affectedRows) removed[t] = r.affectedRows; }
  await q('SET FOREIGN_KEY_CHECKS = 1'); await db.end();
  console.log(out.join('\n'));
  console.log(`\n${out.filter(l => l.startsWith('PASS')).length} passed, ${out.filter(l => l.startsWith('FAIL')).length} failed · cleanup ${Object.keys(removed).length} tables`);
  process.exit(0);
}
