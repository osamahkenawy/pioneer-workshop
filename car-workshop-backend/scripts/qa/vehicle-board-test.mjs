// Vehicle Status Board (GET /api/vehicle-board) through the API with real role logins:
// who may see it, the tile counts, the column each job is in at every step of the
// workflow (checked against the job card's own workflow), search, and the legacy cut-off.
// LOCAL ONLY; every row created is removed by id baseline at the end.
// QA_API overrides the API base (default http://localhost:4000/api).
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
const idTables = (await q(`SELECT table_name AS t FROM information_schema.columns WHERE table_schema = DATABASE() AND column_name = 'id' AND extra LIKE '%auto_increment%'`)).map(r => r.t);
const baseline = {}; for (const t of idTables) baseline[t] = (await q(`SELECT COALESCE(MAX(id),0) AS m FROM \`${t}\``))[0].m;

const board = async (tok, qs = '') => (await call('GET', `/vehicle-board${qs}`, tok)).json?.data;
const wfOf = async (tok, id) => (await call('GET', `/workflow/work-orders/${id}`, tok)).json?.data;
const badgeKeys = it => (it?.badges || []).map(b => b.key).join(',');
const show = it => (it ? `${it.phase} step ${it.step} · ${badgeKeys(it)} · waiting ${it.waiting_on?.key}` : 'not on the board');
/**
 * The job card's current step (buildWorkflow) → the columns it may be in.
 * Steps 1–3 → Reception; 4 → Inspection & pricing, or Reception while the
 * intake inspection is not signed off and no estimate exists (the "Checked in"
 * status, Steps 1–3 in the vocabulary); 5 → pricing or with the customer;
 * 6 → in work or with the customer; 7 → quality check or ready for collection.
 */
const ALLOWED = { 1: ['intake'], 2: ['intake'], 3: ['intake'], 4: ['pricing', 'intake'], 5: ['pricing', 'customer'], 6: ['work', 'customer'], 7: ['qc', 'ready'] };
const PHASES = ['intake', 'pricing', 'customer', 'work', 'qc', 'ready'];

