// Technician app (Step 6): what a technician may see and do through
// /api/job-cards, the one-clock rule, pause reasons, Scan job card lookups and
// Finished jobs. LOCAL ONLY; every row created is removed by id baseline at the end.
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
  let j = null; try { j = await r.json(); } catch {} return { status: r.status, json: j };
};
const brief = r => `HTTP ${r.status}${r.json?.code ? ' ' + r.json.code : ''}`;
const p2 = n => String(n).padStart(2, '0');
const local = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:00`;
const idTables = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema = DATABASE() AND column_name = 'id' AND extra LIKE '%auto_increment%'`)).map(r => r.t)
  .filter(t => t !== 'roles'); // never cleaned up by id: the seeded / demo roles live there
const baseline = {}; for (const t of idTables) baseline[t] = (await q(`SELECT COALESCE(MAX(id),0) AS m FROM \`${t}\``))[0].m;
const created = { users: [], mechanics: [], customers: [], vehicles: [], work_orders: [] };
// A 1×1 PNG, as the signature pad would send.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const QC_OK = [{ key: 'issue_repaired', item: 'Issue repaired', passed: true }, { key: 'test_drive', item: 'Test drive', passed: true }, { key: 'other_issues', item: 'Other issues', passed: true, notes: '' }];

try {
  const pw = 'Qa' + crypto.randomBytes(8).toString('hex') + '1';
  const users = {};
  const mk = async (key, role, slug) => {
    const [r] = slug ? await q('SELECT id FROM roles WHERE slug = ? AND workshop_id = 1', [slug]) : [null];
    const username = `qa_ta_${key}`;
    const ins = await q(`INSERT INTO users (workshop_id, full_name, username, email, password, role, role_id, is_active) VALUES (1,?,?,?,?,?,?,1)`,
      [`QA TA ${key}`, username, `${username}@example.invalid`, await bcrypt.hash(pw, 10), role, r?.id || null]);
    created.users.push(ins.insertId);
    const tok = (await call('POST', '/auth/login', null, { username, password: pw })).json?.data?.token;
    users[key] = { id: ins.insertId, tok };
    return tok;
  };
  const advisor = await mk('advisor', 'service_advisor', 'service_advisor');
  const supervisor = await mk('supervisor', 'supervisor', 'supervisor');
  const leader = await mk('leader', 'dispatcher', 'team_leader');
  const tech = await mk('tech', 'mechanic');
  const tech2 = await mk('tech2', 'mechanic');
  const mechIns = async (key, name) => {
    const r = await q(`INSERT INTO mechanics (workshop_id, user_id, full_name, phone, is_active, status, team_leader_id) VALUES (1,?,?,'+971500000561',1,'available',?)`, [users[key].id, name, users.leader.id]);
    created.mechanics.push(r.insertId); return r.insertId;
  };
  const mech = await mechIns('tech', 'QA TA Technician');
  const mech2 = await mechIns('tech2', 'QA TA Second Technician');

  // ── set-up: two approved job cards (external walk-in → estimate → Supervisor → customer link) ──
  section = 'set-up';
  const cust = (await call('POST', '/customers', advisor, { full_name: 'QA TA Walk-in', phone: '+971500000562', email: 'qa-ta-walkin@example.invalid', customer_class: 'external', customer_subcategory: 'walkin' })).json?.data;
  created.customers.push(cust.id);
  const vehicle = async (plate, vin) => {
    const v = (await call('POST', '/vehicles', advisor, { customer_id: cust.id, make: 'Toyota', model: 'Hilux', year: 2020, plate_number: plate, vin })).json?.data;
    created.vehicles.push(v.id); return v;
  };
  const v1 = await vehicle('QA TA 01', 'TSTTAP00000000101');
  const v2 = await vehicle('QA TA 02', 'TSTTAP00000000202');
  const approvedJob = async (veh, description) => {
    const wo = await call('POST', '/work-orders', advisor, { customer_id: cust.id, vehicle_id: veh.id, customer_name: cust.full_name, customer_phone: cust.phone,
      description, odometer_in: 54321, payment_method: 'cash', service_fee: 0, items: [] });
    const woId = wo.json?.data?.id; created.work_orders.push(woId);
    const lines = [{ job_name: 'Oil seal', line_type: 'labour', description: 'Replace oil seal - labour', quantity: 1.5, unit_price: 80 }];
    // An external customer: the job card opens when they acknowledge the physical inspection, and the estimate follows.
    const gated = await call('POST', '/estimates', advisor, { intake_work_order_id: woId, lines });
    const insp = (await call('POST', '/vehicle-inspections', advisor, { work_order_id: woId, inspection_type: 'intake' })).json?.data;
    await call('PATCH', `/vehicle-inspections/${insp?.id}/signature`, advisor, { signature: PNG, name: cust.full_name });
    const ack = await call('PATCH', `/vehicle-inspections/${insp?.id}/complete`, advisor, {});
    const est = await call('POST', '/estimates', advisor, { intake_work_order_id: woId, lines });
    await call('POST', `/estimates/${est.json.estimateId}/internal-approve`, supervisor);
    await call('POST', `/estimates/${est.json.estimateId}/send`, advisor, { format: 'genuine', channel: 'whatsapp' });
    const [{ approval_token: atok }] = await q('SELECT approval_token FROM service_estimates WHERE id = ?', [est.json.estimateId]);
    for (const l of await q('SELECT id FROM estimate_lines WHERE estimate_id = ?', [est.json.estimateId])) {
      await call('POST', `/public/estimates/${atok}/lines/${l.id}/decide`, null, { decision: 'approved' });
    }
    const [w] = await q('SELECT id, work_order_number, service_status_token, customer_approved_at FROM work_orders WHERE id = ?', [woId]);
    const [jc] = await q('SELECT id, job_card_number FROM job_cards WHERE work_order_id = ? AND parent_job_card_id IS NULL', [woId]);
    return { ...w, main: jc, gated: gated.status === 409 && gated.json?.code === 'PHYSICAL_INSPECTION_REQUIRED', opened: ack.json?.job_card?.opened_now === true };
  };
  const A = await approvedJob(v1, 'QA TA oil leak');
  const B = await approvedJob(v2, 'QA TA brake noise');
  expect('two job cards: each opened by the customer\'s acknowledgement of the physical inspection (the estimate refused before it), then approved by the customer',
    A.gated && B.gated && A.opened && B.opened && !!A.customer_approved_at && !!B.customer_approved_at && !!A.main && !!B.main, `${A.work_order_number}, ${B.work_order_number}`);
  const now = new Date();
  const asg = await call('POST', '/team-leader/assign', leader, { work_order_id: A.id, mechanic_id: mech,
    scheduled_start_at: local(new Date(now.getTime() - 30 * 60000)), scheduled_end_at: local(new Date(now.getTime() + 90 * 60000)) });
  const asg2 = await call('POST', '/team-leader/assign', leader, { work_order_id: B.id, mechanic_id: mech2 });
  const sub = await call('POST', `/workflow/work-orders/${A.id}/sub-job-cards`, leader, { title: 'Seal housing paint', department: 'body_paint', mechanic_id: mech });
  const subId = sub.json?.data?.id;
  expect('Team Leader assigns A (window started 30 min ago) and B; a sub-job card on A for the same technician',
    asg.status === 200 && asg2.status === 200 && sub.status === 201, `${asg.status}/${asg2.status}/${sub.status}`);

  // ── S4: what a technician may reach ──
  section = 'S4 access';
  const pq = await call('PATCH', `/job-cards/${A.main.id}/status`, tech, { status: 'qc_passed' });
  expect('technician: PATCH /job-cards/:id/status qc_passed on their own card → 403', pq.status === 403, brief(pq));
  for (const [m, p, b] of [['GET', '/job-cards'], ['GET', '/job-cards/stats/productivity'], ['GET', '/job-cards/loaners/list'], ['POST', '/job-cards', { work_order_id: A.id }]]) {
    const r = await call(m, p, tech, b);
    expect(`technician: ${m} ${p} → 403`, r.status === 403, brief(r));
  }
  const other = await call('GET', `/job-cards/${B.main.id}`, tech);
  const otherMine = await call('GET', `/job-cards/mine/${B.main.id}`, tech);
  expect("technician: another technician's job card → 404 (GET /:id and /mine/:id)", other.status === 404 && otherMine.status === 404, `${other.status}/${otherMine.status}`);
  const own = await call('GET', `/job-cards/${A.main.id}`, tech);
  expect('technician: own job card through GET /:id has no costs or customer name', own.status === 200 && !('total_cost' in own.json.jobCard) && !('wo_customer_name' in own.json.jobCard), brief(own));
  const useQc = await call('PATCH', `/job-cards/${B.main.id}/status`, supervisor, { status: 'qc_passed' });
  expect('Supervisor: qc_passed through PATCH /:id/status → 400 USE_QC (the QC is recorded with its checklist)', useQc.status === 400 && useQc.json?.code === 'USE_QC', brief(useQc));
  const billed = await call('PATCH', `/job-cards/${B.main.id}/status`, leader, { status: 'billed' });
  expect('Team Leader: billing steps need a manager → 403', billed.status === 403, brief(billed));
  const advOpen = await call('PATCH', `/job-cards/${B.main.id}/status`, advisor, { status: 'parts_requested' });
  expect('Service Advisor (no job.assign) cannot change a job card status → 403', advOpen.status === 403, brief(advOpen));

  // ── GET /mine ──
  section = '/mine';
  let mine = await call('GET', '/job-cards/mine', tech);
  let M = mine.json?.jobCards?.find(c => c.id === A.main.id);
  let S = mine.json?.jobCards?.find(c => c.id === subId);
  const bk = mine.json?.bookings_today?.find(b => b.work_order_id === A.id);
  expect('/mine has server_time, summary, bookings_today and both cards', !!mine.json?.server_time && !!mine.json?.summary && Array.isArray(mine.json?.bookings_today) && !!M && !!S,
    Object.keys(mine.json || {}).join(','));
  expect('summary fields', ['time_booked_today_min', 'jobs_done_today', 'waiting_qc', 'rework', 'running', 'paused'].every(k => k in mine.json.summary), JSON.stringify(mine.json.summary));
  expect('card fields: approval_missing false, is_main, department, vin, odometer_in, scheduled window',
    M.approval_missing === false && M.is_main === true && S.is_main === false && S.department === 'body_paint' && M.vin === 'TSTTAP00000000101'
    && Number(M.odometer_in) === 54321 && !!M.scheduled_start_at, `${M.approval_missing}/${M.is_main}/${S.department}`);
  expect('no prices, no customer name or phone on the technician card', M.items.length > 0 && !('unit_price' in M.items[0]) && !('customer_name' in M) && !('customer_phone' in M), JSON.stringify(M.items[0]));
  expect('booked window started, no time booked → late; booking state late', M.late === true && bk?.state === 'late' && bk?.job_card_id === A.main.id, `late=${M.late} state=${bk?.state}`);
  const [{ approval_missing: apm }] = await q("SELECT (billing_basis = 'itemised' AND customer_approved_at IS NULL) AS approval_missing FROM work_orders WHERE id = ?", [A.id]);
  expect('approval_missing matches the work order', Number(apm) === 0, String(apm));

  // ── one clock per technician (S11) ──
  section = 'one clock';
  const st1 = await call('POST', `/job-cards/${A.main.id}/time/start`, tech);
  const st409 = await call('POST', `/job-cards/${subId}/time/start`, tech);
  expect('Start A, then Start the sub-job card → 409 CLOCK_RUNNING_ELSEWHERE naming A', st1.status === 201 && st409.status === 409 && st409.json?.code === 'CLOCK_RUNNING_ELSEWHERE'
    && st409.json?.running?.job_card_id === A.main.id && st409.json?.running?.work_order_number === A.work_order_number, `${st1.status}/${brief(st409)}`);
  const st2 = await call('POST', `/job-cards/${subId}/time/start`, tech, { pause_other: true });
  const [lastA] = await q('SELECT end_reason, pause_reason FROM technician_time_logs WHERE job_card_id = ? ORDER BY clock_in DESC, id DESC LIMIT 1', [A.main.id]);
  expect('with pause_other → 201; A is paused with other_job', st2.status === 201 && lastA?.end_reason === 'pause' && lastA?.pause_reason === 'other_job', `${st2.status} ${JSON.stringify(lastA)}`);
  const twice = await call('POST', `/job-cards/${subId}/time/start`, tech, { pause_other: true });
  expect('Start twice on the same card is still a plain 409', twice.status === 409 && !twice.json?.code, brief(twice));
  const [{ n: openClocks }] = await q('SELECT COUNT(*) AS n FROM technician_time_logs WHERE mechanic_id = ? AND clock_out IS NULL', [mech]);
  expect('exactly one clock running', Number(openClocks) === 1, String(openClocks));
  mine = await call('GET', '/job-cards/mine', tech);
  M = mine.json.jobCards.find(c => c.id === A.main.id);
  expect('/mine: summary.running is the sub-job card; A paused · other_job, no longer late', mine.json.summary.running?.job_card_id === subId && M.time_state === 'paused'
    && M.last_pause_reason === 'other_job' && mine.json.summary.paused?.job_card_id === A.main.id && M.late === false,
    `${mine.json.summary.running?.job_card_id} ${M.time_state}/${M.last_pause_reason} late=${M.late}`);

  // ── pause reasons ──
  section = 'pause reason';
  const bad = await call('POST', `/job-cards/${subId}/time/pause`, tech, { reason: 'lunch' });
  const noNote = await call('POST', `/job-cards/${subId}/time/pause`, tech, { reason: 'other' });
  expect('unknown reason → 400 PAUSE_REASON_INVALID; Other without a note → 400 PAUSE_NOTE_REQUIRED',
    bad.status === 400 && bad.json?.code === 'PAUSE_REASON_INVALID' && noNote.status === 400 && noNote.json?.code === 'PAUSE_NOTE_REQUIRED', `${brief(bad)} / ${brief(noNote)}`);
  const pz = await call('POST', `/job-cards/${subId}/time/pause`, tech, { reason: 'waiting_parts', note: '  Seal kit  ' });
  const one = await call('GET', `/job-cards/mine/${subId}`, tech);
  const J = one.json?.jobCard;
  expect('Pause · waiting_parts is stored and comes back as last_pause_reason (with the note) and in the time log',
    pz.status === 200 && J?.time_state === 'paused' && J?.last_pause_reason === 'waiting_parts' && J?.last_pause_note === 'Seal kit'
    && J?.time_logs?.at(-1)?.pause_reason === 'waiting_parts', `${brief(pz)} ${J?.time_state}/${J?.last_pause_reason}/${J?.last_pause_note}`);
  const resumeA = await call('POST', `/job-cards/${A.main.id}/time/start`, tech);
  const floorPause = await call('POST', `/job-cards/${A.main.id}/time/pause`, leader, { mechanic_id: mech });
  const [lastA2] = await q('SELECT end_reason, pause_reason FROM technician_time_logs WHERE job_card_id = ? ORDER BY clock_in DESC, id DESC LIMIT 1', [A.main.id]);
  expect('the floor can still pause without a reason (Team Board)', resumeA.status === 201 && floorPause.status === 200 && lastA2.end_reason === 'pause' && lastA2.pause_reason === null,
    `${resumeA.status}/${floorPause.status} ${JSON.stringify(lastA2)}`);

  // ── Scan job card lookups ──
  section = 'lookup';
  const look = code => call('GET', `/job-cards/mine/lookup?code=${encodeURIComponent(code)}`, tech);
  for (const [label, code] of [['plate, lower case with spaces', 'qa ta 01'], ['plate without spaces', 'QATA01'], ['WO number', A.work_order_number],
    ['job card number', A.main.job_card_number], ['job sheet QR (/track/:token)', `https://app.example.invalid/track/${A.service_status_token}`],
    ['status link (/service-status/:token)', `/service-status/${A.service_status_token}`], ['full VIN', 'TSTTAP00000000101'],
    ['last 6 of the VIN', '000101'], ['VIN barcode with the leading I', 'ITSTTAP00000000101']]) {
    const r = await look(code);
    expect(`by ${label} → my cards on A`, r.status === 200 && r.json?.data?.some(c => c.id === A.main.id) && r.json.data.every(c => [A.main.id, subId].includes(c.id)), `${brief(r)} ${r.json?.data?.map(c => c.job_card_number).join(',') || ''}`);
  }
  const ny = await look('QA TA 02');
  expect("another technician's car → 403 NOT_YOURS with the car, not the technician", ny.status === 403 && ny.json?.code === 'NOT_YOURS' && ny.json?.match?.work_order_number === B.work_order_number
    && !JSON.stringify(ny.json).includes('Second Technician'), brief(ny));
  const nf = await look('NOPE-424242');
  const short = await look('ab');
  expect('unknown → 404 NOT_FOUND; fewer than 3 characters → 400', nf.status === 404 && nf.json?.code === 'NOT_FOUND' && short.status === 400, `${brief(nf)} / ${brief(short)}`);
  const logs = await q("SELECT note FROM work_order_scan_logs WHERE work_order_id = ? AND scan_type = 'technician_lookup' AND id > ?", [A.id, baseline.work_order_scan_logs || 0]);
  expect('lookups are logged as technician_lookup, never with the code', logs.length >= 9 && logs.every(l => !l.note.includes(A.service_status_token)), `${logs.length} rows`);
  const [{ s: woStatusBefore }] = await q('SELECT status AS s FROM work_orders WHERE id = ?', [B.id]);
  expect('a lookup changes nothing', woStatusBefore === 'assigned', woStatusBefore);

  // ── Job done, QC and Finished jobs ──
  section = 'history';
  const s1 = await call('POST', `/job-cards/${subId}/time/start`, tech);
  const d1 = await call('POST', `/job-cards/${subId}/done`, tech);
  mine = await call('GET', '/job-cards/mine', tech);
  expect('Job done → waiting for QC; jobs_done_today counts it', s1.status === 201 && d1.status === 200 && mine.json.summary.waiting_qc === 1 && mine.json.summary.jobs_done_today >= 1,
    JSON.stringify({ waiting_qc: mine.json.summary.waiting_qc, done: mine.json.summary.jobs_done_today }));
  const f = await call('POST', `/job-cards/${subId}/qc`, supervisor, { checklist_items: QC_OK.map(i => i.key === 'issue_repaired' ? { ...i, passed: false } : i), overall_result: 'failed', inspector_notes: 'Paint run on the housing' });
  mine = await call('GET', '/job-cards/mine', tech);
  S = mine.json.jobCards.find(c => c.id === subId);
  const [note] = await q("SELECT link FROM user_notifications WHERE user_id = ? AND title LIKE 'Rework needed%' ORDER BY id DESC LIMIT 1", [users.tech.id]);
  expect('QC failed → rework=1 with the inspector, time and note; the technician is sent to /mechanic/jobs/:id',
    f.status === 200 && mine.json.summary.rework === 1 && S?.qc_notes === 'Paint run on the housing' && S?.qc_inspector_name === 'QA TA supervisor' && !!S?.qc_at
    && note?.link === `/mechanic/jobs/${subId}`, `${brief(f)} ${S?.qc_inspector_name} link=${note?.link}`);
  await call('POST', `/job-cards/${subId}/time/start`, tech);
  await call('POST', `/job-cards/${subId}/done`, tech);
  const p1 = await call('POST', `/job-cards/${subId}/qc`, supervisor, { checklist_items: QC_OK, overall_result: 'passed' });
  const dA = await call('POST', `/job-cards/${A.main.id}/done`, tech);
  const pA = await call('POST', `/job-cards/${A.main.id}/qc`, supervisor, { checklist_items: QC_OK, overall_result: 'passed' });
  expect('rework done and passed; A done and passed', p1.status === 200 && dA.status === 200 && pA.status === 200, `${p1.status}/${dA.status}/${pA.status}`);
  const h = await call('GET', '/job-cards/mine/history?days=7', tech);
  const hA = h.json?.items?.find(i => i.job_card_id === A.main.id);
  const hS = h.json?.items?.find(i => i.job_card_id === subId);
  expect('history: A passed first time, the sub-job card passed after rework; 50% first time', hA?.qc_result === 'passed_first_time' && hS?.qc_result === 'passed_after_rework'
    && h.json.totals.first_time_pass_pct === 50 && h.json.totals.cards === 2 && hA.handed_over === false && typeof hA.booked_minutes === 'number',
    `${hA?.qc_result}/${hS?.qc_result} ${JSON.stringify(h.json?.totals)}`);
  const pm = await call('GET', `/job-cards/mine/${A.main.id}`, tech);
  const [{ s: woA }] = await q('SELECT status AS s FROM work_orders WHERE id = ?', [A.id]);
  expect('/mine/:id still opens a QC-passed card; the work order followed the job cards to Ready for collection',
    pm.status === 200 && pm.json.jobCard.status === 'qc_passed' && woA === 'ready_for_pickup', `${pm.status} ${pm.json?.jobCard?.status} WO ${woA}`);
  mine = await call('GET', '/job-cards/mine', tech);
  expect('QC-passed cards leave My Jobs', !mine.json.jobCards.some(c => [A.main.id, subId].includes(c.id)), mine.json.jobCards.map(c => c.id).join(','));
} catch (e) {
  out.push('ERROR ' + e.stack);
} finally {
  // Signature images of the inspections signed here.
  for (const { u } of await q("SELECT signature_url u FROM vehicle_inspections WHERE id > ? AND signature_url LIKE '/uploads/signatures/sig_insp%'", [baseline.vehicle_inspections])) {
    if (/^\/uploads\/signatures\/sig_insp\d+_[\w-]+\.png$/.test(u)) fs.rmSync(BE + u, { force: true });
  }
  // Only this suite's rows may be above the baseline in the tables it creates in.
  const foreign = [];
  for (const [t, ids] of Object.entries(created)) {
    for (const r of await q(`SELECT id FROM \`${t}\` WHERE id > ?`, [baseline[t]])) if (!ids.includes(r.id)) foreign.push(`${t}#${r.id}`);
  }
  let removed = {};
  if (foreign.length) out.push('CLEANUP ABORTED — rows created by someone else meanwhile: ' + foreign.join(', '));
  else {
    await q('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of idTables) { const r = await q(`DELETE FROM \`${t}\` WHERE id > ?`, [baseline[t]]); if (r.affectedRows) removed[t] = r.affectedRows; }
    await q('SET FOREIGN_KEY_CHECKS = 1');
  }
  await db.end();
  console.log(out.join('\n'));
  console.log(`\n${out.filter(l => l.startsWith('PASS')).length} passed, ${out.filter(l => l.startsWith('FAIL')).length} failed  · cleanup ${JSON.stringify(removed)}`);
}