try {
  const pw = 'Qa' + crypto.randomBytes(8).toString('hex') + '1';
  const users = {};
  const mk = async (key, role, slug) => {
    const [r] = slug ? await q('SELECT id FROM roles WHERE slug = ? AND workshop_id = 1', [slug]) : [null];
    const username = `qa_vb_${key}`;
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
  const manager = await mk('manager', 'workshop_manager', 'workshop_manager');
  const mechTok = await mk('tech', 'mechanic');
  const mech = (await q(`INSERT INTO mechanics (workshop_id, user_id, full_name, phone, is_active, status, team_leader_id) VALUES (1,?,'QA VB Technician','+971500000655',1,'available',?)`, [users.tech.id, users.leader.id])).insertId;

  // ── Who may see it ─────────────────────────────────────────────────
  section = 'access';
  const asTech = await call('GET', '/vehicle-board', mechTok);
  expect('a technician gets 403', asTech.status === 403, `HTTP ${asTech.status}`);
  const reg = await call('POST', '/customer-auth/register', null, { full_name: 'QA VB Portal', email: `qa-vb-${Date.now()}@example.invalid`, phone: '+971500000654', password: pw });
  const custTok = reg.json?.data?.token || reg.json?.token;
  const asCust = custTok ? await call('GET', '/vehicle-board', custTok) : { status: 'no token' };
  expect('a customer gets 403', asCust.status === 403, `HTTP ${asCust.status}`);
  const anon = await call('GET', '/vehicle-board');
  expect('no login gets 401', anon.status === 401, `HTTP ${anon.status}`);
  for (const [name, tok] of [['Service Advisor', advisor], ['Team Leader', leader], ['Workshop Manager', manager]]) {
    const r = await call('GET', '/vehicle-board', tok);
    expect(`${name} can load it`, r.status === 200 && Array.isArray(r.json?.data?.items), `HTTP ${r.status}`);
  }
  // The Store roles have no 'service-status' module: the board carries customer names and phones.
  const asStore = await call('GET', '/vehicle-board', store);
  expect('Storekeeper gets 403', asStore.status === 403, `HTTP ${asStore.status}`);
  const mgrBoard = await board(manager);
  const advBoard = await board(advisor);
  expect('managers may narrow to a Team Leader; the Service Advisor may not', mgrBoard.you?.can_filter_team === true && advBoard.you?.can_filter_team === false
    && mgrBoard.team_leaders.some(t => t.id === users.leader.id) && advBoard.team_leaders.length === 0, `${mgrBoard.you?.can_filter_team}/${advBoard.you?.can_filter_team}`);

  // ── Steps 1–3 ──────────────────────────────────────────────────────
  section = 'steps';
  const plate = `QAVB${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  const vin = `TSTVBD${crypto.randomBytes(6).toString('hex').toUpperCase().slice(0, 11)}`;
  const cust = (await call('POST', '/customers', advisor, { full_name: 'QA VB Walk-in', phone: '+971500000651', email: 'qa-vb-walkin@example.invalid', customer_class: 'external', customer_subcategory: 'walkin' })).json?.data;
  const veh = (await call('POST', '/vehicles', advisor, { customer_id: cust.id, make: 'Toyota', model: 'Prado', year: 2022, plate_number: plate, vin })).json?.data;
  const created = await call('POST', '/work-orders', advisor, { customer_id: cust.id, vehicle_id: veh.id, customer_name: cust.full_name, customer_phone: cust.phone,
    description: 'Brake noise; AC weak', odometer_in: 41000, payment_method: 'cash', service_fee: 0, items: [] });
  const woId = created.json?.data?.id;
  const [mainJc] = await q('SELECT * FROM job_cards WHERE work_order_id = ? AND parent_job_card_id IS NULL', [woId]);
  const item = async (tok = advisor, qs = '') => (await board(tok, qs))?.items.find(i => i.id === woId);
  /** The board's column agrees with the job card's own workflow. */
  const agrees = async (label, it) => {
    const wf = await wfOf(advisor, woId);
    const okPhase = (ALLOWED[wf.current_step] || []).includes(it?.phase);
    expect(`${label}: board column fits the job card's step ${wf.current_step}`, okPhase, `${show(it)}; workflow step ${wf.current_step}`);
  };
  let it = await item();
  expect('a new job is in Reception, "Inspection not started", waiting on the Service Advisor',
    it?.phase === 'intake' && it.badges[0]?.key === 'inspection_not_started' && it.waiting_on?.key === 'service_advisor' && it.main_job_card_number === mainJc.job_card_number,
    show(it));
  await agrees('new job', it);
  expect('the card carries the vehicle, customer class and link token', it?.plate === plate && it.make === 'Toyota' && it.customer_class === 'external'
    && it.customer_subcategory === 'walkin' && !!it.service_status_token && it.legacy === false, `${it?.plate} ${it?.customer_class}/${it?.customer_subcategory}`);

  // ── Steps 4–5 ──────────────────────────────────────────────────────
  const est = await call('POST', '/estimates', advisor, { intake_work_order_id: woId, lines: [
    { job_name: 'Brakes', line_type: 'labour', description: 'Brake service - labour', quantity: 1, unit_price: 150 },
    { job_name: 'Brakes', line_type: 'parts', description: 'Brake pads', quantity: 1 },
    { job_name: 'AC', line_type: 'parts', description: 'AC filter', quantity: 1 },
  ] });
  const estId = est.json?.estimateId;
  it = await item();
  expect('estimate raised, parts not priced → Inspection & pricing, "Parts to price: 2", waiting on the Storekeeper',
    est.status === 201 && it?.phase === 'pricing' && it.badges[0]?.key === 'store_pricing' && it.badges[0]?.params?.n === 2 && it.waiting_on?.key === 'storekeeper', show(it));
  await agrees('parts to price', it);
  const lines = await q('SELECT id, description FROM estimate_lines WHERE estimate_id = ? ORDER BY sort_order, id', [estId]);
  const L = Object.fromEntries(lines.map(l => [l.description, l.id]));
  await call('PATCH', `/estimates/${estId}/lines/${L['Brake pads']}/pricing`, store, { genuine_price: 220, aftermarket_price: 140 });
  await call('PATCH', `/estimates/${estId}/lines/${L['AC filter']}/pricing`, store, { genuine_price: 60, aftermarket_price: 35 });
  it = await item();
  expect('priced, external customer → "Needs Supervisor/WM approval"', it?.phase === 'pricing' && it.badges[0]?.key === 'needs_approval' && it.waiting_on?.key === 'supervisor_wm', show(it));
  await agrees('needs approval', it);
  await call('POST', `/estimates/${estId}/internal-approve`, supervisor);
  it = await item();
  expect('approved inside → "Ready to send", waiting on the Service Advisor', it?.badges[0]?.key === 'ready_to_send' && it.waiting_on?.key === 'service_advisor', show(it));
  const sent = await call('POST', `/estimates/${estId}/send`, advisor, { format: 'both' });
  it = await item();
  // No SMTP locally → 502 EMAIL_FAILED with the live link; the estimate is sent either way.
  const sentOk = sent.status === 200 || (sent.status === 502 && sent.json?.code === 'EMAIL_FAILED');
  expect('sent → With customer, "Sent … ago", waiting on the customer', sentOk && it?.phase === 'customer' && it.badges[0]?.key === 'sent' && it.waiting_on?.key === 'customer', show(it));
  await agrees('sent', it);

  // ── Step 6 ─────────────────────────────────────────────────────────
  const [{ approval_token: token }] = await q('SELECT approval_token FROM service_estimates WHERE id = ?', [estId]);
  for (const [desc, opt] of [['Brake service - labour'], ['Brake pads', 'after_market'], ['AC filter', 'genuine']]) {
    await call('POST', `/public/estimates/${token}/lines/${L[desc]}/decide`, null, { decision: 'approved', part_option: opt });
  }
  it = await item();
  expect('customer approved → In work, "Waiting for technician", waiting on the Team Leader', it?.phase === 'work' && it.badges[0]?.key === 'no_technician' && it.waiting_on?.key === 'team_leader', show(it));
  await agrees('approved', it);
  await call('POST', '/team-leader/assign', leader, { work_order_id: woId, mechanic_id: mech });
  it = await item();
  expect('technician assigned → "Not started", with the technician on the card', it?.phase === 'work' && badgeKeys(it) === 'not_started' && it.technician?.id === mech, show(it));
  const [teamOnly, everyone] = await Promise.all([board(manager, `?team_leader_id=${users.leader.id}`), board(manager)]);
  expect('the Team Leader filter keeps the job on that team, and narrows the board', teamOnly?.items.some(i => i.id === woId) && teamOnly.items.length < everyone.items.length,
    `${teamOnly?.items.length} of ${everyone?.items.length}`);
  await call('POST', `/job-cards/${mainJc.id}/time/start`, mechTok);
  it = await item();
  expect('clock started → "Clock running", clock state running', it?.badges[0]?.key === 'clock_running' && it.clock?.state === 'running' && !!it.clock.since, show(it));
  const rq = await call('POST', `/job-cards/${mainJc.id}/requisitions`, mechTok, { items: [{ description: 'Brake cleaner', quantity: 1 }] });
  const [ri] = await q('SELECT i.id FROM material_requisition_items i WHERE i.requisition_id = ?', [rq.json?.requisitionId]);
  const tomorrow = new Date(Date.now() + 86400000); const tmr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  await call('PATCH', `/workflow/requisition-items/${ri.id}`, store, { availability: 'not_available', expected_date: tmr });
  const withParts = await board(advisor);
  it = withParts.items.find(i => i.id === woId);
  expect('part not on the shelf → "Waiting parts · ETA", counted under In work', it?.badges.some(b => b.key === 'waiting_parts_eta' && b.params?.date === tmr) && withParts.counts.parts_waiting >= 1,
    `${show(it)}; parts_waiting ${withParts.counts.parts_waiting}`);
  await call('PATCH', `/workflow/requisition-items/${ri.id}`, store, { availability: 'available', unit_cost: 12 });
  await call('POST', `/job-cards/${mainJc.id}/time/pause`, mechTok, { reason: 'waiting_info' });
  it = await item();
  expect('paused → "Paused" (with the reason once the technician app records it); parts badge gone',
    ['paused', 'paused_reason'].includes(it?.badges[0]?.key) && it.clock?.state === 'paused' && !badgeKeys(it).includes('waiting_parts'), show(it));
  await call('POST', `/job-cards/${mainJc.id}/time/start`, mechTok);
  await call('POST', `/job-cards/${mainJc.id}/time/stop`, mechTok);
  const done = await call('POST', `/job-cards/${mainJc.id}/done`, mechTok);
  it = await item();
  expect('job done → Quality check, waiting on Supervisor / Foreman / Team Leader', done.status === 200 && it?.phase === 'qc' && it.waiting_on?.key === 'qc', show(it));
  await agrees('job done', it);

  // ── Step 7 ─────────────────────────────────────────────────────────
  const wf7 = await wfOf(advisor, woId);
  const all = wf7.qc_checklist.map(c => (c.type === 'comment' ? { key: c.key, item: c.label, passed: true, notes: '' } : { key: c.key, item: c.label, passed: true }));
  await call('POST', `/job-cards/${mainJc.id}/qc`, supervisor, { checklist_items: all, overall_result: 'failed', inspector_notes: 'Pads squeal on the test drive' });
  it = await item();
  expect('QC failed → back In work with a red "Rework" first', it?.phase === 'work' && it.badges[0]?.key === 'rework' && it.badges[0]?.tone === 'red', show(it));
  await call('POST', `/job-cards/${mainJc.id}/time/start`, mechTok);
  await call('POST', `/job-cards/${mainJc.id}/time/stop`, mechTok);
  await call('POST', `/job-cards/${mainJc.id}/done`, mechTok);
  await call('POST', `/job-cards/${mainJc.id}/qc`, supervisor, { checklist_items: all, overall_result: 'passed' });
  it = await item();
  expect('QC passed → Ready for collection, "Call customer"', it?.phase === 'ready' && it.badges[0]?.key === 'call_customer' && it.waiting_on?.key === 'service_advisor', show(it));
  await agrees('ready', it);
  await call('POST', `/workflow/work-orders/${woId}/contacts`, advisor, { channel: 'phone', outcome: 'reached', note: 'Collecting at 6pm' });
  await call('POST', `/workflow/work-orders/${woId}/gate-pass`, advisor, {}); // raises the invoice; refused while unpaid
  it = await item();
  expect('customer called, invoice unpaid → "Awaiting payment", waiting on the Cashier, balance shown',
    it?.badges[0]?.key === 'awaiting_payment' && it.waiting_on?.key === 'cashier' && it.invoice?.balance > 0 && it.invoice.on_account === false, `${show(it)}; ${JSON.stringify(it?.invoice)}`);
  const [inv] = await q("SELECT id, total_amount FROM invoices WHERE work_order_id = ? AND status NOT IN ('void','cancelled') ORDER BY id DESC LIMIT 1", [woId]);
  await call('POST', `/invoices/${inv.id}/record-payment`, advisor, { amount: Number(inv.total_amount), payment_method: 'card' });
  it = await item();
  expect('paid → "Issue gate pass"', it?.badges[0]?.key === 'issue_gate_pass' && it.invoice?.balance === 0, show(it));
  await call('POST', `/workflow/work-orders/${woId}/gate-pass`, advisor, { odometer_out: 41012 });
  it = await item();
  expect('gate pass released → "Close job"', it?.badges[0]?.key === 'close_job', show(it));
  await call('POST', `/workflow/work-orders/${woId}/close`, advisor);
  const closed = await board(advisor);
  it = closed.items.find(i => i.id === woId);
  expect('closed → Closed today, counted in closed_today and not in the workshop', it?.phase === 'closed' && closed.counts.closed_today >= 1 && !closed.items.some(i => i.id === woId && i.phase !== 'closed'), show(it));

  // ── Tiles, search ──────────────────────────────────────────────────
  section = 'tiles';
  const full = await board(manager);
  const sum = PHASES.reduce((s, p) => s + full.counts[p], 0);
  expect('the step tiles add up to "Cars in workshop"', sum === full.counts.in_workshop, `${sum} vs ${full.counts.in_workshop}`);
  expect('"Cars in workshop" + "Closed today" = the items listed', full.counts.in_workshop + full.counts.closed_today === full.items.length, `${full.counts.in_workshop} + ${full.counts.closed_today} vs ${full.items.length}`);
  expect('each tile counts its own column', PHASES.every(p => full.items.filter(i => i.phase === p).length === full.counts[p]),
    PHASES.map(p => `${p}:${full.counts[p]}`).join(' '));
  const only = await board(manager, '?phase=ready');
  expect('?phase= lists one column but keeps every tile count', only.items.every(i => i.phase === 'ready') && only.counts.in_workshop === full.counts.in_workshop, `n=${only.items.length}`);
  const late = await board(manager, '?late=1');
  expect('"Late only" lists late cars, as many as the late count', late.items.every(i => i.late) && late.items.filter(i => i.phase !== 'closed').length === full.counts.late,
    `${late.items.length} vs ${full.counts.late}`);

  section = 'search';
  for (const [label, term] of [['plate', plate.toLowerCase()], ['VIN', vin.slice(-8)], ['job card number', mainJc.job_card_number], ['work order number', created.json.data.work_order_number]]) {
    const r = await board(advisor, `?q=${encodeURIComponent(term)}`);
    expect(`search by ${label} finds the job`, r?.items.some(i => i.id === woId), `"${term}" → ${r?.items.length} item(s)`);
  }
  const none = await board(advisor, `?q=${encodeURIComponent('ZZ-NO-SUCH-JOB-ZZ')}`);
  expect('a search with no match lists nothing', none?.items.length === 0 && none.counts.in_workshop === 0, `n=${none?.items.length}`);

  // ── Legacy cut-off ─────────────────────────────────────────────────
  // An open job with no job card that was opened before the workshop's first
  // job card is an old import (lib/job-phase.js isLegacyJob); one opened since
  // (its job card failed to open) stays on the board.
  section = 'legacy';
  const mkOld = async (days, n) => (await q(
    `INSERT INTO work_orders (workshop_id, work_order_number, customer_id, customer_name, customer_phone, description, status, billing_basis, created_at)
     VALUES (1, ?, ?, 'QA VB Imported', '+971500000653', 'Imported job', 'in_progress', 'service_fee', NOW() - INTERVAL ? DAY)`,
    [`QAVB-OLD-${n}-${crypto.randomBytes(2).toString('hex')}`, cust.id, days])).insertId;
  const oldId = await mkOld(100, 1);
  const recentId = await mkOld(0, 2);
  const def = await board(advisor);
  const withLegacy = await board(advisor, '?include_legacy=1');
  const recent = def.items.find(i => i.id === recentId);
  expect('an open job with no job card, opened before the first job card, is hidden and counted in legacy_hidden',
    !def.items.some(i => i.id === oldId) && def.counts.legacy_hidden >= 1, `legacy_hidden ${def.counts.legacy_hidden}`);
  expect('one opened since shows, marked "No job card", in the column its status gives', recent?.phase === 'work' && badgeKeys(recent).includes('no_job_card') && recent.legacy === false, show(recent));
  const shown = withLegacy.items.find(i => i.id === oldId);
  expect('?include_legacy=1 shows it, flagged legacy', shown?.legacy === true && withLegacy.counts.legacy_hidden === 0
    && withLegacy.items.length === def.items.length + def.counts.legacy_hidden, `${withLegacy.items.length} vs ${def.items.length} + ${def.counts.legacy_hidden}`);

  // ── Declined ───────────────────────────────────────────────────────
  section = 'declined';
  // A QA internal fleet account of its own (a manager sets the class), never a real customer.
  const fleetRes = await call('POST', '/customers', manager, { full_name: 'QA VB Internal Fleet', phone: '+971500000652', email: 'qa-vb-fleet@example.invalid', customer_class: 'internal', customer_subcategory: 'fleet' });
  const fleet = fleetRes.json?.data;
  expect('QA internal fleet customer created by the manager', !!fleet?.id, `HTTP ${fleetRes.status} ${fleetRes.json?.code || fleetRes.json?.message || ''}`);
  const veh2 = (await call('POST', '/vehicles', advisor, { customer_id: fleet.id, make: 'Nissan', model: 'Sunny', year: 2020, plate_number: `${plate}X`, vin: `${vin.slice(0, 16)}X` })).json?.data;
  const wo2 = (await call('POST', '/work-orders', advisor, { customer_id: fleet.id, vehicle_id: veh2.id, customer_name: fleet.full_name, customer_phone: fleet.phone, description: 'Service', odometer_in: 90000, payment_method: 'credit', items: [] })).json?.data?.id;
  const e2 = (await call('POST', '/estimates', advisor, { intake_work_order_id: wo2, lines: [{ job_name: 'Service', line_type: 'labour', description: 'Full service', quantity: 1, unit_price: 250 }] })).json?.estimateId;
  let it2 = (await board(advisor)).items.find(i => i.id === wo2);
  expect('internal customer, priced → "Ready to send" (no Supervisor approval needed)', it2?.phase === 'pricing' && it2.badges[0]?.key === 'ready_to_send' && it2.customer_class === 'internal', show(it2));
  await call('POST', `/estimates/${e2}/send`, advisor, { format: 'genuine', channel: 'whatsapp' });
  const [{ approval_token: t2 }] = await q('SELECT approval_token FROM service_estimates WHERE id = ?', [e2]);
  const [l2] = await q('SELECT id FROM estimate_lines WHERE estimate_id = ?', [e2]);
  await call('POST', `/public/estimates/${t2}/lines/${l2.id}/decide`, null, { decision: 'rejected', reason: 'Too expensive' });
  const [wo2row] = await q('SELECT status FROM work_orders WHERE id = ?', [wo2]);
  it2 = (await board(advisor)).items.find(i => i.id === wo2);
  expect('every line declined → the job is cancelled and leaves the board', wo2row.status === 'cancelled' && !it2, `WO ${wo2row.status}; ${show(it2)}`);
} catch (e) { out.push('ERROR ' + e.stack); }
finally {
  await q('SET FOREIGN_KEY_CHECKS = 0'); const removed = {};
  for (const t of idTables) { const r = await q(`DELETE FROM \`${t}\` WHERE id > ?`, [baseline[t]]); if (r.affectedRows) removed[t] = r.affectedRows; }
  await q('SET FOREIGN_KEY_CHECKS = 1'); await db.end();
  console.log(out.join('\n'));
  console.log(`\n${out.filter(l => l.startsWith('PASS')).length} passed, ${out.filter(l => l.startsWith('FAIL')).length} failed · cleanup ${Object.keys(removed).length} tables`);
  process.exit(0);
}
